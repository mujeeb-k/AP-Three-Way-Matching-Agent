import type { DiscrepancyCandidate, AgentDecision, AgentRuntimeConfig } from '../types.js';

/**
 * Determines the AgentDecision for a single discrepancy candidate.
 *
 * Decision ladder (from most favourable to least):
 *   AUTO_RESOLVED  — no action needed (within-tolerance — handled upstream, not here)
 *   AUTO_CORRECTED — requiresHumanReview=false + high confidence + deterministic corrections
 *   PENDING_GR     — INVOICE_BEFORE_GR type
 *   FLAGGED_REVIEW — requiresHumanReview=true, or medium/low confidence, or HIGH risk
 *   FLAGGED_REJECT — confidence too low to auto-correct or very high risk with no correction
 *   ESCALATED      — CRITICAL risk tier
 */
export function decideCandidate(
  candidate: DiscrepancyCandidate,
  config: AgentRuntimeConfig,
): AgentDecision {
  const confidence = candidate.llmConfidence ?? candidate.rulesConfidence;
  const { riskTier, discrepancyType, proposedCorrections } = candidate;

  // INVOICE_BEFORE_GR always parks
  if (discrepancyType === 'INVOICE_BEFORE_GR') return 'PENDING_GR';

  // CRITICAL always escalates
  if (riskTier === 'CRITICAL') return 'ESCALATED';

  // Types that must never be auto-corrected — always need a human
  if (candidate.requiresHumanReview) return 'FLAGGED_REVIEW';

  // requiresHumanReview: false — agent can auto-correct if corrections are deterministic
  if (confidence >= config.autoCorrectThreshold && proposedCorrections.length > 0) {
    return 'AUTO_CORRECTED';
  }

  // HIGH risk → FLAGGED_REVIEW regardless of confidence
  if (riskTier === 'HIGH') return 'FLAGGED_REVIEW';

  // Medium/high confidence → FLAGGED_REVIEW
  if (confidence >= config.autoApproveThreshold) return 'FLAGGED_REVIEW';

  // Low confidence on a discrepancy that can't be auto-corrected → FLAGGED_REJECT
  if (confidence < 0.50) return 'FLAGGED_REJECT';

  return 'FLAGGED_REVIEW';
}

/**
 * Computes the overall invoice-level decision (worst-case across all candidates).
 */
export function computeFinalDecision(candidates: DiscrepancyCandidate[]): AgentDecision {
  if (candidates.length === 0) return 'NO_DISCREPANCY';

  const order: AgentDecision[] = [
    'NO_DISCREPANCY',
    'AUTO_RESOLVED',
    'AUTO_CORRECTED',
    'PENDING_GR',
    'FLAGGED_REVIEW',
    'FLAGGED_REJECT',
    'ESCALATED',
  ];

  let worst: AgentDecision = 'NO_DISCREPANCY';
  for (const c of candidates) {
    if (c.agentDecision) {
      if (order.indexOf(c.agentDecision) > order.indexOf(worst)) {
        worst = c.agentDecision;
      }
    }
  }
  return worst;
}
