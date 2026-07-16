import cds from '@sap/cds';
import type { ISapAdapter, PurchaseOrder, PurchaseOrderLine, GoodsReceiptLine, VendorMaster, HistoricalInvoice, PostResult } from '../types.js';
import { AdapterNotFoundError } from '../../util/errors.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('adapter:mock');

/**
 * Mock SAP adapter — reads directly from cds.db (SQLite in dev).
 * Stays automatically in sync with CSV seed data. No external system needed.
 */
export class MockAdapter implements ISapAdapter {
  readonly adapterType = 'MOCK' as const;

  async getPurchaseOrder(poNumber: string, companyCode: string): Promise<PurchaseOrder> {
    log.debug({ poNumber, companyCode }, 'getPurchaseOrder');
    const db = await cds.connect.to('db');

    const po = await db.run(
      SELECT.one.from('ir.PurchaseOrder')
        .where({ poNumber, companyCode })
    );
    if (!po) throw new AdapterNotFoundError('PurchaseOrder', poNumber, 'MOCK');

    const lines = await db.run(
      SELECT.from('ir.PurchaseOrderLine')
        .where({ po_ID: po.ID })
        .orderBy('lineNumber asc')
    );

    return {
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      companyCode: po.companyCode,
      purchasingOrg: po.purchasingOrg,
      currency: po.currency,
      status: po.status,
      createdAt: po.createdAt,
      lines: lines.map((l: any): PurchaseOrderLine => ({
        lineNumber: l.lineNumber,
        materialNumber: l.materialNumber,
        description: l.description,
        quantity: Number(l.quantity),
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: Number(l.unitPrice),
        netAmount: Number(l.netAmount),
        currency: l.currency,
        deliveryDate: l.deliveryDate,
      })),
    };
  }

  async getGoodsReceipts(poNumber: string, companyCode: string): Promise<GoodsReceiptLine[]> {
    log.debug({ poNumber, companyCode }, 'getGoodsReceipts');
    const db = await cds.connect.to('db');

    const rows = await db.run(
      SELECT.from('ir.GoodsReceiptLine')
        .where({ poNumber, companyCode })
        .orderBy('postingDate asc')
    );

    return rows.map((r: any): GoodsReceiptLine => ({
      grDocument: r.grDocument,
      grYear: r.grYear,
      grItem: r.grItem,
      poNumber: r.poNumber,
      poLine: r.poLine,
      materialNumber: r.materialNumber,
      deliveredQty: Number(r.deliveredQty),
      unitOfMeasure: r.unitOfMeasure,
      unitPrice: r.unitPrice != null && r.unitPrice !== '' ? Number(r.unitPrice) : undefined,
      netAmount: r.netAmount != null && r.netAmount !== '' ? Number(r.netAmount) : undefined,
      postingDate: r.postingDate,
      companyCode: r.companyCode,
    }));
  }

  async getVendorMaster(vendorId: string, companyCode: string): Promise<VendorMaster> {
    log.debug({ vendorId, companyCode }, 'getVendorMaster');
    const db = await cds.connect.to('db');

    const vendor = await db.run(
      SELECT.one.from('ir.VendorMaster')
        .where({ vendorId, companyCode })
    );
    if (!vendor) throw new AdapterNotFoundError('VendorMaster', vendorId, 'MOCK');

    return {
      vendorId: vendor.vendorId,
      vendorName: vendor.vendorName,
      companyCode: vendor.companyCode,
      currency: vendor.currency,
      paymentTerms: vendor.paymentTerms,
      swapErrorRate: Number(vendor.swapErrorRate),
      totalInvoices: vendor.totalInvoices,
      totalDiscrepancies: vendor.totalDiscrepancies,
    };
  }

  async getRecentInvoices(vendorId: string, companyCode: string, lookbackDays: number): Promise<HistoricalInvoice[]> {
    log.debug({ vendorId, companyCode, lookbackDays }, 'getRecentInvoices');
    const db = await cds.connect.to('db');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    const rows = await db.run(
      SELECT.from('ir.InvoicePayload')
        .columns('externalId', 'vendorId', 'vendorInvoiceNo', 'invoiceDate', 'totalAmount', 'currency', 'poNumber')
        .where({ vendorId, companyCode })
        .and(`invoiceDate >= '${cutoff.toISOString().slice(0, 10)}'`)
        .orderBy('invoiceDate desc')
        .limit(100)
    );

    return rows.map((r: any): HistoricalInvoice => ({
      externalId: r.externalId,
      vendorId: r.vendorId,
      vendorInvoiceNo: r.vendorInvoiceNo,
      invoiceDate: r.invoiceDate,
      totalAmount: Number(r.totalAmount),
      currency: r.currency,
      poNumber: r.poNumber,
    }));
  }

  // Write ops — not needed for mock (human gate applies; these would be called post-Accept)
  async postCorrectedInvoice(_invoice: unknown): Promise<PostResult> {
    log.warn('postCorrectedInvoice called on MOCK adapter — no-op');
    return { success: true, message: 'MOCK: no-op' };
  }

  async releaseBlockedInvoice(invoiceId: string): Promise<PostResult> {
    log.warn({ invoiceId }, 'releaseBlockedInvoice called on MOCK adapter — no-op');
    return { success: true, message: 'MOCK: no-op' };
  }

  async flagInvoiceForReview(invoiceId: string, reason: string): Promise<PostResult> {
    log.warn({ invoiceId, reason }, 'flagInvoiceForReview called on MOCK adapter — no-op');
    return { success: true, message: 'MOCK: no-op' };
  }
}
