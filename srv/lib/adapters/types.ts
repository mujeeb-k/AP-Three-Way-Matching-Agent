// Runtime adapter boundary for the local demo and S/4HANA Cloud.
export type SapAdapterType = 'MOCK' | 'S4_CLOUD';

export interface VendorMaster {
  vendorId: string;       // SAP format: 0000100001
  vendorName: string;
  companyCode: string;    // SAP format: 1000
  currency: string;       // ISO 4217: EUR, USD, GBP
  paymentTerms: string;   // SAP key: ZB14
  swapErrorRate: number;  // 0–1, historical error rate enriched over time
  totalInvoices: number;
  totalDiscrepancies: number;
}

export interface PurchaseOrderLine {
  lineNumber: number;       // SAP: 10, 20, 30 ...
  materialNumber: string;   // SAP: 000000000000000001
  description: string;
  quantity: number;
  unitOfMeasure: string;    // UN, KG, LTR, EA
  unitPrice: number;
  netAmount: number;
  currency: string;
  deliveryDate: string;     // ISO date string
}

export interface PurchaseOrder {
  poNumber: string;         // SAP: 4500001234
  vendorId: string;
  companyCode: string;
  purchasingOrg: string;    // SAP: 1000
  currency: string;
  status: string;           // OPEN | CLOSED | CANCELLED | BLOCKED
  createdAt: string;        // ISO date string
  lines: PurchaseOrderLine[];
}

export interface GoodsReceiptLine {
  grDocument: string;       // Material document: 5000001234
  grYear: string;
  grItem: string;           // GR item: 000001
  poNumber: string;
  poLine: number;
  materialNumber: string;
  deliveredQty: number;
  unitOfMeasure: string;
  unitPrice?: number;       // GR valuation price (optional)
  netAmount?: number;       // GR line net amount (optional)
  postingDate: string;      // ISO date string
  companyCode: string;
}

// Lightweight invoice summary used for duplicate detection lookback
export interface HistoricalInvoice {
  externalId: string;
  vendorId: string;
  vendorInvoiceNo: string;
  invoiceDate: string;
  totalAmount: number;
  currency: string;
  poNumber: string;
}

// ── Write operation result ────────────────────────────────────────────────────

export interface PostResult {
  success: boolean;
  documentNumber?: string;
  message?: string;
  rawResponse?: unknown;
}

// ── Main interface ────────────────────────────────────────────────────────────

export interface ISapAdapter {
  readonly adapterType: SapAdapterType;

  // Read operations — used by every pipeline run
  getPurchaseOrder(poNumber: string, companyCode: string): Promise<PurchaseOrder>;
  getGoodsReceipts(poNumber: string, companyCode: string): Promise<GoodsReceiptLine[]>;
  getVendorMaster(vendorId: string, companyCode: string): Promise<VendorMaster>;
  getRecentInvoices(vendorId: string, companyCode: string, lookbackDays: number): Promise<HistoricalInvoice[]>;

  // Write operations remain behind the human approval gate.
  postCorrectedInvoice?(invoice: unknown): Promise<PostResult>;
  releaseBlockedInvoice?(invoiceId: string): Promise<PostResult>;
  flagInvoiceForReview?(invoiceId: string, reason: string): Promise<PostResult>;
}
