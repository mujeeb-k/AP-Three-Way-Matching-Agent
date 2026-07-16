import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import type { GoodsReceiptLine } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:missing-gr');

/**
 * MISSING_GR detector — rules-only.
 * Invoice exists but no GR has been recorded in the system at all.
 */
export function detectMissingGr(
  invoice: InvoiceInput,
  grs: GoodsReceiptLine[],
): DiscrepancyCandidate | null {
  if (grs.length > 0) return null;

  log.debug({ poNumber: invoice.poNumber }, 'No GRs found — MISSING_GR');

  return {
    discrepancyType: 'MISSING_GR',
    requiresHumanReview: true,
    rulesConfidence: 1.0,
    detectedFields: [{ field: 'goodsReceipt', invoiceValue: 'NONE', expectedValue: 'GR_REQUIRED' }],
    description: `Invoice references PO ${invoice.poNumber} but no goods receipt has been recorded`,
    proposedCorrections: [],
  };
}

/**
 * INVOICE_BEFORE_GR detector — rules-only.
 * Invoice arrived before GR was posted.
 * Distinct from MISSING_GR: GR may be in transit / not yet posted.
 *
 * Detection heuristic: invoice.postingDate < GR.postingDate (or no GR yet).
 * When no GR exists, this overlaps with MISSING_GR — both are raised;
 * the pipeline picks the higher-priority one.
 */
export function detectInvoiceBeforeGr(
  invoice: InvoiceInput,
  grs: GoodsReceiptLine[],
): DiscrepancyCandidate | null {
  if (!invoice.postingDate) return null;

  if (grs.length === 0) {
    // No GR at all — invoice has definitely arrived before GR
    return {
      discrepancyType: 'INVOICE_BEFORE_GR',
      requiresHumanReview: true,
      rulesConfidence: 0.90,  // Slightly below 1.0 — GR may just not be visible yet
      detectedFields: [{ field: 'postingDate', invoiceValue: invoice.postingDate, expectedValue: 'GR_NOT_YET_POSTED' }],
      description: `Invoice posted on ${invoice.postingDate} but no goods receipt exists yet for PO ${invoice.poNumber}`,
      proposedCorrections: [],
    };
  }

  // GR exists — check if invoice was posted before the earliest GR
  const earliestGrDate = grs
    .map(gr => gr.postingDate)
    .sort()[0];

  if (invoice.postingDate < earliestGrDate) {
    log.debug({ invoiceDate: invoice.postingDate, grDate: earliestGrDate }, 'INVOICE_BEFORE_GR detected');
    return {
      discrepancyType: 'INVOICE_BEFORE_GR',
      requiresHumanReview: true,
      rulesConfidence: 0.95,
      detectedFields: [
        { field: 'invoicePostingDate', invoiceValue: invoice.postingDate, expectedValue: earliestGrDate },
        { field: 'grPostingDate', invoiceValue: earliestGrDate, expectedValue: 'AFTER_INVOICE' },
      ],
      description: `Invoice was posted on ${invoice.postingDate}, before goods receipt on ${earliestGrDate}`,
      proposedCorrections: [],
    };
  }

  return null;
}
