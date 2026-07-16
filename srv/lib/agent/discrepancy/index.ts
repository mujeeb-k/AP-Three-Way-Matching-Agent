import type { InvoiceInput, DiscrepancyCandidate, AgentRuntimeConfig, DiscrepancyTypeName } from '../types.js';
import type { PurchaseOrder, GoodsReceiptLine, VendorMaster, HistoricalInvoice } from '../../adapters/types.js';
import type { IAIProvider } from '../../ai/types.js';
import { detectFieldSwap } from './field-swap.js';
import { detectPriceVariance } from './price-variance.js';
import { detectQtyVariance, detectInvoiceVsPoAmount } from './qty-variance.js';
import { detectMissingGr, detectInvoiceBeforeGr } from './missing-gr.js';
import { detectWrongPoReference, detectEntityMismatch, detectCurrencyMismatch } from './wrong-po-reference.js';
import { detectDuplicate } from './duplicate.js';
import { detectLineStructure, detectMultiPo } from './line-structure.js';
import { detectUomMismatch } from './uom-detector.js';
import { detectMaterialMismatch } from './material-mismatch.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:dispatcher');

/**
 * RUN_DETECTORS step — dispatches to all enabled detectors and collects candidates.
 * Order matters: FIELD_SWAP runs last (LLM call) to avoid wasted tokens on invalid invoices.
 */
export async function runDetectors(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
  grs: GoodsReceiptLine[],
  vendor: VendorMaster | null,
  historicalInvoices: HistoricalInvoice[],
  ai: IAIProvider,
  config: AgentRuntimeConfig,
): Promise<DiscrepancyCandidate[]> {
  const enabled = new Set<DiscrepancyTypeName>(config.activeDiscrepancyTypes);
  const results: DiscrepancyCandidate[] = [];

  const add = (c: DiscrepancyCandidate | null) => { if (c) results.push(c); };
  const addAll = (cs: DiscrepancyCandidate[]) => results.push(...cs);

  // ── CRITICAL / blocking checks first ─────────────────────────────────────

  if (enabled.has('DUPLICATE')) {
    add(detectDuplicate(invoice, historicalInvoices));
  }

  if (enabled.has('WRONG_PO_REFERENCE')) {
    addAll(detectWrongPoReference(invoice, po));
  }

  if (enabled.has('ENTITY_MISMATCH')) {
    add(detectEntityMismatch(invoice, po));
  }

  if (enabled.has('CURRENCY_MISMATCH')) {
    add(detectCurrencyMismatch(invoice, po));
  }

  // ── GR-dependent checks ───────────────────────────────────────────────────

  if (enabled.has('MISSING_GR')) {
    add(detectMissingGr(invoice, grs));
  }

  if (enabled.has('INVOICE_BEFORE_GR')) {
    add(detectInvoiceBeforeGr(invoice, grs));
  }

  // ── Line-level checks ─────────────────────────────────────────────────────

  if (enabled.has('MULTI_PO')) {
    add(detectMultiPo(invoice));
  }

  if (enabled.has('LINE_STRUCTURE') && po) {
    add(detectLineStructure(invoice, po));
  }

  if (enabled.has('MATERIAL_MISMATCH') && po) {
    addAll(detectMaterialMismatch(invoice, po, grs));
  }

  if (enabled.has('QTY_VARIANCE') && po) {
    addAll(detectQtyVariance(invoice, po, grs, config));
  }

  if (enabled.has('PRICE_VARIANCE') && po) {
    addAll(detectPriceVariance(invoice, po, grs, config));
    // Also compare invoice and PO totals against configured tolerances.
    add(detectInvoiceVsPoAmount(invoice, po, config));
  }

  // ── LLM-assisted check last ───────────────────────────────────────────────

  if (enabled.has('FIELD_SWAP') && po) {
    const swap = await detectFieldSwap(invoice, po, vendor, ai, config);
    add(swap);
  }

  // ── UOM check (after line-level, before FIELD_SWAP to avoid double-flagging) ─

  if (enabled.has('UOM_MISMATCH') && po) {
    add(detectUomMismatch(invoice, po));
  }

  log.debug({ count: results.length }, 'Detectors complete');
  return results;
}
