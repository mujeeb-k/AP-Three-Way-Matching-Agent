import { readFileSync } from 'fs';
import { join } from 'path';
import type { InvoiceInput, DiscrepancyCandidate } from '../types.js';
import type { PurchaseOrder } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:uom');

// Load the static conversion table relative to the compiled module.
const CONVERSIONS: UomConversions = JSON.parse(
  readFileSync(join(__dirname, 'uom-conversions.json'), 'utf-8'),
);

// ─────────────────────────────────────────────────────────────────────────────
// Types for the conversion table structure
// ─────────────────────────────────────────────────────────────────────────────

interface UomUnit {
  toCanonical: number | null;  // null = requires human review (packaging)
  aliases: string[];
}
interface UomCategory {
  canonical: string;
  requiresHumanReview?: boolean;
  units: Record<string, UomUnit>;
}
interface UomConversions {
  [category: string]: UomCategory;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution result type (used by drawer diagnosis section)
// ─────────────────────────────────────────────────────────────────────────────

export interface UomResolutionDetail {
  poUnit: string;
  invoiceUnit: string;
  conversionApplied: string | null;   // e.g. "1 kg = 1000 g"
  convertedQty: number | null;        // Invoice qty after conversion
  matchAfterConversion: boolean;
  requiresHumanReview: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build lookup maps once at load time
// ─────────────────────────────────────────────────────────────────────────────

interface UomLookupEntry {
  category: string;
  canonical: string;
  unitKey: string;
  toCanonical: number | null;
  categoryRequiresHumanReview: boolean;
}

const UOM_LOOKUP = new Map<string, UomLookupEntry>();

for (const [catName, cat] of Object.entries(CONVERSIONS)) {
  if (catName.startsWith('_')) continue;
  const catReview = cat.requiresHumanReview ?? false;
  for (const [unitKey, unit] of Object.entries(cat.units)) {
    const allNames = [unitKey, ...unit.aliases];
    for (const name of allNames) {
      UOM_LOOKUP.set(name.toLowerCase(), {
        category: catName,
        canonical: cat.canonical,
        unitKey,
        toCanonical: unit.toCanonical,
        categoryRequiresHumanReview: catReview,
      });
    }
  }
}

function lookupUnit(raw: string): UomLookupEntry | undefined {
  return UOM_LOOKUP.get(raw.trim().toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UOM_MISMATCH detector.
 *
 * For each invoice line, compare the unit of measure against the PO line.
 * If they differ:
 *   1. Attempt conversion via the conversion table.
 *   2. Apply converted qty and re-check quantity match vs PO qty.
 *   3. If conversion resolves match → AUTO_CORRECTED path (requiresHumanReview=false).
 *   4. If packaging / ambiguous conversion → FLAGGED_REVIEW (requiresHumanReview=true).
 *   5. If no conversion known → FLAGGED_REVIEW.
 */
export function detectUomMismatch(
  invoice: InvoiceInput,
  po: PurchaseOrder,
): DiscrepancyCandidate | null {
  if (!invoice.lines.length || !po.lines.length) return null;

  const mismatchLines: UomResolutionDetail[] = [];
  let worstRequiresReview = false;
  let allResolved = true;

  for (const invLine of invoice.lines) {
    const poLine = po.lines.find(p => p.lineNumber === invLine.poLine || p.lineNumber === invLine.lineNumber);
    if (!poLine) continue;

    const invUom = (invLine.unitOfMeasure ?? '').trim();
    const poUom  = (poLine.unitOfMeasure ?? '').trim();
    if (!invUom || !poUom) continue;

    // Normalise and compare
    if (invUom.toLowerCase() === poUom.toLowerCase()) continue;

    const invEntry = lookupUnit(invUom);
    const poEntry  = lookupUnit(poUom);

    let detail: UomResolutionDetail;

    if (!invEntry || !poEntry) {
      // Unknown unit — cannot convert, always human
      log.debug({ invUom, poUom }, 'UOM mismatch — unknown unit(s), flagging for review');
      detail = {
        poUnit: poUom,
        invoiceUnit: invUom,
        conversionApplied: null,
        convertedQty: null,
        matchAfterConversion: false,
        requiresHumanReview: true,
      };
      worstRequiresReview = true;
      allResolved = false;
    } else if (invEntry.category !== poEntry.category) {
      // Different dimensions (e.g. weight vs count) — definitively wrong
      log.debug({ invUom, poUom }, 'UOM mismatch — different dimensions, flagging for review');
      detail = {
        poUnit: poUom,
        invoiceUnit: invUom,
        conversionApplied: null,
        convertedQty: null,
        matchAfterConversion: false,
        requiresHumanReview: true,
      };
      worstRequiresReview = true;
      allResolved = false;
    } else if (invEntry.categoryRequiresHumanReview || invEntry.toCanonical === null || poEntry.toCanonical === null) {
      // Packaging / ambiguous — conversion factor unknown per product
      log.debug({ invUom, poUom }, 'UOM mismatch — packaging/ambiguous unit, flagging for review');
      detail = {
        poUnit: poUom,
        invoiceUnit: invUom,
        conversionApplied: null,
        convertedQty: null,
        matchAfterConversion: false,
        requiresHumanReview: true,
      };
      worstRequiresReview = true;
      allResolved = false;
    } else {
      // Known conversion: convert invoice qty to PO's unit and check match
      // invQty * invToCanonical = canonical qty
      // convertedQty = canonical qty / poToCanonical
      const canonicalQty  = invLine.quantity * invEntry.toCanonical;
      const convertedQty  = canonicalQty / poEntry.toCanonical;
      const qtyMatch = Math.abs(convertedQty - poLine.quantity) / Math.max(poLine.quantity, 1) * 100 <= 2; // 2% tolerance
      const conversionStr = `1 ${invEntry.unitKey} = ${invEntry.toCanonical / poEntry.toCanonical} ${poEntry.unitKey}`;

      log.debug({ invUom, poUom, invQty: invLine.quantity, convertedQty, poQty: poLine.quantity, qtyMatch }, 'UOM conversion attempted');

      detail = {
        poUnit: poUom,
        invoiceUnit: invUom,
        conversionApplied: conversionStr,
        convertedQty,
        matchAfterConversion: qtyMatch,
        requiresHumanReview: !qtyMatch,
      };
      if (!qtyMatch) {
        worstRequiresReview = true;
        allResolved = false;
      }
    }

    mismatchLines.push(detail);
  }

  if (mismatchLines.length === 0) return null;

  // Build detected fields for UI
  const detectedFields = mismatchLines.map((d, i) => ({
    field: `line${i + 1}.unitOfMeasure`,
    invoiceValue: `${d.invoiceUnit}${d.convertedQty !== null ? ` (→ ${d.convertedQty.toFixed(3)} ${d.poUnit})` : ''}`,
    expectedValue: d.poUnit,
    poValue: d.poUnit,
  }));

  // Build proposed corrections (only for resolved conversions)
  const proposedCorrections: Array<{ lineNumber: number; field: 'quantity' | 'unitPrice' | 'netAmount'; before: number; after: number }> = [];
  let lineIdx = 0;
  for (const invLine of invoice.lines) {
    const poLine = po.lines.find(p => p.lineNumber === invLine.poLine || p.lineNumber === invLine.lineNumber);
    if (!poLine) continue;
    const invUom = (invLine.unitOfMeasure ?? '').trim();
    const poUom  = (poLine.unitOfMeasure ?? '').trim();
    if (invUom.toLowerCase() === poUom.toLowerCase()) continue;
    const detail = mismatchLines[lineIdx++];
    if (detail?.matchAfterConversion && detail.convertedQty !== null) {
      const correctedQty = Math.round(detail.convertedQty * 1000) / 1000;
      proposedCorrections.push({
        lineNumber: invLine.lineNumber,
        field: 'quantity',
        before: invLine.quantity,
        after: correctedQty,
      });
      // When qty changes due to UOM conversion, unit price must change inversely
      // to preserve the line total: correctedPrice = originalTotal / correctedQty
      if (correctedQty !== 0) {
        const lineTotal = invLine.quantity * invLine.unitPrice;
        const correctedPrice = Math.round((lineTotal / correctedQty) * 100000) / 100000;
        proposedCorrections.push({
          lineNumber: invLine.lineNumber,
          field: 'unitPrice',
          before: invLine.unitPrice,
          after: correctedPrice,
        });
      }
    }
  }

  // Build description
  const resolvedCount = mismatchLines.filter(d => d.matchAfterConversion).length;
  const reviewCount   = mismatchLines.filter(d => d.requiresHumanReview).length;
  let description: string;
  if (allResolved) {
    description = `UOM mismatch on ${mismatchLines.length} line(s) — conversion applied and 3-way match resolved. ${mismatchLines.map(d => `${d.invoiceUnit} → ${d.poUnit} (${d.conversionApplied})`).join('; ')}.`;
  } else if (resolvedCount > 0) {
    description = `UOM mismatch: ${resolvedCount} line(s) resolved via conversion, ${reviewCount} line(s) require clerk confirmation (packaging or unknown units).`;
  } else {
    const units = [...new Set(mismatchLines.map(d => `${d.invoiceUnit} vs ${d.poUnit}`))].join(', ');
    description = `UOM mismatch on ${mismatchLines.length} line(s): ${units}. ${reviewCount > 0 ? 'Packaging units — conversion factor varies by product.' : 'No known conversion available.'}`;
  }

  const candidate: DiscrepancyCandidate & { uomResolved?: boolean; uomDetails?: UomResolutionDetail[] } = {
    discrepancyType: 'UOM_MISMATCH',
    requiresHumanReview: worstRequiresReview,
    rulesConfidence: allResolved ? 1.0 : 0.85,
    detectedFields,
    description,
    proposedCorrections,
    // Extra fields for drawer diagnosis
    uomResolved: allResolved,
    uomDetails: mismatchLines,
  };

  return candidate;
}
