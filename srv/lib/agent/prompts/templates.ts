import type { DiscrepancyTypeName, DetectedField } from '../types.js';
import type { PurchaseOrder } from '../../adapters/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Generic discrepancy diagnosis prompt.
// Used for discrepancy types that need LLM confirmation or diagnosis detail
// beyond what the rules-based check provides.
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosisPromptInput {
  discrepancyType: DiscrepancyTypeName;
  detectedFields: DetectedField[];
  rulesDescription: string;
  po?: Pick<PurchaseOrder, 'poNumber' | 'vendorId' | 'currency' | 'status'>;
  grSummary?: string;
  invoiceSummary: string;
}

export function buildDiagnosisPrompt(input: DiagnosisPromptInput): string {
  const poSection = input.po
    ? `\nPO DATA:\n  PO Number: ${input.po.poNumber}, Vendor: ${input.po.vendorId}, Currency: ${input.po.currency}, Status: ${input.po.status}`
    : '';

  const grSection = input.grSummary
    ? `\nGR DATA:\n  ${input.grSummary}`
    : '\nGR DATA: No goods receipt found.';

  const fieldsSection = input.detectedFields.length > 0
    ? '\nDETECTED FIELDS:\n' + input.detectedFields.map(f =>
        `  ${f.field}: invoice=${f.invoiceValue}, expected=${f.expectedValue}` +
        (f.poValue !== undefined ? `, po=${f.poValue}` : '')
      ).join('\n')
    : '';

  return `A rules-based check has flagged a potential ${input.discrepancyType} discrepancy on this invoice.

Rules finding: ${input.rulesDescription}
${fieldsSection}
INVOICE: ${input.invoiceSummary}${poSection}${grSection}

Provide a root-cause diagnosis. Respond with ONLY this JSON object:
{
  "hasDiscrepancy": boolean,
  "discrepancyType": "${input.discrepancyType}",
  "confidence": number,
  "riskTier": "LOW|MEDIUM|HIGH|CRITICAL",
  "explanation": "string — precise root-cause explanation for the AP clerk",
  "suggestedAction": "string — recommended resolution step",
  "detectedFields": [
    { "field": "string", "invoiceValue": value, "expectedValue": value, "poValue": value }
  ]
}`;
}
