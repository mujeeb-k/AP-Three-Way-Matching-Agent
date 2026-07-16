import { describe, it, expect } from '@jest/globals';
import { detectWrongPoReference, detectEntityMismatch, detectCurrencyMismatch } from '../../srv/lib/agent/discrepancy/wrong-po-reference.js';
import type { InvoiceInput } from '../../srv/lib/agent/types.js';
import type { PurchaseOrder } from '../../srv/lib/adapters/types.js';

const BASE_INVOICE: InvoiceInput = {
  source: 'API',
  vendorId: '0000100001',
  companyCode: '1000',
  currency: 'EUR',
  totalAmount: 1000,
  poNumber: '4500001001',
  lines: [{ lineNumber: 10, quantity: 10, unitPrice: 100, netAmount: 1000 }],
};

const OPEN_PO: PurchaseOrder = {
  poNumber: '4500001001',
  vendorId: '0000100001',
  companyCode: '1000',
  purchasingOrg: '1000',
  currency: 'EUR',
  status: 'OPEN',
  createdAt: '2025-01-01',
  lines: [],
};

describe('detectWrongPoReference', () => {
  it('returns CRITICAL candidate when PO is null', () => {
    const results = detectWrongPoReference(BASE_INVOICE, null);
    expect(results).toHaveLength(1);
    expect(results[0].discrepancyType).toBe('WRONG_PO_REFERENCE');
    expect(results[0].rulesConfidence).toBe(1.0);
  });

  it('returns HIGH candidate when PO is CANCELLED', () => {
    const cancelledPo = { ...OPEN_PO, status: 'CANCELLED' };
    const results = detectWrongPoReference(BASE_INVOICE, cancelledPo);
    expect(results).toHaveLength(1);
    expect(results[0].detectedFields[0].field).toBe('poStatus');
  });

  it('returns candidate when vendor on invoice ≠ vendor on PO', () => {
    const wrongVendorPo = { ...OPEN_PO, vendorId: '0000100002' };
    const results = detectWrongPoReference(BASE_INVOICE, wrongVendorPo);
    expect(results.some(r => r.detectedFields[0].field === 'vendorId')).toBe(true);
  });

  it('returns empty array for a clean match', () => {
    const results = detectWrongPoReference(BASE_INVOICE, OPEN_PO);
    expect(results).toHaveLength(0);
  });
});

describe('detectEntityMismatch', () => {
  it('detects company code mismatch', () => {
    const wrongCcPo = { ...OPEN_PO, companyCode: '2000' };
    const result = detectEntityMismatch(BASE_INVOICE, wrongCcPo);
    expect(result).not.toBeNull();
    expect(result!.discrepancyType).toBe('ENTITY_MISMATCH');
  });

  it('returns null when company codes match', () => {
    expect(detectEntityMismatch(BASE_INVOICE, OPEN_PO)).toBeNull();
  });
});

describe('detectCurrencyMismatch', () => {
  it('detects currency mismatch', () => {
    const usdPo = { ...OPEN_PO, currency: 'USD' };
    const result = detectCurrencyMismatch(BASE_INVOICE, usdPo);
    expect(result).not.toBeNull();
    expect(result!.discrepancyType).toBe('CURRENCY_MISMATCH');
    expect(result!.rulesConfidence).toBe(1.0);
  });

  it('returns null when currencies match', () => {
    expect(detectCurrencyMismatch(BASE_INVOICE, OPEN_PO)).toBeNull();
  });
});
