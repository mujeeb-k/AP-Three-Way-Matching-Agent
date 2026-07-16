import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import type { PurchaseOrder } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:line-structure');

/**
 * LINE_STRUCTURE detector — rules-only.
 * Invoice lines differ structurally from PO lines:
 * - Different number of lines (consolidated or split lines)
 * - Invoice references PO lines that don't exist
 * - Missing PO line references on invoice lines
 */
export function detectLineStructure(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
): DiscrepancyCandidate | null {
  if (!po || !invoice.lines.length) return null;

  const poLineNumbers = new Set(po.lines.map(l => l.lineNumber));
  const invLineNumbers = invoice.lines.map(l => l.poLine ?? l.lineNumber);

  const invalidRefs = invLineNumbers.filter(n => !poLineNumbers.has(n));
  const invCount = invoice.lines.length;
  const poCount = po.lines.length;

  const hasMismatch = invalidRefs.length > 0 || invCount !== poCount;
  if (!hasMismatch) return null;

  const parts: string[] = [];
  if (invCount !== poCount) parts.push(`invoice has ${invCount} lines vs PO has ${poCount} lines`);
  if (invalidRefs.length > 0) parts.push(`invoice references non-existent PO lines: ${invalidRefs.join(', ')}`);

  log.debug({ invCount, poCount, invalidRefs }, 'LINE_STRUCTURE mismatch detected');

  return {
    discrepancyType: 'LINE_STRUCTURE',
    requiresHumanReview: true,
    rulesConfidence: 0.85,
    detectedFields: [
      { field: 'lineCount', invoiceValue: invCount, expectedValue: poCount },
    ],
    description: `Invoice line structure differs from PO: ${parts.join('; ')}`,
    proposedCorrections: [],
  };
}

/**
 * MULTI_PO detector — rules-only.
 * Invoice references more than one PO.
 */
export function detectMultiPo(invoice: InvoiceInput): DiscrepancyCandidate | null {
  const isMulti = invoice.isMultiPo ||
    (invoice.poReferences && invoice.poReferences.length > 1);

  if (!isMulti) return null;

  const poCount = invoice.poReferences?.length ?? 2;
  log.debug({ poCount }, 'MULTI_PO detected');

  return {
    discrepancyType: 'MULTI_PO',
    requiresHumanReview: true,
    rulesConfidence: 1.0,
    detectedFields: [{
      field: 'poReferences',
      invoiceValue: poCount,
      expectedValue: 1,
    }],
    description: `Invoice references ${poCount} purchase orders — requires multi-PO reconciliation`,
    proposedCorrections: [],
  };
}
