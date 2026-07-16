import type { InvoiceInput, DiscrepancyCandidate, DetectedField } from '../types.js';
import type { PurchaseOrder, GoodsReceiptLine } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:material-mismatch');

/**
 * MATERIAL_MISMATCH detector — rules-only.
 *
 * Compares materialNumber across invoice lines, PO lines, and GR lines
 * joined by poLine/lineNumber. Flags when:
 *   1. Invoice line references a PO line but the materialNumber differs
 *   2. GR line for the same PO line has a different materialNumber than the invoice
 *   3. Invoice line has no materialNumber but the PO line does (or vice-versa)
 *
 * Returns one candidate per mismatched line (not one aggregate).
 */
export function detectMaterialMismatch(
  invoice: InvoiceInput,
  po: PurchaseOrder | null,
  grs: GoodsReceiptLine[],
): DiscrepancyCandidate[] {
  if (!po) return [];

  const results: DiscrepancyCandidate[] = [];

  // Index PO lines by lineNumber for O(1) lookup
  const poLineMap = new Map(po.lines.map(l => [l.lineNumber, l]));

  // Index GR lines by poLine for O(1) lookup — if multiple GRs exist
  // for the same PO line, take the latest (they should all share the same material)
  const grLineMap = new Map<number, GoodsReceiptLine>();
  for (const gr of grs) {
    grLineMap.set(gr.poLine, gr);
  }

  for (const invLine of invoice.lines) {
    const poLineNum = invLine.poLine ?? invLine.lineNumber;
    const poLine = poLineMap.get(poLineNum);
    if (!poLine) continue; // No matching PO line — handled by LINE_STRUCTURE detector

    const invMat = normalise(invLine.materialNumber);
    const poMat = normalise(poLine.materialNumber);

    // Skip if both are empty — no material tracking on this line
    if (!invMat && !poMat) continue;

    const grLine = grLineMap.get(poLineNum);
    const grMat = grLine ? normalise(grLine.materialNumber) : null;

    const detectedFields: DetectedField[] = [];
    const parts: string[] = [];

    // Check invoice vs PO
    if (invMat && poMat && invMat !== poMat) {
      detectedFields.push({
        field: `line${poLineNum}.materialNumber`,
        invoiceValue: invLine.materialNumber!,
        expectedValue: poLine.materialNumber,
        poValue: poLine.materialNumber,
      });
      parts.push(
        `line ${poLineNum}: invoice material ${invLine.materialNumber} differs from PO material ${poLine.materialNumber}`,
      );
    }

    // Check invoice vs GR (only if GR material differs from invoice AND from PO check above)
    if (grMat && invMat && grMat !== invMat) {
      // Only add if GR material wasn't already flagged via the PO check
      const alreadyFlagged = detectedFields.some(
        f => f.field === `line${poLineNum}.materialNumber`,
      );
      if (!alreadyFlagged) {
        detectedFields.push({
          field: `line${poLineNum}.materialNumber`,
          invoiceValue: invLine.materialNumber!,
          expectedValue: grLine!.materialNumber,
          poValue: poLine.materialNumber,
        });
      }
      parts.push(
        `line ${poLineNum}: invoice material ${invLine.materialNumber} differs from GR material ${grLine!.materialNumber}`,
      );
    }

    // Check missing material — invoice has none but PO does
    if (!invMat && poMat) {
      detectedFields.push({
        field: `line${poLineNum}.materialNumber`,
        invoiceValue: '(empty)',
        expectedValue: poLine.materialNumber,
        poValue: poLine.materialNumber,
      });
      parts.push(
        `line ${poLineNum}: invoice has no material number but PO specifies ${poLine.materialNumber}`,
      );
    }

    if (detectedFields.length > 0) {
      log.debug({ lineNumber: poLineNum, invMat, poMat, grMat }, 'MATERIAL_MISMATCH detected');

      results.push({
        discrepancyType: 'MATERIAL_MISMATCH',
        requiresHumanReview: true,
        rulesConfidence: 0.95,
        detectedFields,
        description: `Material number mismatch: ${parts.join('; ')}`,
        proposedCorrections: [], // No auto-correction — wrong material requires human judgment
      });
    }
  }

  return results;
}

/** Trim + uppercase for case-insensitive comparison; return null if empty/undefined. */
function normalise(mat: string | undefined | null): string | null {
  if (!mat) return null;
  const trimmed = mat.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}
