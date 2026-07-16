import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('resolution:auto-correct');

/**
 * Applies proposed corrections to the invoice lines (in-memory only).
 * Does NOT write to S/4HANA — all corrections are stored locally on
 * InvoicePayloadLine.corrected* fields until a human calls acceptCorrection().
 *
 * Returns the invoice with corrected line values populated.
 */
export function applyCorrections(
  invoice: InvoiceInput,
  candidates: DiscrepancyCandidate[],
): InvoiceInput {
  // Collect all corrections, keyed by line number
  const correctionsByLine = new Map<number, Partial<{
    quantity: number;
    unitPrice: number;
    netAmount: number;
  }>>();

  for (const candidate of candidates) {
    if (!candidate.proposedCorrections.length) continue;
    for (const correction of candidate.proposedCorrections) {
      const existing = correctionsByLine.get(correction.lineNumber) ?? {};
      correctionsByLine.set(correction.lineNumber, {
        ...existing,
        [correction.field]: correction.after,
      });
    }
  }

  if (correctionsByLine.size === 0) return invoice;

  const correctedLines = invoice.lines.map(line => {
    const corrections = correctionsByLine.get(line.lineNumber);
    if (!corrections) return line;

    log.debug({ lineNumber: line.lineNumber, corrections }, 'Applying corrections to invoice line');

    return {
      ...line,
      // Corrected values are stored separately — originals preserved for audit
      _correctedQty: corrections.quantity,
      _correctedUnitPrice: corrections.unitPrice,
      _correctedNetAmount: corrections.netAmount,
    };
  });

  return { ...invoice, lines: correctedLines as InvoiceInput['lines'] };
}
