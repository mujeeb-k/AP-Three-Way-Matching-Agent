import cds from '@sap/cds';
import { completeWithToolsFallback } from './lib/ai/index.js';
import type { AIToolDefinition, AIToolMessage, AIToolCompletionResponse } from './lib/ai/types.js';
import { childLogger } from './lib/util/logger.js';

const log = childLogger('assistant-service');
// System Prompt
const SYSTEM_PROMPT = `You are AP Copilot, the assistant for the AP Three-Way-Matching Agent. You help AP clerks and finance managers review, approve, escalate, and reject invoices with discrepancies detected by the automated 3-way matching engine.

You have access to tools that let you query invoices, view discrepancy details, and execute actions.

RULES:
1. Always query actual data before responding — never fabricate invoice details, amounts, or counts.
2. Before executing any action (accept, escalate, reject), present a clear confirmation to the user showing: the invoice number, the action you're about to take, and the consequence. Wait for explicit user confirmation before calling the action tool.
3. You can only perform actions that the logged-in user has permission for.
4. Keep responses concise and data-focused. AP clerks are busy — don't be verbose.
5. When showing invoice details, structure your response clearly: invoice header info, discrepancy details, and what action options are available.
6. When the user's intent is ambiguous or matches multiple invoices, present the matching invoices and ask which one they mean.
7. NEVER batch-execute actions on multiple invoices at once. If the user asks to act on multiple invoices, walk them through each invoice individually — present one at a time, require individual confirmation for each. This is a compliance requirement.
8. After all individual reviews in a batch are complete, present a final summary showing every invoice and the action chosen before committing.
9. Always include 2-4 suggestedBubbles in your response that represent the most logical next steps. These should be action-oriented (not educational). Never suggest the same action the user just completed. Bubble labels should be short (under 6 words), natural language.

RESPONSE FORMAT:
You MUST respond with valid JSON in this exact structure:
{
  "response": "Your text response to the user",
  "richContent": null or { "type": "...", "data": { ... } },
  "suggestedBubbles": [{ "label": "Short label", "prompt": "Full prompt to send" }]
}

Rich content types you can emit:
- { "type": "invoice_detail", "data": { invoice object with discrepancies } } — when showing a single invoice's details
- { "type": "invoice_list", "data": { "items": [...] } } — when listing multiple invoices
- { "type": "confirmation", "data": { "action": "accept|escalate|reject", "invoiceNumber": "...", "discrepancyId": "...", "invoiceId": "...", "consequence": "..." } } — before executing an action
- { "type": "action_result", "data": { "success": true/false, "action": "...", "target": "...", "message": "..." } } — after executing an action

Always respond with the JSON structure above. Do not include any text outside the JSON.`;
// Tool Definitions
const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: 'query_work_items',
    description: 'Query the work queue for pending and in-review discrepancies with invoice header data. Results are pre-sorted by risk (CRITICAL first). Use this to search/filter invoices.',
    parameters: {
      type: 'object',
      properties: {
        riskTier: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], description: 'Filter by risk tier' },
        agentDecision: { type: 'string', enum: ['AUTO_CORRECTED', 'FLAGGED_REVIEW', 'FLAGGED_REJECT', 'ESCALATED', 'PENDING_GR'], description: 'Filter by AI decision' },
        search: { type: 'string', description: 'Search by invoice number, vendor ID, or PO number' },
        limit: { type: 'number', description: 'Max results to return (default 10, max 50)' },
      },
    },
  },
  {
    name: 'get_invoice_discrepancies',
    description: 'Get all discrepancies for a specific invoice including detected fields, corrections, and AI analysis. Use the invoiceId (UUID), not the invoice number.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'Invoice UUID' },
      },
      required: ['invoiceId'],
    },
  },
  {
    name: 'get_invoice_timeline',
    description: 'Get the chronological event timeline for an invoice showing all actions taken, status changes, and agent analysis events.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'Invoice UUID' },
      },
      required: ['invoiceId'],
    },
  },
  {
    name: 'accept_correction',
    description: 'Accept the AI-proposed correction for a specific discrepancy. Marks it as RESOLVED/ACCEPTED. ALWAYS confirm with the user first before calling this.',
    parameters: {
      type: 'object',
      properties: {
        discrepancyId: { type: 'string', description: 'Discrepancy UUID' },
        notes: { type: 'string', description: 'Optional notes for the acceptance' },
      },
      required: ['discrepancyId'],
    },
  },
  {
    name: 'escalate_discrepancy',
    description: 'Escalate a discrepancy to a manager for review. Sets status to IN_REVIEW and decision to ESCALATED. ALWAYS confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        discrepancyId: { type: 'string', description: 'Discrepancy UUID' },
        reason: { type: 'string', description: 'Reason for escalation' },
      },
      required: ['discrepancyId'],
    },
  },
  {
    name: 'reject_invoice',
    description: 'Reject an entire invoice and return it to the vendor. TERMINAL ACTION — all pending discrepancies on the invoice are marked REJECTED. ALWAYS confirm with the user first and clearly state this affects the entire invoice.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'Invoice UUID' },
        reason: { type: 'string', description: 'Reason for rejection' },
      },
      required: ['invoiceId'],
    },
  },
  {
    name: 'assign_to_me',
    description: 'Assign a discrepancy to the current user for review. Sets status to IN_REVIEW.',
    parameters: {
      type: 'object',
      properties: {
        discrepancyId: { type: 'string', description: 'Discrepancy UUID' },
      },
      required: ['discrepancyId'],
    },
  },
  {
    name: 'submit_feedback',
    description: 'Submit human feedback on whether the AI analysis was correct. Call this after every action to collect calibration data.',
    parameters: {
      type: 'object',
      properties: {
        discrepancyId: { type: 'string', description: 'Discrepancy UUID' },
        aiWasCorrect: { type: 'boolean', description: 'Whether the AI diagnosis was correct' },
        feedbackCategory: { type: 'string', enum: ['CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT', 'UNSURE'] },
      },
      required: ['discrepancyId', 'aiWasCorrect'],
    },
  },
];
// Tool Execution Handlers
async function writeEvent(
  db: any, invoiceId: string, eventType: string,
  actor: string, actorRole: string, summary: string,
  discrepancyId?: string, detail?: object,
): Promise<void> {
  await db.run(INSERT.into('ir.InvoiceEvent').entries({
    ID: cds.utils.uuid(),
    invoice_ID: invoiceId,
    eventType,
    eventAt: new Date().toISOString(),
    actor,
    actorRole,
    summary,
    detail: detail ? JSON.stringify(detail) : null,
    discrepancy_ID: discrepancyId ?? null,
  }));
}

async function executeQueryWorkItems(
  args: Record<string, unknown>, db: any
): Promise<unknown> {
  const limit = Math.min(Number(args.limit) || 10, 50);

  // Query via raw SQL since CDS SELECT doesn't support join fluently in TS
  let rows: any[] = await db.run(
    `SELECT d.ID as discrepancyId, i.ID as invoiceId,
            i.vendorInvoiceNo as invoiceNumber, i.vendorId, i.companyCode,
            i.currency, i.totalAmount, i.postingDate, i.poNumber,
            d.discrepancyType, d.riskTier, d.confidence, d.description,
            d.agentDecision, d.decisionReason, d.reviewStatus, d.assignedTo
     FROM ir_Discrepancy d
     LEFT JOIN ir_InvoicePayload i ON d.invoice_ID = i.ID
     WHERE d.reviewStatus IN ('PENDING', 'IN_REVIEW')`
  );

  // Apply filters
  if (args.riskTier) {
    rows = rows.filter((r: any) => r.riskTier === args.riskTier);
  }
  if (args.agentDecision) {
    rows = rows.filter((r: any) => r.agentDecision === args.agentDecision);
  }
  if (args.search) {
    const s = String(args.search).toLowerCase();
    rows = rows.filter((r: any) =>
      r.invoiceNumber?.toLowerCase().includes(s) ||
      r.vendorId?.toLowerCase().includes(s) ||
      r.poNumber?.toLowerCase().includes(s)
    );
  }

  // Sort by risk order: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3
  const riskOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  rows.sort((a: any, b: any) => (riskOrder[a.riskTier] ?? 4) - (riskOrder[b.riskTier] ?? 4));

  return { items: rows.slice(0, limit), totalCount: rows.length };
}

async function executeGetDiscrepancies(
  args: Record<string, unknown>, db: any
): Promise<unknown> {
  const invoiceId = String(args.invoiceId);

  const invoice = await db.run(
    SELECT.one.from('ir.InvoicePayload').where({ ID: invoiceId })
  );
  if (!invoice) return { error: `Invoice ${invoiceId} not found` };

  const discrepancies = await db.run(
    SELECT.from('ir.Discrepancy').where({ invoice_ID: invoiceId })
      .orderBy('createdAt asc')
  );

  const lines = await db.run(
    SELECT.from('ir.InvoicePayloadLine').where({ invoice_ID: invoiceId })
      .orderBy('lineNumber asc')
  );

  return {
    invoice: {
      ID: invoice.ID,
      vendorInvoiceNo: invoice.vendorInvoiceNo,
      vendorId: invoice.vendorId,
      companyCode: invoice.companyCode,
      currency: invoice.currency,
      totalAmount: invoice.totalAmount,
      postingDate: invoice.postingDate,
      poNumber: invoice.poNumber,
    },
    discrepancies: discrepancies.map((d: any) => ({
      ID: d.ID,
      discrepancyType: d.discrepancyType,
      riskTier: d.riskTier,
      confidence: d.confidence,
      description: d.description,
      agentDecision: d.agentDecision,
      decisionReason: d.decisionReason,
      riskRationale: d.riskRationale,
      detectedFields: d.detectedFields,
      correctionsApplied: d.correctionsApplied,
      reviewStatus: d.reviewStatus,
      assignedTo: d.assignedTo,
    })),
    lines: lines.map((l: any) => ({
      lineNumber: l.lineNumber,
      materialNumber: l.materialNumber,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      netAmount: l.netAmount,
      correctedQty: l.correctedQty,
      correctedUnitPrice: l.correctedUnitPrice,
      correctedNetAmount: l.correctedNetAmount,
      hasCorrection: l.hasCorrection,
    })),
  };
}

async function executeGetTimeline(
  args: Record<string, unknown>, db: any
): Promise<unknown> {
  const invoiceId = String(args.invoiceId);
  const events = await db.run(
    SELECT.from('ir.InvoiceEvent').where({ invoice_ID: invoiceId })
      .orderBy('eventAt asc')
  );
  return {
    events: events.map((e: any) => ({
      eventType: e.eventType,
      eventAt: e.eventAt,
      actor: e.actor,
      actorRole: e.actorRole,
      summary: e.summary,
    })),
  };
}

async function executeAcceptCorrection(
  args: Record<string, unknown>, db: any, req: any, conversationId?: string
): Promise<unknown> {
  const discrepancyId = String(args.discrepancyId);
  const notes = args.notes ? String(args.notes) : null;
  const user = req.user?.id ?? 'unknown';

  const disc = await db.run(SELECT.one.from('ir.Discrepancy').where({ ID: discrepancyId }));
  if (!disc) return { success: false, message: `Discrepancy ${discrepancyId} not found` };
  if (disc.reviewStatus === 'RESOLVED') return { success: false, message: 'Discrepancy is already resolved' };

  const now = new Date().toISOString();
  await db.run(UPDATE('ir.Discrepancy').set({
    reviewStatus: 'RESOLVED', reviewOutcome: 'ACCEPTED',
    reviewedBy: user, reviewedAt: now, reviewNotes: notes,
  }).where({ ID: discrepancyId }));

  await writeEvent(db, disc.invoice_ID, 'REVIEWED', 'ASSISTANT', 'ASSISTANT',
    `Correction accepted via AP Copilot by ${user}: ${disc.discrepancyType}`, discrepancyId,
    { outcome: 'ACCEPTED', notes, source: 'ASSISTANT', executedBy: user, conversationId });

  await db.run(INSERT.into('ir.AgentAction').entries({
    ID: cds.utils.uuid(), invoice_ID: disc.invoice_ID, discrepancy_ID: discrepancyId,
    actionType: 'CORRECTION_ACCEPTED', targetSystem: 'INTERNAL',
    initiatedBy: user, payload: JSON.stringify({ discrepancyId, notes, source: 'ASSISTANT', conversationId }),
    success: true, executedAt: now,
  }));

  if (conversationId) {
    await db.run(INSERT.into('ir.AssistantAction').entries({
      ID: cds.utils.uuid(), conversation_ID: conversationId,
      invoiceId: disc.invoice_ID, action: 'accept_correction',
      reason: notes, executedAt: now, executedBy: user,
    }));
  }

  log.info({ discrepancyId, user }, 'Correction accepted via AP Copilot');
  return { success: true, message: 'Correction accepted successfully' };
}

async function executeEscalate(
  args: Record<string, unknown>, db: any, req: any, conversationId?: string
): Promise<unknown> {
  const discrepancyId = String(args.discrepancyId);
  const reason = args.reason ? String(args.reason) : 'Escalated via AP Copilot';
  const user = req.user?.id ?? 'unknown';

  const disc = await db.run(SELECT.one.from('ir.Discrepancy').where({ ID: discrepancyId }));
  if (!disc) return { success: false, message: `Discrepancy ${discrepancyId} not found` };

  await db.run(UPDATE('ir.Discrepancy').set({
    reviewStatus: 'IN_REVIEW', agentDecision: 'ESCALATED',
  }).where({ ID: discrepancyId }));

  await writeEvent(db, disc.invoice_ID, 'ESCALATED', 'ASSISTANT', 'ASSISTANT',
    `Escalated via AP Copilot by ${user}: ${reason}`, discrepancyId,
    { reason, source: 'ASSISTANT', executedBy: user, conversationId });

  if (conversationId) {
    await db.run(INSERT.into('ir.AssistantAction').entries({
      ID: cds.utils.uuid(), conversation_ID: conversationId,
      invoiceId: disc.invoice_ID, action: 'escalate',
      reason, executedAt: new Date().toISOString(), executedBy: user,
    }));
  }

  log.info({ discrepancyId, user }, 'Discrepancy escalated via AP Copilot');
  return { success: true, message: 'Escalated to manager for review' };
}

async function executeRejectInvoice(
  args: Record<string, unknown>, db: any, req: any, conversationId?: string
): Promise<unknown> {
  const invoiceId = String(args.invoiceId);
  const reason = args.reason ? String(args.reason) : 'Rejected via AP Copilot';
  const user = req.user?.id ?? 'unknown';

  const inv = await db.run(SELECT.one.from('ir.InvoicePayload').where({ ID: invoiceId }));
  if (!inv) return { success: false, message: `Invoice ${invoiceId} not found` };

  const now = new Date().toISOString();
  await db.run(UPDATE('ir.Discrepancy').set({
    reviewStatus: 'RESOLVED', reviewOutcome: 'REJECTED',
    reviewedBy: user, reviewedAt: now, reviewNotes: reason,
  }).where({ invoice_ID: invoiceId, reviewStatus: { in: ['PENDING', 'IN_REVIEW'] } }));

  await writeEvent(db, invoiceId, 'REJECTED', 'ASSISTANT', 'ASSISTANT',
    `Invoice rejected via AP Copilot by ${user}: ${reason}`, undefined,
    { reason, source: 'ASSISTANT', executedBy: user, conversationId });

  if (conversationId) {
    await db.run(INSERT.into('ir.AssistantAction').entries({
      ID: cds.utils.uuid(), conversation_ID: conversationId,
      invoiceId, action: 'reject_invoice',
      reason, executedAt: now, executedBy: user,
    }));
  }

  log.info({ invoiceId, user }, 'Invoice rejected via AP Copilot');
  return { success: true, message: 'Invoice rejected and returned to vendor' };
}

async function executeAssignToMe(
  args: Record<string, unknown>, db: any, req: any, conversationId?: string
): Promise<unknown> {
  const discrepancyId = String(args.discrepancyId);
  const user = req.user?.id ?? 'unknown';

  const disc = await db.run(SELECT.one.from('ir.Discrepancy').where({ ID: discrepancyId }));
  if (!disc) return { success: false, message: `Discrepancy ${discrepancyId} not found` };

  const now = new Date().toISOString();
  await db.run(UPDATE('ir.Discrepancy').set({
    assignedTo: user, assignedAt: now, reviewStatus: 'IN_REVIEW',
  }).where({ ID: discrepancyId }));

  await writeEvent(db, disc.invoice_ID, 'ASSIGNED', 'ASSISTANT', 'ASSISTANT',
    `Assigned via AP Copilot to ${user}`, discrepancyId,
    { source: 'ASSISTANT', executedBy: user, conversationId });

  if (conversationId) {
    await db.run(INSERT.into('ir.AssistantAction').entries({
      ID: cds.utils.uuid(), conversation_ID: conversationId,
      invoiceId: disc.invoice_ID, action: 'assign_to_me',
      executedAt: now, executedBy: user,
    }));
  }

  log.info({ discrepancyId, user }, 'Discrepancy assigned via AP Copilot');
  return { success: true, message: `Assigned to ${user}` };
}

async function executeSubmitFeedback(
  args: Record<string, unknown>, db: any, req: any
): Promise<unknown> {
  const discrepancyId = String(args.discrepancyId);
  const aiWasCorrect = Boolean(args.aiWasCorrect);
  const feedbackCategory = String(args.feedbackCategory ?? 'CORRECT');
  const user = req.user?.id ?? 'unknown';
  const role = req.user?.is?.('AP_MANAGER') || req.user?.is?.('ADMIN') ? 'AP_MANAGER' : 'AP_CLERK';

  const disc = await db.run(SELECT.one.from('ir.Discrepancy').where({ ID: discrepancyId }));
  if (!disc) return { success: false, message: `Discrepancy ${discrepancyId} not found` };

  await db.run(INSERT.into('ir.EvalFeedback').entries({
    ID: cds.utils.uuid(),
    discrepancy_ID: discrepancyId,
    trace_ID: disc.trace_ID ?? null,
    aiWasCorrect,
    feedbackCategory,
    feedbackNotes: null,
    submittedBy: user,
    role,
  }));

  log.info({ discrepancyId, aiWasCorrect, user }, 'Feedback submitted via AP Copilot');
  return { success: true };
}
// Tool Dispatcher
async function executeToolCall(
  name: string, args: Record<string, unknown>, db: any, req: any, conversationId?: string
): Promise<unknown> {
  switch (name) {
    case 'query_work_items':           return executeQueryWorkItems(args, db);
    case 'get_invoice_discrepancies':  return executeGetDiscrepancies(args, db);
    case 'get_invoice_timeline':       return executeGetTimeline(args, db);
    case 'accept_correction':          return executeAcceptCorrection(args, db, req, conversationId);
    case 'escalate_discrepancy':       return executeEscalate(args, db, req, conversationId);
    case 'reject_invoice':             return executeRejectInvoice(args, db, req, conversationId);
    case 'assign_to_me':               return executeAssignToMe(args, db, req, conversationId);
    case 'submit_feedback':            return executeSubmitFeedback(args, db, req);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
// Tool Call Loop
interface ToolCallLoopResult {
  finalText: string;
  toolResults: Array<{ toolName: string; result: unknown }>;
  totalTokens: { prompt: number; completion: number };
}

async function runToolCallLoop(
  systemPrompt: string,
  messages: AIToolMessage[],
  tools: AIToolDefinition[],
  db: any,
  req: any,
  maxIterations = 10,
  conversationId?: string,
): Promise<ToolCallLoopResult> {
  const allToolResults: Array<{ toolName: string; result: unknown }> = [];
  let totalPrompt = 0;
  let totalCompletion = 0;

  for (let i = 0; i < maxIterations; i++) {
    log.debug({ iteration: i, messageCount: messages.length }, 'Tool call loop iteration');

    const response: AIToolCompletionResponse = await completeWithToolsFallback({
      system: systemPrompt,
      messages,
      tools,
      maxTokens: 4096,
      temperature: 0.1,
    });

    totalPrompt += response.promptTokens;
    totalCompletion += response.completionTokens;

    // No tool calls — we have the final response
    if (response.toolCalls.length === 0) {
      return {
        finalText: response.content ?? '',
        toolResults: allToolResults,
        totalTokens: { prompt: totalPrompt, completion: totalCompletion },
      };
    }

    // Append assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.content ?? '',
      toolCalls: response.toolCalls,
    });

    // Execute each tool call and append results
    for (const toolCall of response.toolCalls) {
      log.debug({ tool: toolCall.name, args: toolCall.arguments }, 'Executing tool call');
      let result: unknown;
      try {
        result = await executeToolCall(toolCall.name, toolCall.arguments, db, req, conversationId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ tool: toolCall.name, err }, 'Tool execution failed');
        result = { error: msg };
      }
      allToolResults.push({ toolName: toolCall.name, result });
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Safety: max iterations reached
  log.warn({ maxIterations }, 'Tool call loop reached max iterations');
  return {
    finalText: 'I reached the maximum number of processing steps. Here is what I found so far.',
    toolResults: allToolResults,
    totalTokens: { prompt: totalPrompt, completion: totalCompletion },
  };
}
// Response Parsing
interface ParsedAssistantResponse {
  response: string;
  richContent: string | null;
  suggestedBubbles: string;
}

const DEFAULT_BUBBLES = [
  { label: 'Show work queue', prompt: 'Show me the current work queue' },
  { label: 'Critical invoices', prompt: 'Show me all critical risk invoices' },
];

function parseAssistantResponse(rawText: string): ParsedAssistantResponse {
  // Try to parse as JSON first (the LLM should respond in our structured format)
  try {
    // Strip markdown code fences if present
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    return {
      response: parsed.response ?? rawText,
      richContent: parsed.richContent ? JSON.stringify(parsed.richContent) : null,
      suggestedBubbles: JSON.stringify(parsed.suggestedBubbles ?? DEFAULT_BUBBLES),
    };
  } catch {
    // LLM didn't return valid JSON — use the raw text as the response
    log.warn('Failed to parse Assistant response as JSON, using raw text');
    return {
      response: rawText,
      richContent: null,
      suggestedBubbles: JSON.stringify(DEFAULT_BUBBLES),
    };
  }
}
// Service Implementation
export default cds.service.impl(async function AssistantServiceImpl(this: any) {

  // Start Conversation
  this.on('startConversation', async (req: any) => {
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const id = cds.utils.uuid();
    const now = new Date().toISOString();

    await db.run(INSERT.into('ir.AssistantConversation').entries({
      ID: id,
      userId: user,
      startedAt: now,
      status: 'ACTIVE',
      createdAt: now,
      createdBy: user,
      modifiedAt: now,
      modifiedBy: user,
    }));

    log.info({ conversationId: id, user }, 'Conversation started');
    return { conversationId: id };
  });

  // Close Conversation
  this.on('closeConversation', async (req: any) => {
    const { conversationId } = req.data as { conversationId: string };
    if (!conversationId) return req.error(400, 'conversationId is required');

    const db = await cds.connect.to('db');
    const now = new Date().toISOString();
    const user = req.user?.id ?? 'unknown';

    await db.run(UPDATE('ir.AssistantConversation').set({
      endedAt: now, status: 'CLOSED', modifiedAt: now, modifiedBy: user,
    }).where({ ID: conversationId }));

    log.info({ conversationId }, 'Conversation closed');
    return { success: true };
  });

  // Welcome Insights (stub)
  this.on('getWelcomeInsights', async () => {
    const db = await cds.connect.to('db');
    const pending = await db.run(
      SELECT.from('ir.Discrepancy').where({ reviewStatus: 'PENDING' })
    );
    const critical = pending.filter((d: any) => d.riskTier === 'CRITICAL');
    const auto = pending.filter((d: any) => d.agentDecision === 'AUTO_CORRECTED');
    return { pending: pending.length, critical: critical.length, autoCorrections: auto.length };
  });

  // Chat
  this.on('chat', async (req: any) => {
    const { message, conversationHistory, conversationId } = req.data as {
      message: string;
      conversationHistory?: Array<{
        role: string;
        content: string;
        richContent?: string;
        suggestedBubbles?: string;
      }>;
      conversationId?: string;
    };

    if (!message?.trim()) {
      return req.error(400, 'Message is required');
    }

    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';

    // Build message history — prefer DB persistence if conversationId is provided
    const messages: AIToolMessage[] = [];

    if (conversationId) {
      // Load persisted messages from DB
      const dbMessages = await db.run(
        SELECT.from('ir.AssistantMessage')
          .where({ conversation_ID: conversationId })
          .orderBy('timestamp asc')
      );
      for (const m of dbMessages) {
        if (m.role === 'user') {
          messages.push({ role: 'user', content: m.content ?? '' });
        } else if (m.role === 'assistant') {
          messages.push({ role: 'assistant', content: m.content ?? '' });
        }
      }
    } else if (conversationHistory) {
      // Backward-compat: use in-memory history from frontend
      for (const msg of conversationHistory) {
        if (msg.role === 'user') {
          messages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          messages.push({ role: 'assistant', content: msg.content });
        }
      }
    }

    // Append the new user message
    messages.push({ role: 'user', content: message });

    log.info({ messageLength: message.length, historyLength: messages.length - 1, conversationId }, 'AP Copilot chat request');

    // Persist user message if conversation is tracked
    if (conversationId) {
      const now = new Date().toISOString();
      await db.run(INSERT.into('ir.AssistantMessage').entries({
        ID: cds.utils.uuid(),
        conversation_ID: conversationId,
        role: 'user',
        content: message,
        timestamp: now,
      }));

      // Auto-set conversation title from first user message
      const conv = await db.run(
        SELECT.one.from('ir.AssistantConversation').where({ ID: conversationId })
      );
      if (conv && !conv.title) {
        const title = message.length > 200 ? message.slice(0, 197) + '...' : message;
        await db.run(UPDATE('ir.AssistantConversation').set({
          title, modifiedAt: now, modifiedBy: user,
        }).where({ ID: conversationId }));
      }
    }

    try {
      // Run the tool call loop
      const result = await runToolCallLoop(
        SYSTEM_PROMPT, messages, TOOL_DEFINITIONS, db, req, 10, conversationId
      );

      log.info({
        toolCalls: result.toolResults.length,
        promptTokens: result.totalTokens.prompt,
        completionTokens: result.totalTokens.completion,
      }, 'AP Copilot chat response generated');

      // Parse the LLM's structured response
      const parsed = parseAssistantResponse(result.finalText);

      // Persist assistant response if conversation is tracked
      if (conversationId) {
        await db.run(INSERT.into('ir.AssistantMessage').entries({
          ID: cds.utils.uuid(),
          conversation_ID: conversationId,
          role: 'assistant',
          content: parsed.response,
          richContent: parsed.richContent,
          suggestedBubbles: parsed.suggestedBubbles,
          timestamp: new Date().toISOString(),
        }));
      }

      return {
        response: parsed.response,
        richContent: parsed.richContent,
        suggestedBubbles: parsed.suggestedBubbles,
        conversationId: conversationId ?? null,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'AP Copilot chat error');

      const errorResponse = `I encountered an error processing your request: ${errMsg}`;

      // Persist error response if conversation is tracked
      if (conversationId) {
        await db.run(INSERT.into('ir.AssistantMessage').entries({
          ID: cds.utils.uuid(),
          conversation_ID: conversationId,
          role: 'assistant',
          content: errorResponse,
          timestamp: new Date().toISOString(),
        }));
      }

      return {
        response: errorResponse,
        richContent: null,
        suggestedBubbles: JSON.stringify(DEFAULT_BUBBLES),
        conversationId: conversationId ?? null,
      };
    }
  });
});
