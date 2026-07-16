import type { DiscrepancyCandidate, AgentRuntimeConfig, AgentDecision } from '../types.js';
import { decideCandidate, computeFinalDecision } from './confidence.js';
import { applyCorrections } from './auto-correct.js';
import type { InvoiceInput } from '../types.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('resolution:index');

export interface ResolutionResult {
  candidates: DiscrepancyCandidate[];
  finalDecision: AgentDecision;
  correctedInvoice: InvoiceInput;
}

/**
 * DECIDE_ACT step — determines AgentDecision for each candidate,
 * applies corrections in-memory, and computes the overall invoice decision.
 */
export function resolve(
  invoice: InvoiceInput,
  candidates: DiscrepancyCandidate[],
  config: AgentRuntimeConfig,
): ResolutionResult {
  // Assign decision to each candidate
  for (const candidate of candidates) {
    candidate.agentDecision = decideCandidate(candidate, config);
    candidate.decisionReason = buildDecisionReason(candidate);
    log.debug({ type: candidate.discrepancyType, decision: candidate.agentDecision }, 'Decision assigned');
  }

  // Apply in-memory corrections for AUTO_CORRECTED candidates
  const toCorrect = candidates.filter(c => c.agentDecision === 'AUTO_CORRECTED');
  const correctedInvoice = applyCorrections(invoice, toCorrect);

  const finalDecision = computeFinalDecision(candidates);

  return { candidates, finalDecision, correctedInvoice };
}

function buildDecisionReason(candidate: DiscrepancyCandidate): string {
  const confidence = ((candidate.llmConfidence ?? candidate.rulesConfidence) * 100).toFixed(0);
  switch (candidate.agentDecision) {
    case 'AUTO_CORRECTED':
      return `Confidence ${confidence}% — corrections proposed for ${candidate.proposedCorrections.length} field(s). Awaiting human acceptance.`;
    case 'PENDING_GR':
      return 'Invoice arrived before goods receipt — parked, will reprocess automatically when GR is posted.';
    case 'ESCALATED':
      return `CRITICAL risk (${candidate.riskRationale}) — routed to approval chain.`;
    case 'FLAGGED_REVIEW':
      return `Confidence ${confidence}%, risk ${candidate.riskTier} — requires AP clerk review.`;
    case 'FLAGGED_REJECT':
      return `Confidence ${confidence}% — insufficient evidence to auto-correct. Recommend return to vendor.`;
    default:
      return candidate.riskRationale ?? '';
  }
}
