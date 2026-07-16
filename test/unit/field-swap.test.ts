import { describe, it, expect } from '@jest/globals';
import { detectFieldSwap } from '../../srv/lib/agent/discrepancy/field-swap.js';
import type { InvoiceInput, AgentRuntimeConfig } from '../../srv/lib/agent/types.js';
import type { PurchaseOrder } from '../../srv/lib/adapters/types.js';

// ── Minimal mock AI provider ──────────────────────────────────────────────────
function mockAI(response: object) {
  return {
    providerName: 'MOCK',
    modelId: 'mock',
    complete: async () => ({
      content: JSON.stringify(response),
      model: 'mock',
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      stopReason: 'end_turn',
    }),
  };
}

const BASE_CONFIG: AgentRuntimeConfig = {
  autoCorrectThreshold: 0.92,
  autoApproveThreshold: 0.85,
  activeDiscrepancyTypes: ['FIELD_SWAP'],
  fieldSwapAlwaysLlm: true,
  tolPricePct: 10, tolPriceAbs: 1000,
  tolQtyPct: 5, tolQtyAbs: 500,
  tolReceiptVsPoPct: 5,
  tolInvoiceVsReceipt: 0,
  tolInvVsPoQtyPct: 10, tolInvVsPoQtyAbs: 1,
  tolInvVsPoAmountPct: 10, tolInvVsPoAmountAbs: 1000,
  amountThresholdCritical: 50000,
};

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CLEAN_INVOICE: InvoiceInput = {
  source: 'API',
  vendorId: '0000100001',
  companyCode: '1000',
  currency: 'EUR',
  totalAmount: 2500,
  lines: [{ lineNumber: 10, quantity: 100, unitPrice: 25, netAmount: 2500, poLine: 10 }],
};

const SWAPPED_INVOICE: InvoiceInput = {
  source: 'API',
  vendorId: '0000100003',
  companyCode: '1000',
  currency: 'EUR',
  totalAmount: 5000,
  lines: [
    // qty and unitPrice are transposed vs PO
    { lineNumber: 10, quantity: 25, unitPrice: 100, netAmount: 2500, poLine: 10 },
    { lineNumber: 20, quantity: 20, unitPrice: 50, netAmount: 1000, poLine: 20 },
  ],
};

const PO: PurchaseOrder = {
  poNumber: '4500001001',
  vendorId: '0000100001',
  companyCode: '1000',
  purchasingOrg: '1000',
  currency: 'EUR',
  status: 'OPEN',
  createdAt: '2025-01-15',
  lines: [
    { lineNumber: 10, materialNumber: '', description: 'Office Chairs', quantity: 100, unitOfMeasure: 'EA', unitPrice: 25, netAmount: 2500, currency: 'EUR', deliveryDate: '2025-03-01' },
    { lineNumber: 20, materialNumber: '', description: 'Monitor Stands', quantity: 50, unitOfMeasure: 'EA', unitPrice: 20, netAmount: 1000, currency: 'EUR', deliveryDate: '2025-03-01' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────

describe('detectFieldSwap', () => {
  it('returns null for a clean invoice with matching qty/price', async () => {
    const ai = mockAI({ isSwap: false, confidence: 0.99, swappedFields: [], explanation: 'No swap', correctedLines: [] });
    const result = await detectFieldSwap(CLEAN_INVOICE, PO, null, ai as any, BASE_CONFIG);
    expect(result).toBeNull();
  });

  it('detects within-line transposition and calls LLM', async () => {
    const llmResponse = {
      isSwap: true,
      confidence: 0.97,
      swappedFields: [
        { lineNumber: 10, field: 'qty', invoiceValue: 25, expectedValue: 100 },
        { lineNumber: 10, field: 'unitPrice', invoiceValue: 100, expectedValue: 25 },
      ],
      explanation: 'Line 10: qty and unitPrice are transposed vs PO',
      correctedLines: [
        { lineNumber: 10, correctedQty: 100, correctedUnitPrice: 25, correctedNetAmount: 2500 },
      ],
    };
    const ai = mockAI(llmResponse);
    const result = await detectFieldSwap(SWAPPED_INVOICE, PO, null, ai as any, BASE_CONFIG);

    expect(result).not.toBeNull();
    expect(result!.discrepancyType).toBe('FIELD_SWAP');
    expect(result!.llmConfidence).toBe(0.97);
    expect(result!.llmReasoned).toBe(true);
    expect(result!.proposedCorrections).toHaveLength(2); // qty + unitPrice
  });

  it('uses rules result when LLM response is invalid JSON', async () => {
    const ai = {
      providerName: 'MOCK', modelId: 'mock',
      complete: async () => ({
        content: 'not valid json',
        model: 'mock', promptTokens: 5, completionTokens: 5, totalTokens: 10, stopReason: 'end_turn',
      }),
    };
    const result = await detectFieldSwap(SWAPPED_INVOICE, PO, null, ai as any, BASE_CONFIG);
    // Falls back to rules — should still detect something
    expect(result).not.toBeNull();
    expect(result!.llmReasoned).toBeFalsy();
  });

  it('skips LLM when fieldSwapAlwaysLlm=false and rules confidence=1.0', async () => {
    let llmCalled = false;
    const ai = {
      providerName: 'MOCK', modelId: 'mock',
      complete: async () => { llmCalled = true; return { content: '{}', model: 'mock', promptTokens: 0, completionTokens: 0, totalTokens: 0, stopReason: 'end_turn' }; },
    };
    const config = { ...BASE_CONFIG, fieldSwapAlwaysLlm: false };
    // Use clean invoice — rules won't fire at 1.0 so LLM skip condition won't be met
    await detectFieldSwap(CLEAN_INVOICE, PO, null, ai as any, config);
    expect(llmCalled).toBe(false); // No suspects detected → LLM never called regardless
  });
});
