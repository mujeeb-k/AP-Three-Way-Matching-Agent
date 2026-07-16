import type { InvoiceInput, DiscrepancyCandidate, AgentRuntimeConfig } from '../types.js';
import type { PurchaseOrder, GoodsReceiptLine } from '../../adapters/types.js';
import { isWithinTolerance, pctDiff, absDiff } from '../../util/currency.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:qty-variance');

/**
 * QTY_VARIANCE detector — rules-only.
 * Applies the configured quantity tolerance rules:
 *
 * 1. Invoice vs Receipt (tol_invoice_vs_receipt = 0%)
 *    Invoice quantities must match GR exactly.
 *
 * 2. Invoice vs PO Quantity (tol_inv_vs_po_qty_pct=10% OR tol_inv_vs_po_qty_abs=1 EUR/unit)
 *    Unit-based variance between invoice qty and PO ordered qty.
 *    Only fires if GR qty is also within PO tolerance (i.e. GR is not the problem).
 *
 * 3. Receipt vs PO (tol_receipt_vs_po_pct=5%)
 *    GR delivered qty vs PO ordered qty — flagged as QTY_VARIANCE with a
 *    "partial delivery" description. Informs the clerk that the GR itself
 *    may be incomplete, not just the invoice.
 */
export function detectQtyVariance(
  invoice: InvoiceInput,
  po: PurchaseOrder,
  grs: GoodsReceiptLine[],
  config: AgentRuntimeConfig,
): DiscrepancyCandidate[] {
  if (grs.length === 0) return []; // MISSING_GR handles this case

  const candidates: DiscrepancyCandidate[] = [];

  // Aggregate delivered qty per PO line from all GR documents
  const grQtyByPoLine = new Map<number, number>();
  for (const gr of grs) {
    const current = grQtyByPoLine.get(gr.poLine) ?? 0;
    grQtyByPoLine.set(gr.poLine, current + gr.deliveredQty);
  }

  for (const invLine of invoice.lines) {
    const poLineNo = invLine.poLine ?? invLine.lineNumber;
    const poLine = po.lines.find(p => p.lineNumber === poLineNo);
    const grQty = grQtyByPoLine.get(poLineNo);

    // ── Rule 1: Invoice vs Receipt (0% tolerance) ──────────────────────────
    if (grQty !== undefined) {
      const invoiceVsReceiptWithin = isWithinTolerance(
        invLine.quantity, grQty, config.tolInvoiceVsReceipt, 0
      );
      if (!invoiceVsReceiptWithin) {
        const pct = pctDiff(invLine.quantity, grQty).toDecimalPlaces(2).toNumber();
        const abs = absDiff(invLine.quantity, grQty).toDecimalPlaces(3).toNumber();
        const confidence = Math.min(0.95, 0.65 + pct / 100);

        log.debug({ line: invLine.lineNumber, pct, abs, invoiceQty: invLine.quantity, grQty }, 'QTY_VARIANCE: invoice vs receipt');

        candidates.push({
          discrepancyType: 'QTY_VARIANCE',
          requiresHumanReview: false,   // Deterministic: correct to GR qty, no human needed
          rulesConfidence: confidence,
          detectedFields: [
            { field: 'quantity', invoiceValue: invLine.quantity, expectedValue: grQty },
          ],
          description: `Line ${invLine.lineNumber}: invoice quantity ${invLine.quantity} differs from GR quantity ${grQty} by ${abs} units (${pct}%) — invoice must match receipt exactly`,
          proposedCorrections: [{
            lineNumber: invLine.lineNumber,
            field: 'quantity',
            before: invLine.quantity,
            after: grQty,
          }],
        });
        continue; // Don't double-flag the same line
      }
    }

    // ── Rule 2: Invoice vs PO Quantity (10% or 1 EUR/unit) ─────────────────
    // Only check when GR qty is itself within PO tolerance — if GR is the
    // root cause, the Receipt vs PO check below will surface it instead.
    if (poLine && grQty !== undefined) {
      const grVsPoWithin = isWithinTolerance(
        grQty, poLine.quantity, config.tolReceiptVsPoPct, 0
      );
      if (grVsPoWithin) {
        // GR is OK vs PO, but invoice qty vs PO qty might still be out
        const invVsPoWithin = isWithinTolerance(
          invLine.quantity, poLine.quantity,
          config.tolInvVsPoQtyPct,
          config.tolInvVsPoQtyAbs * poLine.unitPrice  // abs is per-unit × unit price
        );
        if (!invVsPoWithin) {
          const pct = pctDiff(invLine.quantity, poLine.quantity).toDecimalPlaces(2).toNumber();
          const abs = absDiff(invLine.quantity, poLine.quantity).toDecimalPlaces(3).toNumber();

          log.debug({ line: invLine.lineNumber, pct, abs }, 'QTY_VARIANCE: invoice vs PO quantity');

          candidates.push({
            discrepancyType: 'QTY_VARIANCE',
            requiresHumanReview: false,   // Deterministic: correct to PO qty, no human needed
            rulesConfidence: 0.80,
            detectedFields: [
              { field: 'quantity', invoiceValue: invLine.quantity, expectedValue: poLine.quantity, poValue: poLine.quantity },
            ],
            description: `Line ${invLine.lineNumber}: invoice quantity ${invLine.quantity} differs from PO ordered quantity ${poLine.quantity} by ${abs} units (${pct}%) — exceeds ${config.tolInvVsPoQtyPct}% / ${config.tolInvVsPoQtyAbs} EUR/unit tolerance`,
            proposedCorrections: [{
              lineNumber: invLine.lineNumber,
              field: 'quantity',
              before: invLine.quantity,
              after: poLine.quantity,
            }],
          });
        }
      }
    }

    // ── Rule 3: Receipt vs PO (5%) ──────────────────────────────────────────
    // GR delivered qty is significantly below PO ordered qty.
    // This surfaces partial delivery as a signal — not correctable by the agent
    // but important context for the AP clerk.
    if (poLine && grQty !== undefined) {
      const receiptVsPoWithin = isWithinTolerance(
        grQty, poLine.quantity, config.tolReceiptVsPoPct, 0
      );
      if (!receiptVsPoWithin) {
        const pct = pctDiff(grQty, poLine.quantity).toDecimalPlaces(2).toNumber();
        const abs = absDiff(grQty, poLine.quantity).toDecimalPlaces(3).toNumber();

        log.debug({ line: poLineNo, pct, abs, grQty, poQty: poLine.quantity }, 'QTY_VARIANCE: receipt vs PO (partial delivery)');

        candidates.push({
          discrepancyType: 'QTY_VARIANCE',
          requiresHumanReview: true,    // Can't auto-correct a GR — clerk must investigate partial delivery
          rulesConfidence: 0.85,
          detectedFields: [
            { field: 'grQuantity', invoiceValue: grQty, expectedValue: poLine.quantity, poValue: poLine.quantity },
          ],
          description: `Line ${poLineNo}: goods receipt quantity ${grQty} is ${abs} units (${pct}%) below PO ordered quantity ${poLine.quantity} — partial delivery likely`,
          proposedCorrections: [],
        });
      }
    }
  }

  return candidates;
}

/**
 * Checks invoice total amount vs PO total amount.
 * Compares invoice and PO totals using configured tolerances.
 * Separate from line-level checks — catches header-level discrepancies.
 */
export function detectInvoiceVsPoAmount(
  invoice: InvoiceInput,
  po: PurchaseOrder,
  config: AgentRuntimeConfig,
): DiscrepancyCandidate | null {
  const poTotalAmount = po.lines.reduce((sum, l) => sum + l.netAmount, 0);
  if (poTotalAmount === 0) return null;

  const within = isWithinTolerance(
    invoice.totalAmount, poTotalAmount,
    config.tolInvVsPoAmountPct,
    config.tolInvVsPoAmountAbs
  );
  if (within) return null;

  const pct = pctDiff(invoice.totalAmount, poTotalAmount).toDecimalPlaces(2).toNumber();
  const abs = absDiff(invoice.totalAmount, poTotalAmount).toDecimalPlaces(2).toNumber();

  log.debug({ invoiceTotal: invoice.totalAmount, poTotal: poTotalAmount, pct, abs }, 'QTY_VARIANCE: invoice total vs PO total amount');

  return {
    discrepancyType: 'PRICE_VARIANCE', // Amount-level variance maps to PRICE_VARIANCE
    requiresHumanReview: false,        // Deterministic: totalAmount vs PO total, correctable by rules
    rulesConfidence: Math.min(0.90, 0.60 + pct / 100),
    detectedFields: [
      { field: 'totalAmount', invoiceValue: invoice.totalAmount, expectedValue: poTotalAmount, poValue: poTotalAmount },
    ],
    description: `Invoice total ${invoice.totalAmount} ${invoice.currency} differs from PO total ${poTotalAmount} by ${abs} ${invoice.currency} (${pct}%) — exceeds ${config.tolInvVsPoAmountPct}% / ${config.tolInvVsPoAmountAbs} EUR tolerance`,
    proposedCorrections: [],
  };
}
