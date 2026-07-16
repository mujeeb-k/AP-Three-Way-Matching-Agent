import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import type { HistoricalInvoice } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:duplicate');

/**
 * DUPLICATE detector — rules-only.
 * Exact match: same vendorInvoiceNo + same vendorId + same totalAmount.
 * Near-duplicate (same number, different amount) is surfaced as PRICE_VARIANCE.
 */
export function detectDuplicate(
  invoice: InvoiceInput,
  historicalInvoices: HistoricalInvoice[],
): DiscrepancyCandidate | null {
  if (!invoice.vendorInvoiceNo) return null;

  for (const hist of historicalInvoices) {
    // Exact match — same vendor invoice number + vendor + amount
    if (
      hist.vendorInvoiceNo === invoice.vendorInvoiceNo &&
      hist.vendorId === invoice.vendorId &&
      hist.totalAmount === invoice.totalAmount
    ) {
      log.debug({ vendorInvoiceNo: invoice.vendorInvoiceNo, externalId: hist.externalId }, 'DUPLICATE detected');
      return {
        discrepancyType: 'DUPLICATE',
        requiresHumanReview: true,
        rulesConfidence: 1.0,
        detectedFields: [{
          field: 'vendorInvoiceNo',
          invoiceValue: invoice.vendorInvoiceNo,
          expectedValue: `UNIQUE (existing: ${hist.externalId})`,
        }],
        description: `Duplicate invoice: vendor invoice ${invoice.vendorInvoiceNo} (${invoice.totalAmount} ${invoice.currency}) was already submitted as document ${hist.externalId}`,
        proposedCorrections: [],
      };
    }
  }

  return null;
}
