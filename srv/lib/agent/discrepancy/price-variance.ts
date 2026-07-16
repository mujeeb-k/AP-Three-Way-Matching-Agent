import type { InvoiceInput, DiscrepancyCandidate, AgentRuntimeConfig } from '../types.js';
import type { PurchaseOrder, GoodsReceiptLine } from '../../adapters/types.js';
import { isWithinTolerance, pctDiff, absDiff } from '../../util/currency.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:price-variance');

/**
 * PRICE_VARIANCE detector — rules-only.
 * Compares invoice unit price against PO unit price per line.
 * When GR unit price is available, also compares invoice vs GR price.
 * Uses the configured percentage and absolute price tolerances.
 */
export function detectPriceVariance(
  invoice: InvoiceInput,
  po: PurchaseOrder,
  grs: GoodsReceiptLine[],
  config: AgentRuntimeConfig,
): DiscrepancyCandidate[] {
  const candidates: DiscrepancyCandidate[] = [];
  const grLineMap = new Map<number, GoodsReceiptLine>();
  for (const gr of grs) { grLineMap.set(gr.poLine, gr); }

  for (const invLine of invoice.lines) {
    const poLine = po.lines.find(p => p.lineNumber === (invLine.poLine ?? invLine.lineNumber));
    if (!poLine) continue;
    if (invLine.unitPrice === 0 && poLine.unitPrice === 0) continue;

    const withinPo = isWithinTolerance(invLine.unitPrice, poLine.unitPrice, config.tolPricePct, config.tolPriceAbs);

    // Check invoice vs GR price when GR unit price is available
    const grLine = grLineMap.get(poLine.lineNumber);
    const grPrice = grLine?.unitPrice;
    const withinGr = grPrice != null
      ? isWithinTolerance(invLine.unitPrice, grPrice, config.tolPricePct, config.tolPriceAbs)
      : true; // No GR price → skip GR comparison

    if (withinPo && withinGr) continue;

    // Use the reference that flagged the variance for the main detected field
    const referencePrice = !withinPo ? poLine.unitPrice : grPrice!;
    const referenceLabel = !withinPo ? 'PO' : 'GR';
    const pct = pctDiff(invLine.unitPrice, referencePrice).toDecimalPlaces(2).toNumber();
    const abs = absDiff(invLine.unitPrice, referencePrice).toDecimalPlaces(2).toNumber();

    // Confidence scales with deviation magnitude
    const confidence = Math.min(0.95, 0.60 + pct / 100);

    log.debug({ line: invLine.lineNumber, pct, abs, referenceLabel }, 'PRICE_VARIANCE detected');

    const detectedFields = [{
      field: 'unitPrice',
      invoiceValue: invLine.unitPrice,
      expectedValue: referencePrice,
      poValue: poLine.unitPrice,
    }];

    // If both PO and GR flagged, add GR as a second detected field
    if (!withinPo && !withinGr && grPrice != null && grPrice !== poLine.unitPrice) {
      detectedFields.push({
        field: 'unitPrice',
        invoiceValue: invLine.unitPrice,
        expectedValue: grPrice,
        poValue: poLine.unitPrice,
      });
    }

    candidates.push({
      discrepancyType: 'PRICE_VARIANCE',
      requiresHumanReview: false,
      rulesConfidence: confidence,
      detectedFields,
      description: `Line ${invLine.lineNumber}: invoice price ${invLine.unitPrice} ${invoice.currency} differs from ${referenceLabel} price ${referencePrice} by ${pct}% (${abs} ${invoice.currency})`,
      proposedCorrections: [{
        lineNumber: invLine.lineNumber,
        field: 'unitPrice',
        before: invLine.unitPrice,
        after: poLine.unitPrice,
      }],
    });
  }

  return candidates;
}
