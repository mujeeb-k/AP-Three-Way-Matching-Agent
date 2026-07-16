import cds from '@sap/cds';
import { runPipeline } from './lib/agent/index.js';
import { getAdapter } from './lib/adapters/index.js';
import { getAIProvider } from './lib/ai/index.js';
import type { InvoiceInput } from './lib/agent/types.js';
import { childLogger } from './lib/util/logger.js';

const log = childLogger('agent-service');

export default cds.service.impl(async function AgentServiceImpl(this: any) {

  // ── action processInvoice ────────────────────────────────────────────────
  this.on('processInvoice', async (req: any) => {
    const { payload, source = 'API', externalId } = req.data as {
      payload: string;
      source: string;
      externalId?: string;
    };

    let invoiceInput: InvoiceInput;
    try {
      invoiceInput = JSON.parse(payload) as InvoiceInput;
    } catch (err) {
      return req.error(400, `Invalid JSON payload: ${(err as Error).message}`);
    }

    // Apply source + externalId from action params (override what's in payload)
    invoiceInput.source = (source as InvoiceInput['source']) ?? invoiceInput.source ?? 'API';
    if (externalId) invoiceInput.externalId = externalId;

    log.info({ source: invoiceInput.source, poNumber: invoiceInput.poNumber }, 'processInvoice called');

    try {
      const result = await runPipeline(invoiceInput);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'processInvoice pipeline error');
      return req.error(500, `Pipeline error: ${msg}`);
    }
  });

  // ── action reprocessInvoice ──────────────────────────────────────────────
  this.on('reprocessInvoice', async (req: any) => {
    const { invoiceId } = req.data as { invoiceId: string };
    const db = await cds.connect.to('db');

    // Load existing invoice + lines from DB
    const inv = await db.run(
      SELECT.one.from('ir.InvoicePayload').where({ ID: invoiceId })
    );
    if (!inv) return req.error(404, `Invoice ${invoiceId} not found`);

    const lines = await db.run(
      SELECT.from('ir.InvoicePayloadLine')
        .where({ invoice_ID: invoiceId })
        .orderBy('lineNumber asc')
    );

    const poRefs = await db.run(
      SELECT.from('ir.InvoicePoReference').where({ invoice_ID: invoiceId })
    );

    const invoiceInput: InvoiceInput = {
      externalId:     inv.externalId,
      vendorInvoiceNo:inv.vendorInvoiceNo,
      source:         inv.source,
      vendorId:       inv.vendorId,
      companyCode:    inv.companyCode,
      currency:       inv.currency,
      invoiceDate:    inv.invoiceDate,
      postingDate:    inv.postingDate,
      totalAmount:    Number(inv.totalAmount),
      taxAmount:      inv.taxAmount  != null ? Number(inv.taxAmount)  : undefined,
      netAmount:      inv.netAmount  != null ? Number(inv.netAmount)  : undefined,
      poNumber:       inv.poNumber,
      isMultiPo:      inv.isMultiPo ?? false,
      poReferences:   poRefs.map((r: any) => ({
        poNumber: r.poNumber,
        poLineFrom: r.poLineFrom,
        poLineTo: r.poLineTo,
      })),
      lines: lines.map((l: any) => ({
        lineNumber:    l.lineNumber,
        materialNumber:l.materialNumber,
        description:   l.description,
        quantity:      Number(l.quantity),
        unitOfMeasure: l.unitOfMeasure,
        unitPrice:     Number(l.unitPrice),
        netAmount:     Number(l.netAmount),
        poLine:        l.poLine,
      })),
      rawPayload: inv.rawPayload,
    };

    log.info({ invoiceId, poNumber: invoiceInput.poNumber }, 'reprocessInvoice called');

    try {
      const result = await runPipeline(invoiceInput, invoiceId);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, invoiceId }, 'reprocessInvoice pipeline error');
      return req.error(500, `Pipeline error: ${msg}`);
    }
  });

  // ── function health ──────────────────────────────────────────────────────
  this.on('health', async (_req: any) => {
    try {
      const adapter = await getAdapter();
      const ai = await getAIProvider();
      return {
        status:    'ok',
        adapter:   adapter.adapterType,
        aiProvider:ai.providerName,
        modelId:   ai.modelId,
      };
    } catch {
      return {
        status:    'error',
        adapter:   'unknown',
        aiProvider:'unknown',
        modelId:   'unknown',
      };
    }
  });

  // ── before UPDATE AgentConfigs — write change log row ────────────────────
  this.before('UPDATE', 'AgentConfigs', async (req: any) => {
    if (req.data.configValue === undefined) return;
    const db = await cds.connect.to('db');
    const id = req.params?.[0]?.ID ?? req.params?.[0];
    const current = await db.run(SELECT.one.from('ir.AgentConfig').where({ ID: id }));
    if (!current) return;
    if (current.configValue === req.data.configValue) return;
    await db.run(INSERT.into('ir.AgentConfigChangeLog').entries({
      ID:        cds.utils.uuid(),
      changedAt: new Date().toISOString(),
      changedBy: req.user?.id ?? 'unknown',
      configKey: current.configKey,
      oldValue:  current.configValue,
      newValue:  req.data.configValue,
    }));
  });
});
