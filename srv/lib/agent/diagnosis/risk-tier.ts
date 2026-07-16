import type { DiscrepancyCandidate, RiskTier, AgentRuntimeConfig } from '../types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('diagnosis:risk-tier');

/**
 * Assigns a RiskTier to each discrepancy candidate.
 *
 * Risk tier assignment rules:
 *   CRITICAL : DUPLICATE | WRONG_PO_REFERENCE (invalid PO) | any discrepancy on invoice > amountThreshold
 *   HIGH     : WRONG_PO_REFERENCE (status/vendor) | ENTITY_MISMATCH | CURRENCY_MISMATCH |
 *              FIELD_SWAP (confidence > 0.9) | PRICE_VARIANCE > 20%
 *   MEDIUM   : FIELD_SWAP (0.7–0.9) | QTY_VARIANCE > 10% | PRICE_VARIANCE 5–20% |
 *              INVOICE_BEFORE_GR | LINE_STRUCTURE | MULTI_PO
 *   LOW      : PRICE_VARIANCE < 5% | QTY_VARIANCE < 10% | MISSING_GR (first occurrence) |
 *              INVOICE_BEFORE_GR (GR exists but predates invoice)
 */
export function assignRiskTier(
  candidate: DiscrepancyCandidate,
  invoiceTotalAmount: number,
  config: AgentRuntimeConfig,
): { riskTier: RiskTier; riskRationale: string } {
  const confidence = candidate.llmConfidence ?? candidate.rulesConfidence;
  let tier: RiskTier;
  let rationale: string;

  // Amount-based override — always escalates to CRITICAL
  if (invoiceTotalAmount >= config.amountThresholdCritical) {
    tier = 'CRITICAL';
    rationale = `Invoice total ${invoiceTotalAmount} exceeds critical threshold ${config.amountThresholdCritical}`;
    return { riskTier: tier, riskRationale: rationale };
  }

  switch (candidate.discrepancyType) {
    case 'DUPLICATE':
      tier = 'CRITICAL';
      rationale = 'Exact duplicate invoice submission — potential double-payment risk';
      break;

    case 'WRONG_PO_REFERENCE': {
      // Sub-classify based on detected fields
      const fields = candidate.detectedFields;
      const isInvalidPo = fields.some(f => f.field === 'poNumber');
      const isStatusIssue = fields.some(f => f.field === 'poStatus');
      if (isInvalidPo) {
        tier = 'CRITICAL';
        rationale = 'Invoice references non-existent PO — cannot process without valid reference';
      } else {
        tier = 'HIGH';
        rationale = isStatusIssue
          ? 'Invoice references a closed/cancelled/blocked PO'
          : 'Invoice vendor does not match PO vendor';
      }
      break;
    }

    case 'ENTITY_MISMATCH':
      tier = 'HIGH';
      rationale = 'Invoice billed to wrong legal entity — financial posting would be incorrect';
      break;

    case 'CURRENCY_MISMATCH':
      tier = 'HIGH';
      rationale = 'Invoice currency differs from PO currency — FX risk and incorrect posting';
      break;

    case 'FIELD_SWAP':
      if (confidence >= 0.9) {
        tier = 'HIGH';
        rationale = `High-confidence field swap (${(confidence * 100).toFixed(0)}%) — values transposed in invoice`;
      } else if (confidence >= 0.7) {
        tier = 'MEDIUM';
        rationale = `Medium-confidence field swap (${(confidence * 100).toFixed(0)}%) — possible transposition`;
      } else {
        tier = 'LOW';
        rationale = `Low-confidence field swap (${(confidence * 100).toFixed(0)}%) — weak signal, needs review`;
      }
      break;

    case 'PRICE_VARIANCE': {
      const pctField = candidate.detectedFields.find(f => f.field === 'unitPrice');
      const pct = pctField
        ? Math.abs(Number(pctField.invoiceValue) - Number(pctField.poValue ?? pctField.expectedValue)) /
          Number(pctField.poValue ?? pctField.expectedValue) * 100
        : 0;
      if (pct >= 20) {
        tier = 'HIGH';
        rationale = `Price variance of ${pct.toFixed(1)}% exceeds HIGH threshold (20%)`;
      } else if (pct >= 5) {
        tier = 'MEDIUM';
        rationale = `Price variance of ${pct.toFixed(1)}% (5–20% range)`;
      } else {
        tier = 'LOW';
        rationale = `Minor price variance of ${pct.toFixed(1)}% — within review range`;
      }
      break;
    }

    case 'QTY_VARIANCE': {
      const qtyField = candidate.detectedFields.find(f => f.field === 'quantity');
      const pct = qtyField
        ? Math.abs(Number(qtyField.invoiceValue) - Number(qtyField.expectedValue)) /
          Number(qtyField.expectedValue) * 100
        : 0;
      if (pct >= 10) {
        tier = 'MEDIUM';
        rationale = `Quantity variance of ${pct.toFixed(1)}% exceeds tolerance`;
      } else {
        tier = 'LOW';
        rationale = `Minor quantity variance of ${pct.toFixed(1)}%`;
      }
      break;
    }

    case 'MISSING_GR':
      tier = 'MEDIUM';
      rationale = 'No goods receipt recorded — delivery may be pending or unrecorded';
      break;

    case 'INVOICE_BEFORE_GR':
      tier = 'LOW';
      rationale = 'Invoice arrived before GR posting — likely timing issue, will auto-reprocess on GR';
      break;

    case 'LINE_STRUCTURE':
      tier = 'MEDIUM';
      rationale = 'Invoice line structure differs from PO — may indicate consolidation or split lines';
      break;

    case 'MULTI_PO':
      tier = 'MEDIUM';
      rationale = 'Invoice spans multiple POs — requires cross-PO reconciliation';
      break;

    case 'UOM_MISMATCH': {
      const resolved = (candidate as any).uomResolved as boolean | undefined;
      if (resolved === true) {
        tier = 'LOW';
        rationale = 'UOM mismatch — conversion applied and 3-way match resolved automatically';
      } else if (resolved === false) {
        tier = 'MEDIUM';
        rationale = 'UOM mismatch — packaging/ambiguous units require clerk confirmation of conversion';
      } else {
        tier = 'MEDIUM';
        rationale = 'UOM mismatch — no known conversion, requires clerk verification';
      }
      break;
    }

    case 'SEPARATOR_AMBIGUITY': {
      const resolved = (candidate as any).separatorResolved as boolean | undefined;
      if (resolved === true) {
        tier = 'LOW';
        rationale = 'Separator normalisation applied — alternate interpretation resolves match';
      } else {
        tier = 'MEDIUM';
        rationale = 'Ambiguous number format — two valid interpretations with different financial impact';
      }
      break;
    }

    case 'MATERIAL_MISMATCH':
      tier = 'HIGH';
      rationale = 'Invoice material number differs from PO/GR — wrong item may have been delivered or invoiced';
      break;

    default:
      tier = 'MEDIUM';
      rationale = 'Discrepancy requires review';
  }

  log.debug({ type: candidate.discrepancyType, tier, confidence }, 'Risk tier assigned');

  return {
    riskTier: tier,
    riskRationale: rationale,
  };
}
