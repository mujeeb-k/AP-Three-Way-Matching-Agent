import type { ISapAdapter, PurchaseOrder, GoodsReceiptLine, VendorMaster, HistoricalInvoice, PostResult } from '../types.js';
import { AdapterNotFoundError, AdapterError, NotImplementedError } from '../../util/errors.js';
import { childLogger } from '../../util/logger.js';

const log = childLogger('adapter:s4-cloud');

/**
 * S/4HANA Cloud adapter — OData v4 reads against standard SAP APIs.
 * Destination URL and auth come from env vars / BTP destination service.
 *
 * APIs used:
 *   API_PURCHASEORDER_PROCESS_SRV   — PO header + items
 *   API_MATERIAL_DOCUMENT_SRV       — GR/material documents
 *   API_SUPPLIERINVOICE_PROCESS_SRV — historical invoices (duplicate check)
 *   API_BUSINESS_PARTNER            — vendor master
 */
export class S4CloudAdapter implements ISapAdapter {
  readonly adapterType = 'S4_CLOUD' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const url = process.env.S4_BASE_URL;
    const key = process.env.S4_API_KEY;
    if (!url) throw new AdapterError('S4_BASE_URL env var is required for S4_CLOUD adapter');
    if (!key) throw new AdapterError('S4_API_KEY env var is required for S4_CLOUD adapter');
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = key;
  }

  private async fetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await globalThis.fetch(url.toString(), {
      headers: {
        'APIKey': this.apiKey,
        'Accept': 'application/json',
        'sap-client': process.env.S4_CLIENT ?? '100',
      },
    });

    if (res.status === 404) return null as T;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AdapterError(`S4 API error ${res.status}: ${body}`, { path, status: res.status });
    }

    const json = await res.json();
    return (json.d ?? json.value ?? json) as T;
  }

  async getPurchaseOrder(poNumber: string, companyCode: string): Promise<PurchaseOrder> {
    log.debug({ poNumber, companyCode }, 'getPurchaseOrder');

    const header = await this.fetch<any>(
      `/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${poNumber}')`,
      { $expand: 'to_PurchaseOrderItem' }
    );
    if (!header) throw new AdapterNotFoundError('PurchaseOrder', poNumber, 'S4_CLOUD');

    return {
      poNumber: header.PurchaseOrder,
      vendorId: header.Supplier,
      companyCode: header.CompanyCode,
      purchasingOrg: header.PurchasingOrganization,
      currency: header.DocumentCurrency,
      status: this.mapPoStatus(header.PurchaseOrderLifeCycleStatus),
      createdAt: header.CreationDate,
      lines: (header.to_PurchaseOrderItem?.results ?? []).map((item: any) => ({
        lineNumber: Number(item.PurchaseOrderItem),
        materialNumber: item.Material,
        description: item.PurchaseOrderItemText,
        quantity: Number(item.OrderQuantity),
        unitOfMeasure: item.PurchaseOrderQuantityUnit,
        unitPrice: Number(item.NetPriceAmount),
        netAmount: Number(item.NetPriceAmount) * Number(item.OrderQuantity),
        currency: header.DocumentCurrency,
        deliveryDate: item.DeliveryDate,
      })),
    };
  }

  async getGoodsReceipts(poNumber: string, companyCode: string): Promise<GoodsReceiptLine[]> {
    log.debug({ poNumber, companyCode }, 'getGoodsReceipts');

    const results = await this.fetch<any[]>(
      '/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem',
      {
        // 101 = GR for PO, 501 = receipt w/o ref, 503 = GR into GR-blocked stock
        $filter: `PurchaseOrder eq '${poNumber}' and GoodsMovementType in ('101','501','503')`,
        $select: 'MaterialDocument,MaterialDocumentYear,MaterialDocumentItem,PurchaseOrder,PurchaseOrderItem,Material,Quantity,QuantityInBaseUnit,PostingDate,CompanyCode,GoodsMovementType',
      }
    );

    return (results ?? []).map((r: any): GoodsReceiptLine => ({
      grDocument: r.MaterialDocument,
      grYear: r.MaterialDocumentYear,
      grItem: r.MaterialDocumentItem,
      poNumber: r.PurchaseOrder,
      poLine: Number(r.PurchaseOrderItem),
      materialNumber: r.Material,
      deliveredQty: Number(r.Quantity),
      unitOfMeasure: r.QuantityInBaseUnit,
      postingDate: r.PostingDate,
      companyCode: r.CompanyCode ?? companyCode,
    }));
  }

  async getVendorMaster(vendorId: string, companyCode: string): Promise<VendorMaster> {
    log.debug({ vendorId, companyCode }, 'getVendorMaster');

    const bp = await this.fetch<any>(
      `/API_BUSINESS_PARTNER/A_BusinessPartner('${vendorId}')`,
      { $expand: 'to_BusinessPartnerAddress,to_Supplier/to_SupplierCompany' }
    );
    if (!bp) throw new AdapterNotFoundError('VendorMaster', vendorId, 'S4_CLOUD');

    // to_SupplierCompany is an array — find matching company code
    const supplierCompanies: any[] = bp.to_Supplier?.to_SupplierCompany?.results ?? [];
    const supplierCompany = supplierCompanies.find((c: any) => c.CompanyCode === companyCode)
      ?? supplierCompanies[0];

    return {
      vendorId,
      vendorName: bp.BusinessPartnerFullName ?? bp.OrganizationBPName1 ?? vendorId,
      companyCode,
      currency: supplierCompany?.Currency ?? 'EUR',
      paymentTerms: supplierCompany?.PaymentTerms ?? '',
      swapErrorRate: 0,      // Enriched locally over time — not from S/4
      totalInvoices: 0,
      totalDiscrepancies: 0,
    };
  }

  async getRecentInvoices(vendorId: string, _companyCode: string, lookbackDays: number): Promise<HistoricalInvoice[]> {
    log.debug({ vendorId, lookbackDays }, 'getRecentInvoices');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const results = await this.fetch<any[]>(
      '/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice',
      {
        $filter: `SupplierInvoicingParty eq '${vendorId}' and DocumentDate ge datetime'${cutoffStr}T00:00:00'`,
        $select: 'SupplierInvoice,SupplierInvoiceIDByInvcgParty,DocumentDate,InvoiceGrossAmount,DocumentCurrency,PurchaseOrder,CompanyCode',
        $top: '100',
      }
    );

    return (results ?? []).map((r: any): HistoricalInvoice => ({
      externalId: r.SupplierInvoice,
      vendorId: r.SupplierInvoicingParty ?? vendorId,
      vendorInvoiceNo: r.SupplierInvoiceIDByInvcgParty,
      invoiceDate: r.DocumentDate,
      totalAmount: Number(r.InvoiceGrossAmount),
      currency: r.DocumentCurrency,
      poNumber: r.PurchaseOrder,
    }));
  }

  async postCorrectedInvoice(_invoice: unknown): Promise<PostResult> {
    throw new NotImplementedError('postCorrectedInvoice — requires human gate via acceptCorrection()');
  }

  async releaseBlockedInvoice(_invoiceId: string): Promise<PostResult> {
    throw new NotImplementedError('releaseBlockedInvoice — requires human gate via acceptCorrection()');
  }

  async flagInvoiceForReview(_invoiceId: string, _reason: string): Promise<PostResult> {
    throw new NotImplementedError('S/4HANA write-back is disabled in the portfolio demo');
  }

  private mapPoStatus(s4Status: string): string {
    // S/4HANA Cloud: '' or ' ' = Open, '1' = Partially Ordered, '2' = Fully Ordered
    // S/4HANA On-Prem: 'L' = Closed, 'U' = Blocked
    switch (s4Status) {
      case '':
      case ' ':
      case '1': return 'OPEN';
      case '2': return 'OPEN';      // fully ordered but may still receive
      case 'L': return 'CLOSED';
      case 'U': return 'BLOCKED';
      case '3': return 'CLOSED';    // legacy numeric mapping
      case '4': return 'CANCELLED'; // legacy numeric mapping
      default:  return s4Status ? s4Status : 'OPEN';
    }
  }
}
