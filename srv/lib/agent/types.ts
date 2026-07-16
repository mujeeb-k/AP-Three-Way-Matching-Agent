import type { PurchaseOrder, GoodsReceiptLine, VendorMaster } from '../adapters/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline input — the normalized invoice submitted to the agent
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceLine {
  lineNumber: number;
  materialNumber?: string;
  description?: string;
  quantity: number;
  unitOfMeasure?: string;
  unitPrice: number;
  netAmount: number;
  poLine?: number;
}

export interface InvoiceInput {
  // Identity
  externalId?: string;            // SAP invoice document number or vendor invoice no
  vendorInvoiceNo?: string;
  source: string;                 // PayloadSource enum value

  // Header
  vendorId: string;
  companyCode: string;
  currency: string;
  invoiceDate?: string;           // ISO date
  postingDate?: string;           // ISO date
  totalAmount: number;
  taxAmount?: number;
  netAmount?: number;

  // PO references
  poNumber?: string;              // Primary PO reference
  isMultiPo?: boolean;
  poReferences?: Array<{ poNumber: string; poLineFrom?: number; poLineTo?: number }>;

  // Lines
  lines: InvoiceLine[];

  // Raw payload stored for traceability
  rawPayload?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference data fetched from the adapter in FETCH_REFERENCE step
// ─────────────────────────────────────────────────────────────────────────────

export interface ReferenceData {
  purchaseOrder: PurchaseOrder | null;
  goodsReceipts: GoodsReceiptLine[];
  vendor: VendorMaster | null;
  // Keyed by poNumber for multi-PO invoices
  additionalPOs: Record<string, PurchaseOrder>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discrepancy candidate — output of RUN_DETECTORS step
// ─────────────────────────────────────────────────────────────────────────────

export type DiscrepancyTypeName =
  | 'PRICE_VARIANCE'
  | 'QTY_VARIANCE'
  | 'MISSING_GR'
  | 'INVOICE_BEFORE_GR'
  | 'WRONG_PO_REFERENCE'
  | 'LINE_STRUCTURE'
  | 'CURRENCY_MISMATCH'
  | 'ENTITY_MISMATCH'
  | 'MULTI_PO'
  | 'FIELD_SWAP'
  | 'DUPLICATE'
  | 'UOM_MISMATCH'
  | 'SEPARATOR_AMBIGUITY'
  | 'MATERIAL_MISMATCH';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AgentDecision =
  | 'AUTO_RESOLVED'
  | 'AUTO_CORRECTED'
  | 'PENDING_GR'
  | 'FLAGGED_REVIEW'
  | 'FLAGGED_REJECT'
  | 'ESCALATED'
  | 'NO_DISCREPANCY';

export interface DetectedField {
  field: string;
  invoiceValue: string | number;
  expectedValue: string | number;
  poValue?: string | number;
}

export interface ProposedCorrection {
  lineNumber: number;
  field: 'quantity' | 'unitPrice' | 'netAmount';
  before: number;
  after: number;
}

export interface DiscrepancyCandidate {
  discrepancyType: DiscrepancyTypeName;
  // Pre-LLM confidence from rules (0–1). LLM may revise.
  rulesConfidence: number;
  detectedFields: DetectedField[];
  description: string;           // Human-readable for clerk UI
  proposedCorrections: ProposedCorrection[];
  /**
   * Whether this discrepancy type always requires a human to review.
   * true  → always creates a WorkItem regardless of confidence
   * false → can be AUTO_CORRECTED by the agent if corrections are deterministic
   *
   * Always human: DUPLICATE, WRONG_PO_REFERENCE, ENTITY_MISMATCH,
   *               MISSING_GR, INVOICE_BEFORE_GR, FIELD_SWAP,
   *               LINE_STRUCTURE, MULTI_PO, CURRENCY_MISMATCH
   * Agent-resolvable: PRICE_VARIANCE, QTY_VARIANCE
   */
  requiresHumanReview: boolean;
  // Set after LLM_REASON step
  llmConfidence?: number;
  llmExplanation?: string;
  llmReasoned?: boolean;
  // Set after DIAGNOSE step
  riskTier?: RiskTier;
  riskRationale?: string;
  // Set after DECIDE step
  agentDecision?: AgentDecision;
  decisionReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline context — threaded through all 7 steps
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineStepName =
  | 'PARSE_PAYLOAD'
  | 'FETCH_REFERENCE'
  | 'RUN_DETECTORS'
  | 'LLM_REASON'
  | 'DIAGNOSE'
  | 'DECIDE_ACT'
  | 'PERSIST_TRACE';

export interface PipelineStepRecord {
  stepName: PipelineStepName;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface PipelineContext {
  // Set in PARSE_PAYLOAD
  invoice: InvoiceInput;
  invoiceDbId?: string;           // ir.InvoicePayload.ID once persisted

  // Set in FETCH_REFERENCE
  reference?: ReferenceData;

  // Set in RUN_DETECTORS
  candidates: DiscrepancyCandidate[];

  // Set in DECIDE_ACT
  finalDecision?: AgentDecision;  // Overall invoice-level decision (worst-case across discrepancies)

  // Pipeline execution metadata
  steps: PipelineStepRecord[];
  startedAt: Date;
  config: AgentRuntimeConfig;

  // Token accounting (accumulated across all LLM calls)
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime config — loaded once per pipeline run from AgentConfig DB
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentRuntimeConfig {
  autoCorrectThreshold: number;   // default 0.92
  autoApproveThreshold: number;   // default 0.85
  activeDiscrepancyTypes: DiscrepancyTypeName[];
  fieldSwapAlwaysLlm: boolean;    // default true

  // Tolerance rules
  tolPricePct: number;
  tolPriceAbs: number;
  tolQtyPct: number;
  tolQtyAbs: number;
  tolReceiptVsPoPct: number;
  tolInvoiceVsReceipt: number;
  tolInvVsPoQtyPct: number;
  tolInvVsPoQtyAbs: number;
  tolInvVsPoAmountPct: number;
  tolInvVsPoAmountAbs: number;
  amountThresholdCritical: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline result — returned to the caller (AgentService)
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineResult {
  invoiceId: string;
  finalDecision: AgentDecision;
  discrepancyCount: number;
  candidates: DiscrepancyCandidate[];
  traceId?: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  error?: string;
}
