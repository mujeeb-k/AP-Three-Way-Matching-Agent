import type { InvoiceInput, DiscrepancyCandidate, AgentRuntimeConfig } from '../types.js';
import type { PurchaseOrder, VendorMaster } from '../../adapters/types.js';
import type { IAIProvider } from '../../ai/types.js';
import { LlmFieldSwapResponseSchema } from '../../ai/types.js';
import { buildFieldSwapPrompt } from '../prompts/field-swap.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { multiply, absDiff, pctDiff } from '../../util/currency.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('detector:field-swap');

const SWAP_TOLERANCE_PCT = 2; // Values within 2% of each other count as "matching" for swap detection

/**
 * FIELD_SWAP detector.
 *
 * Rules-based pre-check (three scenarios from client data):
 *   Scenario A: PO qty=10 price=100, Invoice qty=100 price=10 — classic transposition
 *   Scenario B: PO qty=100 price=10, Invoice qty=10 price=100 — reverse transposition
 *   Scenario C: PO qty=10 price=100, Invoice qty=1 price=1000 — same total, different split
 *
 *   Check 1: qty × unitPrice ≠ netAmount (arithmetic inconsistency within invoice line)
 *   Check 2: invoiceQty ≈ poUnitPrice AND invoiceUnitPrice ≈ poQty (values literally swapped — A, B)
 *   Check 3: invoice qty×price total ≈ PO qty×price total (same financial value, different split — A, B, C)
 *   Check 4: Cross-line: values from line A appear on line B
 *
 * When Check 3 fires, we attempt swap verification:
 *   - Construct swapped values (qty=poQty, price=poUnitPrice)
 *   - Check if swapped invoice would match PO (both qty and price within tolerance)
 *   - swapResolved=true → requiresHumanReview=false, AUTO_CORRECTED path
 *   - swapResolved=false → requiresHumanReview=true, FLAGGED_REVIEW path
 *
 * If pre-check fires → LLM call (always, or skip when field_swap_always_llm=false and confidence=1.0).
 */
export async function detectFieldSwap(
  invoice: InvoiceInput,
  po: PurchaseOrder,
  vendor: VendorMaster | null,
  ai: IAIProvider,
  config: AgentRuntimeConfig,
): Promise<DiscrepancyCandidate | null> {
  if (!invoice.lines.length || !po.lines.length) return null;

  // ── Step 1: Rules-based pre-check ──────────────────────────────────────────
  const suspects = findSwapSuspects(invoice, po);
  if (suspects.length === 0) return null;

  log.debug({ invoiceId: invoice.externalId, suspects: suspects.length }, 'FIELD_SWAP suspects found — calling LLM');

  // ── Step 2: LLM reasoning ──────────────────────────────────────────────────
  const alwaysLlm = config.fieldSwapAlwaysLlm;
  const rulesConfidence = suspects[0].rulesConfidence;

  // Skip LLM only if configured AND rules gave perfect confidence AND swap was verified
  if (!alwaysLlm && rulesConfidence >= 1.0 && !suspects[0].requiresHumanReview) {
    log.debug('Skipping LLM — rules confidence 1.0 and field_swap_always_llm=false and swap verified');
    return suspects[0];
  }

  const systemPrompt = buildSystemPrompt(config);
  const userPrompt = buildFieldSwapPrompt({
    invoiceLines: invoice.lines,
    poLines: po.lines,
    currency: invoice.currency,
    vendorSwapErrorRate: vendor?.swapErrorRate ?? 0,
  });

  const response = await ai.complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0,
  });

  // ── Step 3: Zod-validate LLM response ─────────────────────────────────────
  let parsed;
  try {
    parsed = LlmFieldSwapResponseSchema.parse(JSON.parse(response.content));
  } catch (err) {
    log.warn({ err, raw: response.content }, 'LLM response failed Zod validation — using rules result');
    return suspects[0];
  }

  if (!parsed.isSwap) {
    log.debug({ confidence: parsed.confidence }, 'LLM says no swap');
    return null;
  }

  // ── Step 4: Merge LLM findings into candidate ──────────────────────────────
  // Preserve swap resolution status from rules: if rules determined swap resolves
  // the match, keep requiresHumanReview=false so AUTO_CORRECTED path is available
  const rulesCandidate = suspects[0];
  const candidate: DiscrepancyCandidate = {
    ...rulesCandidate,
    llmConfidence: parsed.confidence,
    llmExplanation: parsed.explanation,
    llmReasoned: true,
    detectedFields: parsed.swappedFields.map(f => ({
      field: f.field,
      invoiceValue: f.invoiceValue,
      expectedValue: f.expectedValue,
    })),
    proposedCorrections: parsed.correctedLines.flatMap(cl => {
      const corrections = [];
      const origLine = invoice.lines.find(l => l.lineNumber === cl.lineNumber);
      if (!origLine) return [];
      if (cl.correctedQty !== undefined && cl.correctedQty !== origLine.quantity) {
        corrections.push({ lineNumber: cl.lineNumber, field: 'quantity' as const, before: origLine.quantity, after: cl.correctedQty });
      }
      if (cl.correctedUnitPrice !== undefined && cl.correctedUnitPrice !== origLine.unitPrice) {
        corrections.push({ lineNumber: cl.lineNumber, field: 'unitPrice' as const, before: origLine.unitPrice, after: cl.correctedUnitPrice });
      }
      if (cl.correctedNetAmount !== undefined && cl.correctedNetAmount !== origLine.netAmount) {
        corrections.push({ lineNumber: cl.lineNumber, field: 'netAmount' as const, before: origLine.netAmount, after: cl.correctedNetAmount });
      }
      return corrections;
    }),
    description: parsed.explanation,
    // Preserve rules-derived swap resolution — LLM confirms isSwap but we keep
    // the structural determination of whether the swap resolves the 3-way match
    requiresHumanReview: rulesCandidate.requiresHumanReview,
  };

  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules-based pre-check — returns candidate(s) before LLM call
// ─────────────────────────────────────────────────────────────────────────────

function findSwapSuspects(invoice: InvoiceInput, po: PurchaseOrder): DiscrepancyCandidate[] {
  const flaggedLines: number[] = [];
  let confidence = 0;
  const detectedFields = [];
  let swapResolvesMatch = false;

  for (const invLine of invoice.lines) {
    const poLine = po.lines.find(p => p.lineNumber === invLine.poLine || p.lineNumber === invLine.lineNumber);
    if (!poLine) continue;

    // Check 1: arithmetic inconsistency (qty * unitPrice ≠ netAmount within invoice line)
    const expectedNet = multiply(invLine.quantity, invLine.unitPrice);
    const arithmeticDiff = absDiff(expectedNet.toNumber(), invLine.netAmount);
    const arithmeticFlag = arithmeticDiff.gt(0.01); // > 1 cent tolerance

    // Check 2: within-line transposition (invoiceQty ≈ poUnitPrice AND invoiceUnitPrice ≈ poQty)
    // Covers Scenarios A and B directly
    const qtyMatchesPoPrice = pctDiff(invLine.quantity, poLine.unitPrice).lte(SWAP_TOLERANCE_PCT);
    const priceMatchesPoQty = pctDiff(invLine.unitPrice, poLine.quantity).lte(SWAP_TOLERANCE_PCT);
    const transpositionFlag = qtyMatchesPoPrice && priceMatchesPoQty;

    // Check 3: total match (invoice qty×price ≈ PO qty×price) — covers all three scenarios
    // If totals match, the invoice has the right financial amount but wrong field split.
    // Only relevant when qty or price actually differ — if both match exactly, no swap needed.
    const invTotal = multiply(invLine.quantity, invLine.unitPrice).toNumber();
    const poTotal  = multiply(poLine.quantity, poLine.unitPrice).toNumber();
    const valuesActuallyDiffer = !pctDiff(invLine.quantity, poLine.quantity).lte(SWAP_TOLERANCE_PCT)
                               || !pctDiff(invLine.unitPrice, poLine.unitPrice).lte(SWAP_TOLERANCE_PCT);
    const totalMatchFlag = valuesActuallyDiffer
      && pctDiff(invTotal, poTotal).lte(SWAP_TOLERANCE_PCT)
      && poTotal > 0;

    let lineSwapResolved = false;
    if (totalMatchFlag && (transpositionFlag || !arithmeticFlag)) {
      // Verify swap: if we correct the invoice to PO values (qty=poQty, price=poPrice),
      // does the corrected total match the PO total? And do the invoice values actually
      // differ from PO (so a correction is meaningful)?
      const correctedTotal = multiply(poLine.quantity, poLine.unitPrice).toNumber();
      const correctedMatchesPo = pctDiff(correctedTotal, poTotal).lte(SWAP_TOLERANCE_PCT);
      // valuesActuallyDiffer is already true (ensured by totalMatchFlag), but be explicit:
      const invoiceDiffersFromPo = !pctDiff(invLine.quantity, poLine.quantity).lte(SWAP_TOLERANCE_PCT)
                                 || !pctDiff(invLine.unitPrice, poLine.unitPrice).lte(SWAP_TOLERANCE_PCT);
      lineSwapResolved = correctedMatchesPo && invoiceDiffersFromPo;
    }

    if (arithmeticFlag || transpositionFlag || totalMatchFlag) {
      flaggedLines.push(invLine.lineNumber);

      if (transpositionFlag) {
        // Scenarios A/B: values literally match each other's fields — highest confidence
        confidence = Math.max(confidence, 1.0);
        detectedFields.push(
          { field: 'quantity',  invoiceValue: invLine.quantity,  expectedValue: poLine.quantity,  poValue: poLine.quantity },
          { field: 'unitPrice', invoiceValue: invLine.unitPrice, expectedValue: poLine.unitPrice, poValue: poLine.unitPrice },
        );
        if (lineSwapResolved) swapResolvesMatch = true;
      } else if (totalMatchFlag && !transpositionFlag) {
        // Scenario C: totals match but not a literal transpose — LLM needed to determine correction
        confidence = Math.max(confidence, 0.85);
        detectedFields.push(
          { field: 'quantity',  invoiceValue: invLine.quantity,  expectedValue: poLine.quantity,  poValue: poLine.quantity },
          { field: 'unitPrice', invoiceValue: invLine.unitPrice, expectedValue: poLine.unitPrice, poValue: poLine.unitPrice },
          { field: 'lineTotal', invoiceValue: invTotal,          expectedValue: poTotal },
        );
        if (lineSwapResolved) swapResolvesMatch = true;
      } else if (arithmeticFlag) {
        // Arithmetic inconsistency only — weak signal
        confidence = Math.max(confidence, 0.70);
        detectedFields.push({
          field: 'netAmount',
          invoiceValue: invLine.netAmount,
          expectedValue: expectedNet.toDecimalPlaces(2).toNumber(),
        });
      }
    }
  }

  // Check 4: cross-line swap (values from line A appear on line B)
  if (invoice.lines.length >= 2) {
    for (let i = 0; i < invoice.lines.length; i++) {
      for (let j = i + 1; j < invoice.lines.length; j++) {
        const a = invoice.lines[i];
        const b = invoice.lines[j];
        const crossSwap =
          pctDiff(a.quantity, b.unitPrice).lte(SWAP_TOLERANCE_PCT) &&
          pctDiff(a.unitPrice, b.quantity).lte(SWAP_TOLERANCE_PCT);
        if (crossSwap) {
          flaggedLines.push(a.lineNumber, b.lineNumber);
          confidence = Math.max(confidence, 0.90);
          detectedFields.push(
            { field: `line${a.lineNumber}.quantity`, invoiceValue: a.quantity, expectedValue: b.quantity },
            { field: `line${b.lineNumber}.quantity`, invoiceValue: b.quantity, expectedValue: a.quantity },
          );
        }
      }
    }
  }

  if (flaggedLines.length === 0) return [];

  // Build proposed corrections based on the first flagged line where swap was verified
  const proposedCorrections: Array<{ lineNumber: number; field: 'quantity' | 'unitPrice' | 'netAmount'; before: number; after: number }> = [];
  for (const invLine of invoice.lines) {
    if (!flaggedLines.includes(invLine.lineNumber)) continue;
    const poLine = po.lines.find(p => p.lineNumber === invLine.poLine || p.lineNumber === invLine.lineNumber);
    if (!poLine) continue;
    const invTotal = multiply(invLine.quantity, invLine.unitPrice).toNumber();
    const poTotal  = multiply(poLine.quantity, poLine.unitPrice).toNumber();
    if (pctDiff(invTotal, poTotal).lte(SWAP_TOLERANCE_PCT)) {
      // Only propose corrections when swap resolves the match
      if (invLine.quantity !== poLine.quantity) {
        proposedCorrections.push({ lineNumber: invLine.lineNumber, field: 'quantity',  before: invLine.quantity,  after: poLine.quantity });
      }
      if (invLine.unitPrice !== poLine.unitPrice) {
        proposedCorrections.push({ lineNumber: invLine.lineNumber, field: 'unitPrice', before: invLine.unitPrice, after: poLine.unitPrice });
      }
    }
  }

  return [{
    discrepancyType: 'FIELD_SWAP',
    // If the swap verifies (corrected invoice matches PO), allow AUTO_CORRECTED path
    requiresHumanReview: !swapResolvesMatch,
    rulesConfidence: confidence,
    detectedFields,
    description: buildDescription(flaggedLines, swapResolvesMatch, invoice, po),
    proposedCorrections,
  }];
}

function buildDescription(
  flaggedLines: number[],
  swapResolvesMatch: boolean,
  invoice: InvoiceInput,
  po: PurchaseOrder,
): string {
  const lines = [...new Set(flaggedLines)].join(', ');
  if (swapResolvesMatch) {
    const invLine = invoice.lines.find(l => flaggedLines.includes(l.lineNumber));
    const poLine  = invLine ? po.lines.find(p => p.lineNumber === invLine.poLine || p.lineNumber === invLine.lineNumber) : null;
    if (invLine && poLine) {
      return `Field swap detected on line(s) ${lines}: invoice shows qty=${invLine.quantity} @ ${invLine.unitPrice} but PO expects qty=${poLine.quantity} @ ${poLine.unitPrice}. Totals match (${multiply(invLine.quantity, invLine.unitPrice).toDecimalPlaces(2)}). Swap verified — applying PO values resolves the 3-way match.`;
    }
  }
  return `Potential field swap on line(s) ${lines}: invoice qty×price total matches PO total but field values differ. Swap does not fully resolve match — requires clerk review.`;
}
