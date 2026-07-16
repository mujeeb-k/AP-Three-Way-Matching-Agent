import type { DiscrepancyCandidate, AgentRuntimeConfig } from '../types.js';
import { assignRiskTier } from './risk-tier.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('diagnosis:index');

/**
 * DIAGNOSE step — assigns risk tier to all candidates.
 * Mutates candidates in place (adds riskTier, riskRationale).
 */
export function diagnose(
  candidates: DiscrepancyCandidate[],
  invoiceTotalAmount: number,
  config: AgentRuntimeConfig,
): void {
  for (const candidate of candidates) {
    const { riskTier, riskRationale } = assignRiskTier(
      candidate,
      invoiceTotalAmount,
      config,
    );
    candidate.riskTier = riskTier;
    candidate.riskRationale = riskRationale;
    log.debug({ type: candidate.discrepancyType, riskTier }, 'Diagnosed');
  }
}
