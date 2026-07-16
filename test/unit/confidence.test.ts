import { describe, it, expect } from '@jest/globals';
import { decideCandidate, computeFinalDecision } from '../../srv/lib/agent/resolution/confidence.js';
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
    riskTier: 'MEDIUM',
    detectedFields: [],
    description: '',
    proposedCorrections: [],
    ...overrides,
  };
}

describe('decideCandidate', () => {
  it('returns PENDING_GR for INVOICE_BEFORE_GR', () => {
    const c = makeCandidate({ discrepancyType: 'INVOICE_BEFORE_GR' });
    expect(decideCandidate(c, CONFIG)).toBe('PENDING_GR');
  });

  it('returns ESCALATED for CRITICAL risk', () => {
    const c = makeCandidate({ riskTier: 'CRITICAL' });
    expect(decideCandidate(c, CONFIG)).toBe('ESCALATED');
  });

  it('returns AUTO_CORRECTED when confidence >= threshold and corrections exist', () => {
    const c = makeCandidate({
      requiresHumanReview: false,
      llmConfidence: 0.95,
      riskTier: 'MEDIUM',
      proposedCorrections: [{ lineNumber: 10, field: 'unitPrice', before: 108, after: 100 }],
    });
    expect(decideCandidate(c, CONFIG)).toBe('AUTO_CORRECTED');
  });

  it('returns FLAGGED_REVIEW for requiresHumanReview=true even with high confidence and corrections', () => {
    const c = makeCandidate({
      discrepancyType: 'DUPLICATE',
      requiresHumanReview: true,
      llmConfidence: 1.0,
      riskTier: 'MEDIUM',
      proposedCorrections: [],
    });
    expect(decideCandidate(c, CONFIG)).toBe('FLAGGED_REVIEW');
  });

  it('returns FLAGGED_REVIEW for requiresHumanReview=true FIELD_SWAP with corrections', () => {
    const c = makeCandidate({
      discrepancyType: 'FIELD_SWAP',
      requiresHumanReview: true,
      llmConfidence: 0.97,
      riskTier: 'HIGH',
      proposedCorrections: [{ lineNumber: 1, field: 'quantity', before: 100, after: 5 }],
    });
    expect(decideCandidate(c, CONFIG)).toBe('FLAGGED_REVIEW');
  });

  it('returns FLAGGED_REVIEW for HIGH risk even with high confidence', () => {
    const c = makeCandidate({ llmConfidence: 0.95, riskTier: 'HIGH', proposedCorrections: [] });
    expect(decideCandidate(c, CONFIG)).toBe('FLAGGED_REVIEW');
  });

  it('returns FLAGGED_REJECT for very low confidence', () => {
    const c = makeCandidate({ rulesConfidence: 0.30, riskTier: 'LOW', proposedCorrections: [] });
    expect(decideCandidate(c, CONFIG)).toBe('FLAGGED_REJECT');
  });
});

describe('computeFinalDecision', () => {
  it('returns NO_DISCREPANCY for empty candidates', () => {
    expect(computeFinalDecision([])).toBe('NO_DISCREPANCY');
  });

  it('returns worst-case decision across candidates', () => {
    const candidates = [
      makeCandidate({ agentDecision: 'AUTO_CORRECTED' }),
      makeCandidate({ agentDecision: 'ESCALATED' }),
      makeCandidate({ agentDecision: 'FLAGGED_REVIEW' }),
    ];
    expect(computeFinalDecision(candidates)).toBe('ESCALATED');
  });

  it('returns FLAGGED_REVIEW when all are FLAGGED_REVIEW', () => {
    const candidates = [
      makeCandidate({ agentDecision: 'FLAGGED_REVIEW' }),
      makeCandidate({ agentDecision: 'FLAGGED_REVIEW' }),
    ];
    expect(computeFinalDecision(candidates)).toBe('FLAGGED_REVIEW');
  });
});
