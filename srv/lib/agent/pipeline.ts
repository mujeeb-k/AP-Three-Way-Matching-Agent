import cds from '@sap/cds';
import type {
  InvoiceInput, PipelineContext, PipelineResult, PipelineStepName,
  PipelineStepRecord,
} from './types.js';
import { loadConfig } from './config.js';
import { runDetectors } from './discrepancy/index.js';
import { normaliseSeparators } from './parsing/separator-normaliser.js';
import { diagnose } from './diagnosis/index.js';
import { resolve } from './resolution/index.js';
import { getAdapter } from '../adapters/index.js';
import { getAIProvider } from '../ai/index.js';
import { childLogger } from '../util/logger.js';
import { PipelineError } from '../util/errors.js';
import { isWithinTolerance } from '../util/currency.js';

const log = childLogger('agent:pipeline');

// ─────────────────────────────────────────────────────────────────────────────
// 7-Step Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function runPipeline(
  invoiceInput: InvoiceInput,
  existingInvoiceId?: string,  // If reprocessing
): Promise<PipelineResult> {
  const startedAt = new Date();

  const ctx: PipelineContext = {
    invoice: invoiceInput,
    invoiceDbId: existingInvoiceId,
    candidates: [],
    steps: [],
    startedAt,
    config: await loadConfig(),
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  };

  try {
    // ── Step 1: PARSE_PAYLOAD ───────────────────────────────────────────────
    await runStep(ctx, 'PARSE_PAYLOAD', async () => {
      validateInvoice(ctx.invoice);
      ctx.invoiceDbId = ctx.invoiceDbId ?? await persistInvoicePayload(ctx.invoice);
      return { invoiceId: ctx.invoiceDbId };
    });

    // ── Step 2: FETCH_REFERENCE ─────────────────────────────────────────────
    await runStep(ctx, 'FETCH_REFERENCE', async () => {
      const adapter = await getAdapter();
      const { poNumber, companyCode, vendorId } = ctx.invoice;

      const [po, grs, vendor, historical] = await Promise.allSettled([
        poNumber ? adapter.getPurchaseOrder(poNumber, companyCode) : Promise.resolve(null),
        poNumber ? adapter.getGoodsReceipts(poNumber, companyCode) : Promise.resolve([]),
        adapter.getVendorMaster(vendorId, companyCode),
        adapter.getRecentInvoices(vendorId, companyCode, 90),
      ]);

      ctx.reference = {
        purchaseOrder:  po.status === 'fulfilled' ? po.value : null,
        goodsReceipts:  grs.status === 'fulfilled' ? grs.value : [],
        vendor:         vendor.status === 'fulfilled' ? vendor.value : null,
        additionalPOs:  {},
      };

      // Fetch additional POs for multi-PO invoices
      if (ctx.invoice.poReferences && ctx.invoice.poReferences.length > 1) {
        const adapter2 = await getAdapter();
        await Promise.allSettled(
          ctx.invoice.poReferences
            .filter(ref => ref.poNumber !== poNumber)
            .map(async ref => {
              try {
                const addlPo = await adapter2.getPurchaseOrder(ref.poNumber, companyCode);
                ctx.reference!.additionalPOs[ref.poNumber] = addlPo;
              } catch { /* non-fatal */ }
            })
        );
      }

      return {
        poFound: !!ctx.reference.purchaseOrder,
        grCount: ctx.reference.goodsReceipts.length,
        vendorFound: !!ctx.reference.vendor,
        historicalCount: historical.status === 'fulfilled' ? historical.value.length : 0,
        historical: historical.status === 'fulfilled' ? historical.value : [],
      };
    });

    // ── Step 3: RUN_DETECTORS ───────────────────────────────────────────────
    await runStep(ctx, 'RUN_DETECTORS', async (stepOutput) => {
      const ai = await getAIProvider();
      const { purchaseOrder, goodsReceipts, vendor } = ctx.reference!;
      const historical = (stepOutput as any)?.historical ?? [];  // Passed from step 2

      // ── Pre-detector: separator normalisation ──────────────────────────────
      // Runs before all detectors. Normalises mis-parsed numeric separators by
      // comparing against PO reference values. Mutates ctx.invoice.lines in-place
      // and queues timeline events + SEPARATOR_AMBIGUITY candidates.
      const separatorNormalisationEvents: string[] = [];
      if (purchaseOrder) {
        const normResult = normaliseSeparators(ctx.invoice, purchaseOrder);
        // Replace lines with normalised version
        ctx.invoice = { ...ctx.invoice, lines: normResult.normalisedLines };
        // Accumulate timeline events for PERSIST_TRACE step
        (ctx as any)._normalisationEvents = normResult.timelineEvents;
        for (const ev of normResult.timelineEvents) {
          separatorNormalisationEvents.push(ev.summary);
        }
        // Add SEPARATOR_AMBIGUITY candidates directly to pipeline candidates
        for (const c of normResult.ambiguousCandidates) {
          ctx.candidates.push(c);
        }
      }

      ctx.candidates.push(...await runDetectors(
        ctx.invoice,
        purchaseOrder,
        goodsReceipts,
        vendor,
        historical,
        ai,
        ctx.config,
      ));

      // Track tokens used by FIELD_SWAP LLM call (if any)
      // (token accounting is done in detectFieldSwap via ai.complete)

      return { candidateCount: ctx.candidates.length, types: ctx.candidates.map(c => c.discrepancyType), separatorNormalisationEvents };
    });

    // ── Step 4: LLM_REASON ─────────────────────────────────────────────────
    // Note: LLM calls for FIELD_SWAP already happened in Step 3.
    // This step handles any additional LLM reasoning (currently a pass-through).
    await runStep(ctx, 'LLM_REASON', async () => {
      const reasoned = ctx.candidates.filter(c => c.llmReasoned).length;
      return { llmCallsMade: reasoned };
    });

    // ── Step 5: DIAGNOSE ────────────────────────────────────────────────────
    await runStep(ctx, 'DIAGNOSE', async () => {
      // Check for within-tolerance candidates → AUTO_RESOLVED
      const autoResolved = checkAutoResolved(ctx);

      diagnose(ctx.candidates, ctx.invoice.totalAmount, ctx.config);

      return {
        candidatesAfterTolerance: ctx.candidates.length,
        autoResolved,
        riskTiers: ctx.candidates.map(c => ({ type: c.discrepancyType, tier: c.riskTier })),
      };
    });

    // ── Step 6: DECIDE_ACT ──────────────────────────────────────────────────
    await runStep(ctx, 'DECIDE_ACT', async () => {
      if (ctx.candidates.length === 0) {
        ctx.finalDecision = 'NO_DISCREPANCY';
        return { finalDecision: ctx.finalDecision };
      }

      const result = resolve(ctx.invoice, ctx.candidates, ctx.config);
      ctx.candidates = result.candidates;
      ctx.finalDecision = result.finalDecision;
      ctx.invoice = result.correctedInvoice;

      // Handle PENDING_GR — set pendingGrSince on InvoicePayload
      const hasPendingGr = ctx.candidates.some(c => c.agentDecision === 'PENDING_GR');
      if (hasPendingGr && ctx.invoiceDbId) {
        await markPendingGr(ctx.invoiceDbId);
      }

      return {
        finalDecision: ctx.finalDecision,
        decisions: ctx.candidates.map(c => ({ type: c.discrepancyType, decision: c.agentDecision })),
      };
    });

    // ── Step 7: PERSIST_TRACE ───────────────────────────────────────────────
    const traceId = await runStep(ctx, 'PERSIST_TRACE', async () => {
      const id = await persistTrace(ctx);
      return { traceId: id };
    }) as string;

    const durationMs = Date.now() - startedAt.getTime();
    log.info({ invoiceId: ctx.invoiceDbId, decision: ctx.finalDecision, durationMs }, 'Pipeline complete');

    return {
      invoiceId: ctx.invoiceDbId!,
      finalDecision: ctx.finalDecision ?? 'NO_DISCREPANCY',
      discrepancyCount: ctx.candidates.length,
      candidates: ctx.candidates,
      traceId,
      durationMs,
      promptTokens: ctx.totalPromptTokens,
      completionTokens: ctx.totalCompletionTokens,
    };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, invoiceId: ctx.invoiceDbId }, 'Pipeline failed');

    if (ctx.invoiceDbId) {
      await markFailed(ctx.invoiceDbId, message);
    }

    return {
      invoiceId: ctx.invoiceDbId ?? '',
      finalDecision: 'FLAGGED_REVIEW',
      discrepancyCount: 0,
      candidates: [],
      durationMs: Date.now() - startedAt.getTime(),
      promptTokens: 0,
      completionTokens: 0,
      error: message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step runner — wraps each step with timing + error capture
// ─────────────────────────────────────────────────────────────────────────────

async function runStep(
  ctx: PipelineContext,
  stepName: PipelineStepName,
  fn: (prevOutput?: unknown) => Promise<unknown>,
): Promise<unknown> {
  const prevStep = ctx.steps[ctx.steps.length - 1];
  const stepRecord: PipelineStepRecord = {
    stepName,
    startedAt: new Date(),
    input: prevStep?.output ?? null,
    output: null,
  };
  ctx.steps.push(stepRecord);

  try {
    const output = await fn(prevStep?.output);
    stepRecord.output = output;
    stepRecord.completedAt = new Date();
    stepRecord.durationMs = stepRecord.completedAt.getTime() - stepRecord.startedAt.getTime();
    return output;
  } catch (err: unknown) {
    stepRecord.error = err instanceof Error ? err.message : String(err);
    stepRecord.completedAt = new Date();
    stepRecord.durationMs = stepRecord.completedAt.getTime() - stepRecord.startedAt.getTime();
    throw new PipelineError(`Step ${stepName} failed: ${stepRecord.error}`, stepName);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateInvoice(invoice: InvoiceInput): void {
  if (!invoice.vendorId) throw new PipelineError('vendorId is required', 'PARSE_PAYLOAD');
  if (!invoice.companyCode) throw new PipelineError('companyCode is required', 'PARSE_PAYLOAD');
  if (!invoice.currency) throw new PipelineError('currency is required', 'PARSE_PAYLOAD');
  if (!invoice.lines || invoice.lines.length === 0) {
    throw new PipelineError('invoice must have at least one line', 'PARSE_PAYLOAD');
  }
}

/**
 * Check candidates for within-tolerance variance — remove them and
 * create AUTO_RESOLVED records instead (full audit trail, no human needed).
 */
function checkAutoResolved(ctx: PipelineContext): number {
  const { config } = ctx;
  const toRemove: number[] = [];

  ctx.candidates.forEach((c, i) => {
    if (c.discrepancyType === 'PRICE_VARIANCE') {
      const f = c.detectedFields.find(d => d.field === 'unitPrice');
      if (f && isWithinTolerance(f.invoiceValue as number, f.expectedValue as number, config.tolPricePct, config.tolPriceAbs)) {
        c.agentDecision = 'AUTO_RESOLVED';
        c.decisionReason = `Price variance within tolerance (${config.tolPricePct}% / ${config.tolPriceAbs} EUR)`;
        toRemove.push(i);
      }
    } else if (c.discrepancyType === 'QTY_VARIANCE') {
      const f = c.detectedFields.find(d => d.field === 'quantity');
      if (f && isWithinTolerance(f.invoiceValue as number, f.expectedValue as number, config.tolQtyPct, config.tolQtyAbs)) {
        c.agentDecision = 'AUTO_RESOLVED';
        c.decisionReason = `Quantity variance within tolerance (${config.tolQtyPct}% / ${config.tolQtyAbs} EUR)`;
        toRemove.push(i);
      }
    }
  });

  // Remove auto-resolved from active candidates (they'll still be persisted)
  // Keep them in ctx.candidates but mark agentDecision — diagnose will skip riskTier assignment
  return toRemove.length;
}

async function persistInvoicePayload(invoice: InvoiceInput): Promise<string> {
  const db = await cds.connect.to('db');
  const id = cds.utils.uuid();

  await db.run(INSERT.into('ir.InvoicePayload').entries({
    ID: id,
    source: invoice.source,
    externalId: invoice.externalId,
    receivedAt: new Date().toISOString(),
    rawPayload: invoice.rawPayload,
    vendorId: invoice.vendorId,
    vendorInvoiceNo: invoice.vendorInvoiceNo,
    invoiceDate: invoice.invoiceDate,
    postingDate: invoice.postingDate,
    companyCode: invoice.companyCode,
    currency: invoice.currency,
    totalAmount: invoice.totalAmount,
    taxAmount: invoice.taxAmount,
    netAmount: invoice.netAmount,
    poNumber: invoice.poNumber,
    isMultiPo: invoice.isMultiPo ?? false,
    processingStatus: 'PROCESSING',
  }));

  // Insert lines
  if (invoice.lines.length > 0) {
    await db.run(INSERT.into('ir.InvoicePayloadLine').entries(
      invoice.lines.map(l => ({
        ID: cds.utils.uuid(),
        invoice_ID: id,
        lineNumber: l.lineNumber,
        materialNumber: l.materialNumber,
        description: l.description,
        quantity: l.quantity,
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: l.unitPrice,
        netAmount: l.netAmount,
        poLine: l.poLine,
      }))
    ));
  }

  return id;
}

async function persistTrace(ctx: PipelineContext): Promise<string> {
  const db = await cds.connect.to('db');
  const traceId = cds.utils.uuid();
  const now = new Date().toISOString();
  const ai = await getAIProvider();

  // AgentTrace
  await db.run(INSERT.into('ir.AgentTrace').entries({
    ID: traceId,
    invoice_ID: ctx.invoiceDbId,
    startedAt: ctx.startedAt.toISOString(),
    completedAt: now,
    durationMs: Date.now() - ctx.startedAt.getTime(),
    aiProvider: ai.providerName,
    modelUsed: ai.modelId,
    promptTokens: ctx.totalPromptTokens,
    completionTokens: ctx.totalCompletionTokens,
    totalTokensUsed: ctx.totalPromptTokens + ctx.totalCompletionTokens,
    summary: buildTraceSummary(ctx),
  }));

  // AgentSteps
  if (ctx.steps.length > 0) {
    await db.run(INSERT.into('ir.AgentStep').entries(
      ctx.steps.map((s, i) => ({
        ID: cds.utils.uuid(),
        trace_ID: traceId,
        stepOrder: i + 1,
        stepName: s.stepName,
        input: JSON.stringify(s.input),
        output: JSON.stringify(s.output),
        durationMs: s.durationMs,
        error: s.error,
      }))
    ));
  }

  // Discrepancy records
  for (const candidate of ctx.candidates) {
    const discId = cds.utils.uuid();
    await db.run(INSERT.into('ir.Discrepancy').entries({
      ID: discId,
      invoice_ID: ctx.invoiceDbId,
      discrepancyType: candidate.discrepancyType,
      riskTier: candidate.riskTier ?? 'MEDIUM',
      riskRationale: candidate.riskRationale,
      confidence: candidate.llmConfidence ?? candidate.rulesConfidence,
      detectedFields: JSON.stringify(candidate.detectedFields),
      description: candidate.description,
      agentDecision: candidate.agentDecision,
      decisionReason: candidate.decisionReason,
      correctionsApplied: JSON.stringify(candidate.proposedCorrections),
      reviewStatus: candidate.agentDecision === 'AUTO_RESOLVED' ? 'RESOLVED' : 'PENDING',
      trace_ID: traceId,
    }));
  }

  // Update InvoicePayload.processingStatus → COMPLETED
  await db.run(
    UPDATE('ir.InvoicePayload').set({
      processingStatus: 'COMPLETED',
      processedAt: now,
      trace_ID: traceId,
    }).where({ ID: ctx.invoiceDbId })
  );

  // InvoiceEvent: separator normalisation events (one per normalised field)
  const normEvents = (ctx as any)._normalisationEvents as Array<{ lineNumber: number; field: string; summary: string }> | undefined;
  if (normEvents && normEvents.length > 0) {
    await db.run(INSERT.into('ir.InvoiceEvent').entries(
      normEvents.map(ev => ({
        ID: cds.utils.uuid(),
        invoice_ID: ctx.invoiceDbId,
        eventType: 'NORMALISED',
        eventAt: now,
        actor: 'AGENT',
        actorRole: 'AGENT',
        summary: ev.summary,
        detail: JSON.stringify({ lineNumber: ev.lineNumber, field: ev.field }),
      }))
    ));
  }

  // InvoiceEvent: AGENT_ANALYZED
  await db.run(INSERT.into('ir.InvoiceEvent').entries({
    ID: cds.utils.uuid(),
    invoice_ID: ctx.invoiceDbId,
    eventType: 'AGENT_ANALYZED',
    eventAt: now,
    actor: 'AGENT',
    actorRole: 'AGENT',
    summary: buildTraceSummary(ctx),
    detail: JSON.stringify({ traceId, decision: ctx.finalDecision }),
  }));

  return traceId;
}

async function markPendingGr(invoiceId: string): Promise<void> {
  const db = await cds.connect.to('db');
  await db.run(
    UPDATE('ir.InvoicePayload').set({
      pendingGrSince: new Date().toISOString(),
    }).where({ ID: invoiceId })
  );
  await db.run(INSERT.into('ir.InvoiceEvent').entries({
    ID: cds.utils.uuid(),
    invoice_ID: invoiceId,
    eventType: 'PENDING_GR',
    eventAt: new Date().toISOString(),
    actor: 'AGENT',
    actorRole: 'AGENT',
    summary: 'Invoice parked — awaiting goods receipt. Will reprocess automatically when GR is posted.',
  }));
}

async function markFailed(invoiceId: string, error: string): Promise<void> {
  try {
    const db = await cds.connect.to('db');
    await db.run(
      UPDATE('ir.InvoicePayload').set({
        processingStatus: 'FAILED',
        processingError: error.substring(0, 1000),
      }).where({ ID: invoiceId })
    );
  } catch { /* best-effort */ }
}

function buildTraceSummary(ctx: PipelineContext): string {
  if (ctx.candidates.length === 0) return 'No discrepancies detected — invoice is clean.';

  const parts = ctx.candidates.map(c =>
    `${c.discrepancyType} (${c.agentDecision}, ${c.riskTier})`
  );
  return `Detected ${ctx.candidates.length} discrepancy(s): ${parts.join('; ')}. Overall decision: ${ctx.finalDecision}.`;
}
