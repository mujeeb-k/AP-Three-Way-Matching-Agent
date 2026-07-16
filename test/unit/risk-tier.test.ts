import { describe, it, expect } from '@jest/globals';
import { assignRiskTier } from '../../srv/lib/agent/diagnosis/risk-tier.js';
import type { DiscrepancyCandidate, AgentRuntimeConfig } from '../../srv/lib/agent/types.js';

const CONFIG: AgentRuntimeConfig = {
  autoCorrectThreshold: 0.92, autoApproveThreshold: 0.85,
  activeDiscrepancyTypes: [], fieldSwapAlwaysLlm: true,
  tolPricePct: 10, tolPriceAbs: 1000, tolQtyPct: 5, tolQtyAbs: 500,
  tolReceiptVsPoPct: 5, tolInvoiceVsReceipt: 0,
  tolInvVsPoQtyPct: 10, tolInvVsPoQtyAbs: 1,
  tolInvVsPoAmountPct: 10, tolInvVsPoAmountAbs: 1000,
  amountThresholdCritical: 50000,
};

function makeCandidate(overrides: Partial<DiscrepancyCandidate>): DiscrepancyCandidate {
  return {
    discrepancyType: 'PRICE_VARIANCE',
    requiresHumanReview: false,
    rulesConfidence: 0.8,
    detectedFields: [],
    description: '',
    proposedCorrections: [],
    ...overrides,
  };
}

describe('assignRiskTier', () => {
  it('assigns CRITICAL when invoice exceeds amount threshold', () => {
    const candidate = makeCandidate({ discrepancyType: 'PRICE_VARIANCE' });
    const { riskTier } = assignRiskTier(candidate, 60000, CONFIG);
    expect(riskTier).toBe('CRITICAL');
  });

  it('assigns CRITICAL for DUPLICATE', () => {
    const candidate = makeCandidate({ discrepancyType: 'DUPLICATE', rulesConfidence: 1.0 });
    const { riskTier } = assignRiskTier(candidate, 1000, CONFIG);
    expect(riskTier).toBe('CRITICAL');
  });

  it('assigns CRITICAL for WRONG_PO_REFERENCE with invalid PO', () => {
    const candidate = makeCandidate({
      discrepancyType: 'WRONG_PO_REFERENCE',
      detectedFields: [{ field: 'poNumber', invoiceValue: '9999999999', expectedValue: 'EXISTING_PO' }],
    });
    const { riskTier } = assignRiskTier(candidate, 1000, CONFIG);
    expect(riskTier).toBe('CRITICAL');
  });

  it('assigns HIGH for FIELD_SWAP with confidence >= 0.9', () => {
    const candidate = makeCandidate({ discrepancyType: 'FIELD_SWAP', llmConfidence: 0.95 });
    const { riskTier } = assignRiskTier(candidate, 1000, CONFIG);
    expect(riskTier).toBe('HIGH');
  });

  it('assigns MEDIUM for FIELD_SWAP with confidence 0.7–0.9', () => {
    const candidate = makeCandidate({ discrepancyType: 'FIELD_SWAP', llmConfidence: 0.80 });
    const { riskTier } = assignRiskTier(candidate, 1000, CONFIG);
    expect(riskTier).toBe('MEDIUM');
  });

  it('assigns LOW for INVOICE_BEFORE_GR', () => {
    const candidate = makeCandidate({ discrepancyType: 'INVOICE_BEFORE_GR' });
    const { riskTier } = assignRiskTier(candidate, 1000, CONFIG);
    expect(riskTier).toBe('LOW');
  });
});
