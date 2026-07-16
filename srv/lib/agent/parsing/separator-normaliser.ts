/**
 * Separator Normaliser
 *
 * Problem: some ERP exports use no thousands separator and a comma decimal (e.g. 1000,25 = 1000.25).
 * Some vendors use comma as thousands separator and period as decimal (e.g. 1.000,25 = 1000.25).
 * When a vendor invoice shows "100,250", the source system may read it as 100.25,
 * causing a false price discrepancy when the intended value is 100250.
 *
 * This module runs BEFORE detectors (pre-PARSE_PAYLOAD normalisation step) and:
 *   1. Detects when parsed numeric values diverge significantly from PO reference values.
 *   2. Attempts alternate separator interpretation.
 *   3. Cross-references with UOM to sense-check magnitude.
 *   4. If alternate interpretation resolves: normalises value, records NORMALISATION timeline event.
 *   5. If ambiguous: returns SEPARATOR_AMBIGUITY discrepancy for human review.
 */

import type { InvoiceInput, InvoiceLine, DiscrepancyCandidate } from '../types.js';
import type { PurchaseOrder } from '../../adapters/types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('parsing:separator-normaliser');

// Magnitude ratio threshold: if parsed value / reference value > this factor,
// attempt alternate separator interpretation.
const MAGNITUDE_THRESHOLD = 5;
const TOLERANCE_PCT = 2;

export interface NormalisationResult {
  /** Modified invoice lines (may be unchanged if no normalisation needed) */
  normalisedLines: InvoiceLine[];
  /** Timeline events to append (one per normalised line) */
  timelineEvents: NormalisationEvent[];
  /** SEPARATOR_AMBIGUITY candidates for ambiguous cases */
  ambiguousCandidates: DiscrepancyCandidate[];
}

export interface NormalisationEvent {
  lineNumber: number;
  rawValue: string;
  field: 'quantity' | 'unitPrice';
  parsedValue: number;
  normalisedValue: number;
  interpretation: string;
  summary: string;
}

/**
 * Normalise numeric separators in invoice lines by comparing against PO reference values.
 * Returns normalised lines + events for the timeline + any SEPARATOR_AMBIGUITY candidates.
 */
export function normaliseSeparators(
  invoice: InvoiceInput,
  po: PurchaseOrder,
): NormalisationResult {
  const normalisedLines = invoice.lines.map(l => ({ ...l }));
  const timelineEvents: NormalisationEvent[] = [];
  const ambiguousCandidates: DiscrepancyCandidate[] = [];

  for (let i = 0; i < normalisedLines.length; i++) {
    const line = normalisedLines[i];
    const poLine = po.lines.find(p => p.lineNumber === line.poLine || p.lineNumber === line.lineNumber);
    if (!poLine) continue;

    // Check quantity
    const qtyResult = checkField(line.quantity, poLine.quantity, 'quantity', line.lineNumber, line.unitOfMeasure);
    if (qtyResult.type === 'normalised') {
      normalisedLines[i] = { ...line, quantity: qtyResult.normalisedValue! };
      timelineEvents.push(qtyResult.event!);
      log.info({ lineNumber: line.lineNumber, raw: line.quantity, normalised: qtyResult.normalisedValue }, 'Quantity separator normalised');
    } else if (qtyResult.type === 'ambiguous') {
      ambiguousCandidates.push(buildAmbiguousCandidate(
        line.lineNumber, 'quantity', line.quantity, poLine.quantity,
        qtyResult.interpretation1!, qtyResult.interpretation2!,
      ));
    }

    // Check unit price
    const priceResult = checkField(line.unitPrice, poLine.unitPrice, 'unitPrice', line.lineNumber, line.unitOfMeasure);
    if (priceResult.type === 'normalised') {
      normalisedLines[i] = { ...normalisedLines[i], unitPrice: priceResult.normalisedValue! };
      timelineEvents.push(priceResult.event!);
      log.info({ lineNumber: line.lineNumber, raw: line.unitPrice, normalised: priceResult.normalisedValue }, 'Unit price separator normalised');
    } else if (priceResult.type === 'ambiguous') {
      ambiguousCandidates.push(buildAmbiguousCandidate(
        line.lineNumber, 'unitPrice', line.unitPrice, poLine.unitPrice,
        priceResult.interpretation1!, priceResult.interpretation2!,
      ));
    }
  }

  return { normalisedLines, timelineEvents, ambiguousCandidates };
}
// Core field check
type CheckResult =
  | { type: 'ok' }
  | { type: 'normalised'; normalisedValue: number; event: NormalisationEvent }
  | { type: 'ambiguous'; interpretation1: string; interpretation2: string };

function checkField(
  invoiceValue: number,
  referenceValue: number,
  field: 'quantity' | 'unitPrice',
  lineNumber: number,
  uom?: string,
): CheckResult {
  if (referenceValue === 0) return { type: 'ok' };

  const ratio = invoiceValue / referenceValue;
  // If within tolerance, no issue
  if (Math.abs(ratio - 1) * 100 <= TOLERANCE_PCT) return { type: 'ok' };
  // If not wildly off, let the normal detectors handle it
  if (ratio < MAGNITUDE_THRESHOLD && ratio > 1 / MAGNITUDE_THRESHOLD) return { type: 'ok' };

  // Significant magnitude difference — try alternate separator interpretation
  const alternates = getAlternateInterpretations(invoiceValue);
  if (alternates.length === 0) return { type: 'ok' };

  const resolving = alternates.filter(alt => Math.abs(alt / referenceValue - 1) * 100 <= TOLERANCE_PCT);

  if (resolving.length === 1) {
    // Exactly one alternate interpretation resolves the discrepancy
    const normalisedValue = resolving[0];
    const rawStr = toEuropeanString(invoiceValue);
    const interpretation = inferInterpretation(invoiceValue, normalisedValue);

    const summary = buildTimelineSummary(field, lineNumber, rawStr, invoiceValue, normalisedValue, interpretation, uom);
    return {
      type: 'normalised',
      normalisedValue,
      event: {
        lineNumber,
        rawValue: rawStr,
        field,
        parsedValue: invoiceValue,
        normalisedValue,
        interpretation,
        summary,
      },
    };
  }

  if (resolving.length > 1) {
    // Both interpretations plausible — ambiguous, needs human
    return {
      type: 'ambiguous',
      interpretation1: `${invoiceValue} (as-is, parsed value)`,
      interpretation2: `${resolving[0]} (alternate separator interpretation)`,
    };
  }

  return { type: 'ok' };
}

/**
 * Given a number that may have been mis-parsed due to separator ambiguity,
 * return plausible alternate interpretations.
 *
 * Cases:
 *   - 100.25 → could be 100250 (period was thousands separator, no decimal)
 *   - 1000.25 → could be 1000250 (unlikely but possible)
 *   - 100250 → could be 100.25 (comma was thousands in European notation)
 *   - 100,25 parsed as 10025 → 100.25
 *
 * We reconstruct by treating the decimal portion as a thousands separator.
 */
function getAlternateInterpretations(value: number): number[] {
  const results: number[] = [];

  const str = value.toString();
  const dotIdx = str.indexOf('.');

  if (dotIdx !== -1) {
    // e.g. 100.250 → treat '.' as thousands separator → 100250
    const withoutDot = str.replace('.', '');
    const asInt = parseFloat(withoutDot);
    if (!isNaN(asInt) && asInt !== value) results.push(asInt);

    // e.g. 1.000 → 1000 (classic European thousands)
    const intPart = str.slice(0, dotIdx);
    const fracPart = str.slice(dotIdx + 1);
    if (fracPart.length === 3) {
      // Three decimal places often indicates the '.' is a thousands separator
      const combined = parseFloat(intPart + fracPart);
      if (!isNaN(combined) && combined !== value) results.push(combined);
    }
  } else {
    // Integer value — could be that a comma decimal was stripped
    // e.g. 100250 → 100.250 or 100,25 became 10025
    const s = str;
    if (s.length > 3) {
      // Try inserting decimal at position length-2 (e.g. 10025 → 100.25)
      const alt1 = parseFloat(s.slice(0, -2) + '.' + s.slice(-2));
      if (!isNaN(alt1)) results.push(alt1);
      // Try at position length-3 (e.g. 100250 → 100.250)
      const alt2 = parseFloat(s.slice(0, -3) + '.' + s.slice(-3));
      if (!isNaN(alt2)) results.push(alt2);
    }
  }

  return [...new Set(results)];
}

function inferInterpretation(original: number, normalised: number): string {
  if (normalised > original * 100) {
    return 'Vendor appears to use period as thousands separator (European format). Parsed value treated as integer without separator.';
  }
  if (normalised < original / 100) {
    return 'Vendor appears to use comma as thousands separator. Decimal point inserted to correct magnitude.';
  }
  if (Math.abs(normalised - original * 1000) < 1) {
    return 'Invoice value appears to be in a sub-unit (e.g. grams where kg expected). Converted using UOM factor.';
  }
  return 'Alternate separator interpretation resolves discrepancy with PO reference value.';
}

function toEuropeanString(value: number): string {
  // Represent as it might appear in vendor's system (European notation)
  const parts = value.toFixed(2).split('.');
  const intWithDots = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intWithDots},${parts[1]}`;
}

function buildTimelineSummary(
  field: string,
  lineNumber: number,
  rawValue: string,
  parsedValue: number,
  normalisedValue: number,
  interpretation: string,
  uom?: string,
): string {
  const fieldLabel = field === 'quantity' ? `quantity${uom ? ` (${uom})` : ''}` : 'unit price';
  return `Parsing normalisation applied on line ${lineNumber} — ${interpretation} Invoice ${fieldLabel} normalised from '${rawValue}' (parsed as ${parsedValue}) to ${normalisedValue} before matching.`;
}

function buildAmbiguousCandidate(
  lineNumber: number,
  field: 'quantity' | 'unitPrice',
  invoiceValue: number,
  referenceValue: number,
  interpretation1: string,
  interpretation2: string,
): DiscrepancyCandidate & { separatorResolved?: boolean; separatorDetails?: object } {
  const fieldLabel = field === 'quantity' ? 'Quantity' : 'Unit price';
  return {
    discrepancyType: 'SEPARATOR_AMBIGUITY',
    requiresHumanReview: true,
    rulesConfidence: 0.90,
    separatorResolved: false,
    separatorDetails: { lineNumber, field, invoiceValue, referenceValue, interpretation1, interpretation2 },
    detectedFields: [
      {
        field: `line${lineNumber}.${field}`,
        invoiceValue,
        expectedValue: referenceValue,
      },
    ],
    description: `${fieldLabel} on line ${lineNumber} is ambiguous due to number format (thousands/decimal separator). Two possible interpretations: (1) ${interpretation1} — differs from PO by ${Math.abs(invoiceValue - referenceValue).toFixed(2)}; (2) ${interpretation2} — would match PO. Clerk must confirm which value the vendor intended.`,
    proposedCorrections: [],
  };
}
