import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import type { PurchaseOrder } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:wrong-po-reference');

/**
 * WRONG_PO_REFERENCE detector — rules-only.
 * Covers all invalid/mismatched document reference scenarios:
 *   1. PO not found in system (null po)
 *   2. PO status is CLOSED, CANCELLED, or BLOCKED
 *   3. Invoice vendor ≠ PO vendor
 *   4. Invoice company code ≠ PO company code (→ ENTITY_MISMATCH)
 */
export function detectWrongPoReference(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
): DiscrepancyCandidate[] {
  const candidates: DiscrepancyCandidate[] = [];

  if (!po) {
    log.debug({ poNumber: invoice.poNumber }, 'PO not found — WRONG_PO_REFERENCE CRITICAL');
    candidates.push({
      discrepancyType: 'WRONG_PO_REFERENCE',
      requiresHumanReview: true,
      rulesConfidence: 1.0,
      detectedFields: [{ field: 'poNumber', invoiceValue: invoice.poNumber ?? '', expectedValue: 'EXISTING_PO' }],
      description: `Invoice references PO ${invoice.poNumber} which does not exist in the system`,
      proposedCorrections: [],
    });
    return candidates; // Nothing more to check without a PO
  }

  // Status check
  if (['CLOSED', 'CANCELLED', 'BLOCKED'].includes(po.status)) {
    log.debug({ poNumber: po.poNumber, status: po.status }, 'PO is closed/cancelled/blocked');
    candidates.push({
      discrepancyType: 'WRONG_PO_REFERENCE',
      requiresHumanReview: true,
      rulesConfidence: 0.98,
      detectedFields: [{ field: 'poStatus', invoiceValue: po.status, expectedValue: 'OPEN' }],
      description: `Invoice references PO ${po.poNumber} which has status ${po.status}`,
      proposedCorrections: [],
    });
  }

  // Vendor mismatch
  if (po.vendorId && invoice.vendorId && po.vendorId !== invoice.vendorId) {
    log.debug({ poVendor: po.vendorId, invVendor: invoice.vendorId }, 'Vendor mismatch');
    candidates.push({
      discrepancyType: 'WRONG_PO_REFERENCE',
      requiresHumanReview: true,
      rulesConfidence: 0.97,
      detectedFields: [
        { field: 'vendorId', invoiceValue: invoice.vendorId, expectedValue: po.vendorId, poValue: po.vendorId },
      ],
      description: `Invoice vendor ${invoice.vendorId} does not match PO vendor ${po.vendorId}`,
      proposedCorrections: [],
    });
  }

  return candidates;
}

/**
 * ENTITY_MISMATCH detector — rules-only.
 * Invoice billed to wrong legal entity (company code mismatch).
 */
export function detectEntityMismatch(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
): DiscrepancyCandidate | null {
  if (!po) return null;
  if (!po.companyCode || !invoice.companyCode) return null;
  if (po.companyCode === invoice.companyCode) return null;

  log.debug({ poCC: po.companyCode, invCC: invoice.companyCode }, 'ENTITY_MISMATCH detected');

  return {
    discrepancyType: 'ENTITY_MISMATCH',
    requiresHumanReview: true,
    rulesConfidence: 0.97,
    detectedFields: [{
      field: 'companyCode',
      invoiceValue: invoice.companyCode,
      expectedValue: po.companyCode,
      poValue: po.companyCode,
    }],
    description: `Invoice billed to company code ${invoice.companyCode} but PO ${po.poNumber} belongs to ${po.companyCode}`,
    proposedCorrections: [],
  };
}

/**
 * CURRENCY_MISMATCH detector — rules-only.
 */
export function detectCurrencyMismatch(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
): DiscrepancyCandidate | null {
  if (!po) return null;
  if (!po.currency || !invoice.currency) return null;
  if (po.currency === invoice.currency) return null;

  log.debug({ poCurrency: po.currency, invCurrency: invoice.currency }, 'CURRENCY_MISMATCH detected');

  return {
    discrepancyType: 'CURRENCY_MISMATCH',
    requiresHumanReview: true,
    rulesConfidence: 1.0,
    detectedFields: [{
      field: 'currency',
      invoiceValue: invoice.currency,
      expectedValue: po.currency,
      poValue: po.currency,
    }],
    description: `Invoice currency ${invoice.currency} does not match PO currency ${po.currency}`,
    proposedCorrections: [],
  };
}
