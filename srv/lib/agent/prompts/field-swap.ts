import type { InvoiceLine } from '../types.js';
import type { PurchaseOrderLine } from '../../adapters/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder for FIELD_SWAP detection.
// Used when the rules-based pre-check flags suspicious qty/price values.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldSwapPromptInput {
  invoiceLines: InvoiceLine[];
  poLines: PurchaseOrderLine[];
  currency: string;
  vendorSwapErrorRate: number;
}

export function buildFieldSwapPrompt(input: FieldSwapPromptInput): string {
  const invoiceTable = input.invoiceLines.map(l =>
    `  Line ${l.lineNumber}: qty=${l.quantity}, unitPrice=${l.unitPrice}, netAmount=${l.netAmount}` +
    (l.description ? ` (${l.description})` : '')
  ).join('\n');

  const poTable = input.poLines.map(l =>
    `  Line ${l.lineNumber}: qty=${l.quantity}, unitPrice=${l.unitPrice}, netAmount=${l.netAmount}` +
    (l.description ? ` (${l.description})` : '')
  ).join('\n');

  const swapRateNote = input.vendorSwapErrorRate > 0.05
    ? `\nNote: this vendor has a historical field swap error rate of ${(input.vendorSwapErrorRate * 100).toFixed(1)}% — elevated prior probability of swap.`
    : '';

  return `Analyse these invoice lines against the corresponding PO lines for evidence of field swap errors (qty and unitPrice values transposed, either within a line or across lines).${swapRateNote}

Currency: ${input.currency}

INVOICE LINES:
${invoiceTable}

PO LINES:
${poTable}

A field swap is present when:
1. invoice qty ≈ PO unitPrice AND invoice unitPrice ≈ PO qty (within-line transposition), OR
2. values from line N on the invoice appear on line M of the PO and vice versa (cross-line swap), OR
3. qty * unitPrice ≠ netAmount (arithmetic inconsistency suggesting field corruption)

Respond with ONLY this JSON object:
{
  "isSwap": boolean,
  "confidence": number,
  "swappedFields": [
    { "lineNumber": number, "field": "qty|unitPrice|netAmount", "invoiceValue": number, "expectedValue": number }
  ],
  "explanation": "string — clear explanation of what was swapped and why you believe this",
  "correctedLines": [
    { "lineNumber": number, "correctedQty": number, "correctedUnitPrice": number, "correctedNetAmount": number }
  ]
}

If no swap is detected, set isSwap=false, confidence to your certainty of absence, swappedFields=[], correctedLines=[].`;
}
