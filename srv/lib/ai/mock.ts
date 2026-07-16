import cds from '@sap/cds';
import type { IAIProvider, AICompletionRequest, AICompletionResponse, AIToolCompletionRequest, AIToolCompletionResponse } from './types.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('ai:mock');
// MockAIProvider
// Responds to user messages by querying the seeded SQLite DB directly.
// No API key required — works out of the box for demo purposes.
export class MockAIProvider implements IAIProvider {
  readonly providerName = 'MOCK';
  readonly modelId       = 'mock-demo-v1';

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const userMessage = request.messages.at(-1)?.content ?? '';
    const content = await buildResponse(userMessage);
    return {
      content,
      model:            this.modelId,
      promptTokens:     0,
      completionTokens: 0,
      totalTokens:      0,
      stopReason:       'stop',
    };
  }

  async completeWithTools(request: AIToolCompletionRequest): Promise<AIToolCompletionResponse> {
    // Find the last user message in the conversation
    const lastUser = [...request.messages].reverse().find(m => m.role === 'user');
    const userMessage = (lastUser?.role === 'user' ? lastUser.content : '') ?? '';

    log.debug({ userMessage }, 'Mock provider handling message');

    const content = await buildResponse(userMessage);
    return {
      content,
      toolCalls:        [],   // no tool calls — mock handles everything inline
      model:            this.modelId,
      promptTokens:     0,
      completionTokens: 0,
      totalTokens:      0,
      stopReason:       'stop',
    };
  }
}
// Response builder — queries seeded DB and formats assistant JSON responses
async function buildResponse(userMessage: string): Promise<string> {
  const q = userMessage.toLowerCase();

  try {
    const db = await cds.connect.to('db');

    // Intent: critical / urgent
    if (q.includes('critical') || q.includes('urgent') || q.includes('immediate')) {
      const items = await queryCriticalItems(db);
      return formatInvoiceList(
        items,
        `Found ${items.length} critical item${items.length !== 1 ? 's' : ''} requiring immediate attention.`,
        [
          { label: 'Escalate top item', prompt: 'Escalate the first critical invoice to a manager' },
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
          { label: 'Show high risk too', prompt: 'Show me critical and high risk invoices' },
        ]
      );
    }

    // Intent: escalated
    if (q.includes('escalat')) {
      const items = await queryByDecision(db, 'ESCALATED');
      return formatInvoiceList(
        items,
        `${items.length} invoice${items.length !== 1 ? 's' : ''} currently escalated to manager review.`,
        [
          { label: 'Show critical items', prompt: 'Show me critical invoices' },
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
        ]
      );
    }

    // Intent: auto-correct
    if (q.includes('auto-correct') || q.includes('auto correct') || q.includes('correction')) {
      const items = await queryByDecision(db, 'AUTO_CORRECTED');
      return formatInvoiceList(
        items,
        `${items.length} invoice${items.length !== 1 ? 's' : ''} with AI-proposed corrections ready for acceptance.`,
        [
          { label: 'Accept all corrections', prompt: 'I want to accept all auto-corrected invoices' },
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
          { label: 'Show flagged items', prompt: 'Show me flagged invoices that need review' },
        ]
      );
    }

    // Intent: flagged / review
    if (q.includes('flagged') || q.includes('flag') || (q.includes('review') && !q.includes('history'))) {
      const items = await queryByDecision(db, 'FLAGGED_REVIEW');
      return formatInvoiceList(
        items,
        `${items.length} invoice${items.length !== 1 ? 's' : ''} flagged for manual review.`,
        [
          { label: 'Show auto-corrections', prompt: 'Show me invoices with auto-corrections ready' },
          { label: 'Show critical items', prompt: 'Show me critical invoices' },
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
        ]
      );
    }

    // Intent: accept / approve
    if (q.includes('accept') || q.includes('approv')) {
      const items = await queryByDecision(db, 'AUTO_CORRECTED');
      if (items.length === 0) {
        return jsonResponse('There are no auto-corrected invoices pending acceptance right now.', null, [
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
        ]);
      }
      const first = items[0];
      return jsonResponse(
        `Ready to accept the AI correction on invoice ${first.invoiceNumber} (${first.vendorId}) — ${first.discrepancyType?.replace(/_/g, ' ')} of ${first.currency} ${fmt(first.totalAmount)}. Confirm?`,
        {
          type: 'confirmation',
          data: {
            action:         'accept',
            invoiceNumber:  first.invoiceNumber,
            discrepancyId:  first.discrepancyId,
            invoiceId:      first.invoiceId,
            consequence:    `Discrepancy will be marked RESOLVED and correction applied.`,
          },
        },
        [
          { label: 'Yes, accept it', prompt: `Yes, accept the correction on ${first.invoiceNumber}` },
          { label: 'Skip this one', prompt: 'Show me the next auto-corrected invoice' },
          { label: 'Show all corrections', prompt: 'Show me all auto-corrected invoices' },
        ]
      );
    }

    // Intent: reject
    if (q.includes('reject')) {
      const items = await queryCriticalItems(db);
      if (items.length === 0) {
        return jsonResponse('No critical invoices to reject right now.', null, [
          { label: 'Show full queue', prompt: 'Show me the full work queue' },
        ]);
      }
      const first = items[0];
      return jsonResponse(
        `Rejecting invoice ${first.invoiceNumber} is a terminal action — all pending discrepancies on this invoice will be marked REJECTED and it will be returned to the vendor. Are you sure?`,
        {
          type: 'confirmation',
          data: {
            action:        'reject',
            invoiceNumber: first.invoiceNumber,
            discrepancyId: first.discrepancyId,
            invoiceId:     first.invoiceId,
            consequence:   'This invoice will be returned to the vendor. This cannot be undone.',
          },
        },
        [
          { label: 'Yes, reject it', prompt: `Yes, reject invoice ${first.invoiceNumber}` },
          { label: 'Cancel', prompt: 'Cancel — show me the work queue instead' },
        ]
      );
    }

    // Intent: summary / stats
    if (q.includes('summary') || q.includes('stats') || q.includes('overview') || q.includes('dashboard')) {
      const summary = await queryQueueSummary(db);
      return jsonResponse(
        `Queue summary: ${summary.total} invoices total — ${summary.critical} critical, ${summary.high} high risk, ${summary.autoCorrections} with auto-corrections ready, ${summary.escalated} escalated.`,
        null,
        [
          { label: 'Show critical items', prompt: 'Show me critical invoices' },
          { label: 'Review auto-corrections', prompt: 'Show me invoices with auto-corrections ready' },
          { label: 'View full queue', prompt: 'Show me the full work queue' },
        ]
      );
    }

    // Default / "show queue"
    const items = await queryAllWorkItems(db, 15);
    return formatInvoiceList(
      items,
      `Here's the current work queue — ${items.length} items shown, sorted by risk tier.`,
      [
        { label: 'Filter critical only', prompt: 'Show me critical invoices only' },
        { label: 'Review auto-corrections', prompt: 'Show me invoices with auto-corrections ready' },
        { label: 'Show escalated items', prompt: 'Show me escalated invoices' },
      ]
    );
  } catch (err) {
    log.error({ err }, 'Mock provider DB query failed');
    return jsonResponse(
      "I'm having trouble reading the invoice queue right now. Please try again in a moment.",
      null,
      [{ label: 'Try again', prompt: 'Show me the work queue' }]
    );
  }
}
// DB query helpers
type WorkItem = {
  invoiceId: string;
  invoiceNumber: string;
  vendorId: string;
  currency: string;
  totalAmount: number;
  riskTier: string;
  agentDecision: string;
  discrepancyType: string;
  discrepancyId: string;
  description: string;
};

const BASE_SQL = `
  SELECT d.ID as discrepancyId, d.invoice_ID as invoiceId,
         d.riskTier, d.agentDecision, d.discrepancyType, d.description,
         i.vendorInvoiceNo as invoiceNumber, i.vendorId, i.currency, i.totalAmount
  FROM ir_Discrepancy d
  LEFT JOIN ir_InvoicePayload i ON d.invoice_ID = i.ID
  WHERE d.reviewStatus IN ('PENDING', 'IN_REVIEW')
`;

const RISK_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sortByRisk(rows: WorkItem[]): WorkItem[] {
  return rows.sort((a, b) => (RISK_ORDER[a.riskTier] ?? 4) - (RISK_ORDER[b.riskTier] ?? 4));
}

async function queryAllWorkItems(db: any, limit = 15): Promise<WorkItem[]> {
  const rows: WorkItem[] = await db.run(BASE_SQL);
  return sortByRisk(rows).slice(0, limit);
}

async function queryCriticalItems(db: any): Promise<WorkItem[]> {
  const rows: WorkItem[] = await db.run(BASE_SQL + " AND d.riskTier = 'CRITICAL'");
  return rows;
}

async function queryByDecision(db: any, decision: string): Promise<WorkItem[]> {
  const rows: WorkItem[] = await db.run(BASE_SQL + ` AND d.agentDecision = '${decision}'`);
  return sortByRisk(rows);
}

async function queryQueueSummary(db: any): Promise<{
  total: number; critical: number; high: number; autoCorrections: number; escalated: number;
}> {
  const rows: Array<{ riskTier: string; agentDecision: string }> = await db.run(
    `SELECT riskTier, agentDecision FROM ir_Discrepancy WHERE reviewStatus IN ('PENDING', 'IN_REVIEW')`
  );
  return {
    total:           rows.length,
    critical:        rows.filter(r => r.riskTier === 'CRITICAL').length,
    high:            rows.filter(r => r.riskTier === 'HIGH').length,
    autoCorrections: rows.filter(r => r.agentDecision === 'AUTO_CORRECTED').length,
    escalated:       rows.filter(r => r.agentDecision === 'ESCALATED').length,
  };
}
// Response formatters
function formatInvoiceList(
  items: WorkItem[],
  responseText: string,
  bubbles: Array<{ label: string; prompt: string }>
): string {
  const richContent = items.length > 0
    ? {
        type: 'invoice_list',
        data: {
          items: items.map(i => ({
            discrepancyId:   i.discrepancyId,
            invoiceId:       i.invoiceId,
            invoiceNumber:   i.invoiceNumber,
            vendorId:        i.vendorId,
            currency:        i.currency,
            totalAmount:     i.totalAmount,
            riskTier:        i.riskTier,
            agentDecision:   i.agentDecision,
            discrepancyType: i.discrepancyType,
            description:     i.description,
          })),
        },
      }
    : null;

  return jsonResponse(responseText, richContent, bubbles);
}

function jsonResponse(
  response: string,
  richContent: unknown,
  suggestedBubbles: Array<{ label: string; prompt: string }>
): string {
  return JSON.stringify({ response, richContent: richContent ?? null, suggestedBubbles });
}

function fmt(n: number | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
