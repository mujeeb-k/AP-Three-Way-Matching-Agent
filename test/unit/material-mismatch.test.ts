import { describe, it, expect } from '@jest/globals';
import { detectMaterialMismatch } from '../../srv/lib/agent/discrepancy/material-mismatch.js';
import type { InvoiceInput } from '../../srv/lib/agent/types.js';
import type { PurchaseOrder, GoodsReceiptLine } from '../../srv/lib/adapters/types.js';

const BASE_PO: PurchaseOrder = {
  poNumber: '4500001016',
  vendorId: '0000100001',
  companyCode: '1000',
  purchasingOrg: '1000',
  currency: 'EUR',
  status: 'OPEN',
  createdAt: '2025-01-01',
  lines: [
    { lineNumber: 10, materialNumber: '000000000000000042', description: 'Industrial Pump', quantity: 20, unitOfMeasure: 'EA', unitPrice: 250, netAmount: 5000, currency: 'EUR', deliveryDate: '2026-05-15' },
    { lineNumber: 20, materialNumber: '000000000000000087', description: 'Pressure Valve', quantity: 40, unitOfMeasure: 'EA', unitPrice: 85.5, netAmount: 3420, currency: 'EUR', deliveryDate: '2026-05-15' },
  ],
};

const BASE_GRS: GoodsReceiptLine[] = [
  { grDocument: '5000001016', grYear: '2026', grItem: '000001', poNumber: '4500001016', poLine: 10, materialNumber: '000000000000000042', deliveredQty: 20, unitOfMeasure: 'EA', postingDate: '2026-05-10', companyCode: '1000' },
  { grDocument: '5000001016', grYear: '2026', grItem: '000002', poNumber: '4500001016', poLine: 20, materialNumber: '000000000000000087', deliveredQty: 40, unitOfMeasure: 'EA', postingDate: '2026-05-10', companyCode: '1000' },
];

const CLEAN_INVOICE: InvoiceInput = {
  source: 'API',
  vendorId: '0000100001',
  companyCode: '1000',
  currency: 'EUR',
  totalAmount: 8420,
  poNumber: '4500001016',
  lines: [
    { lineNumber: 10, materialNumber: '000000000000000042', description: 'Industrial Pump', quantity: 20, unitPrice: 250, netAmount: 5000, poLine: 10 },
    { lineNumber: 20, materialNumber: '000000000000000087', description: 'Pressure Valve', quantity: 40, unitPrice: 85.5, netAmount: 3420, poLine: 20 },
  ],
};

describe('detectMaterialMismatch', () => {
  it('returns empty array when all materials match across invoice/PO/GR', () => {
    const results = detectMaterialMismatch(CLEAN_INVOICE, BASE_PO, BASE_GRS);
    expect(results).toHaveLength(0);
  });

  it('detects mismatch when invoice material differs from PO on one line', () => {
    const badInvoice: InvoiceInput = {
      ...CLEAN_INVOICE,
      lines: [
        CLEAN_INVOICE.lines[0],
        { ...CLEAN_INVOICE.lines[1], materialNumber: '000000000000000099' },
      ],
    };
    const results = detectMaterialMismatch(badInvoice, BASE_PO, BASE_GRS);
    expect(results).toHaveLength(1);
    expect(results[0].discrepancyType).toBe('MATERIAL_MISMATCH');
    expect(results[0].requiresHumanReview).toBe(true);
    expect(results[0].rulesConfidence).toBe(0.95);
    expect(results[0].detectedFields[0].invoiceValue).toBe('000000000000000099');
    expect(results[0].detectedFields[0].expectedValue).toBe('000000000000000087');
  });

  it('detects mismatch when invoice material differs from GR material', () => {
    // PO matches invoice but GR has a different material
    const altGrs: GoodsReceiptLine[] = [
      BASE_GRS[0],
      { ...BASE_GRS[1], materialNumber: '000000000000000077' },
    ];
    // Invoice matches PO but not GR
    const results = detectMaterialMismatch(CLEAN_INVOICE, BASE_PO, altGrs);
    // Invoice material matches PO, so invoice-vs-PO check passes.
    // But GR material differs from invoice — should flag.
    expect(results).toHaveLength(1);
    expect(results[0].discrepancyType).toBe('MATERIAL_MISMATCH');
    expect(results[0].description).toContain('GR material');
  });

  it('flags when invoice has no material but PO does', () => {
    const noMatInvoice: InvoiceInput = {
      ...CLEAN_INVOICE,
      lines: [
        CLEAN_INVOICE.lines[0],
        { ...CLEAN_INVOICE.lines[1], materialNumber: undefined },
      ],
    };
    const results = detectMaterialMismatch(noMatInvoice, BASE_PO, BASE_GRS);
    expect(results).toHaveLength(1);
    expect(results[0].detectedFields[0].invoiceValue).toBe('(empty)');
  });

  it('returns empty array when PO is null', () => {
    const results = detectMaterialMismatch(CLEAN_INVOICE, null, BASE_GRS);
    expect(results).toHaveLength(0);
  });

  it('is case-insensitive on material numbers', () => {
    const mixedCaseInvoice: InvoiceInput = {
      ...CLEAN_INVOICE,
      lines: [
        { ...CLEAN_INVOICE.lines[0], materialNumber: '000000000000000042' },
        { ...CLEAN_INVOICE.lines[1], materialNumber: '000000000000000087' },
      ],
    };
    const results = detectMaterialMismatch(mixedCaseInvoice, BASE_PO, BASE_GRS);
    expect(results).toHaveLength(0);
  });

  it('detects multiple mismatches across different lines', () => {
    const allBadInvoice: InvoiceInput = {
      ...CLEAN_INVOICE,
      lines: [
        { ...CLEAN_INVOICE.lines[0], materialNumber: '000000000000000001' },
        { ...CLEAN_INVOICE.lines[1], materialNumber: '000000000000000002' },
      ],
    };
    const results = detectMaterialMismatch(allBadInvoice, BASE_PO, BASE_GRS);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.discrepancyType === 'MATERIAL_MISMATCH')).toBe(true);
  });

  it('skips lines where neither invoice nor PO has a material number', () => {
    const emptyMatPo: PurchaseOrder = {
      ...BASE_PO,
      lines: [
        { ...BASE_PO.lines[0], materialNumber: '' },
        BASE_PO.lines[1],
      ],
    };
    const emptyMatInvoice: InvoiceInput = {
      ...CLEAN_INVOICE,
      lines: [
        { ...CLEAN_INVOICE.lines[0], materialNumber: '' },
        CLEAN_INVOICE.lines[1],
      ],
    };
    const results = detectMaterialMismatch(emptyMatInvoice, emptyMatPo, []);
    expect(results).toHaveLength(0);
  });
});
