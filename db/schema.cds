namespace ir;
using { cuid, managed } from '@sap/cds/common';
// Enumerations
type DiscrepancyType : String enum {
  PRICE_VARIANCE        = 'PRICE_VARIANCE';        // Invoice price ≠ PO price
  QTY_VARIANCE          = 'QTY_VARIANCE';          // Invoice qty > GR qty
  MISSING_GR            = 'MISSING_GR';            // Invoice exists, no GR recorded
  INVOICE_BEFORE_GR     = 'INVOICE_BEFORE_GR';     // Invoice arrived before GR was posted
  WRONG_PO_REFERENCE    = 'WRONG_PO_REFERENCE';    // Invoice references wrong/invalid PO
  LINE_STRUCTURE        = 'LINE_STRUCTURE';         // Invoice lines differ from PO (consolidated etc.)
  CURRENCY_MISMATCH     = 'CURRENCY_MISMATCH';     // Invoice currency ≠ PO currency
  ENTITY_MISMATCH       = 'ENTITY_MISMATCH';       // Invoice billed to wrong legal entity
  MULTI_PO              = 'MULTI_PO';              // Invoice spans multiple POs
  FIELD_SWAP            = 'FIELD_SWAP';            // Qty/price values swapped in fields (#1 known issue)
  DUPLICATE             = 'DUPLICATE';             // Same/near-same invoice submitted twice
  UOM_MISMATCH          = 'UOM_MISMATCH';          // Invoice unit of measure differs from PO UOM
  SEPARATOR_AMBIGUITY   = 'SEPARATOR_AMBIGUITY';   // Ambiguous decimal/thousands separator in vendor number format
  MATERIAL_MISMATCH     = 'MATERIAL_MISMATCH';     // Invoice material number differs from PO/GR material number
}

type AgentDecision : String enum {
  AUTO_RESOLVED   = 'AUTO_RESOLVED';    // Within-tolerance — auto-approved, full audit trail kept
  AUTO_CORRECTED  = 'AUTO_CORRECTED';   // High-confidence field fix applied — logged, no human gate
  PENDING_GR      = 'PENDING_GR';       // Awaiting GR posting — will reprocess automatically
  FLAGGED_REVIEW  = 'FLAGGED_REVIEW';   // Needs human review (medium/high risk)
  FLAGGED_REJECT  = 'FLAGGED_REJECT';   // Recommend return to vendor
  ESCALATED       = 'ESCALATED';        // Routed to approval chain
  NO_DISCREPANCY  = 'NO_DISCREPANCY';   // Invoice is clean
}

type ReviewOutcome : String enum {
  ACCEPTED        = 'ACCEPTED';         // Human agreed with agent
  OVERRIDDEN      = 'OVERRIDDEN';       // Human disagreed, entered manual correction
  ESCALATED       = 'ESCALATED';        // Sent to manager
  REJECTED        = 'REJECTED';         // Invoice returned to vendor
}

type RiskTier : String enum {
  LOW             = 'LOW';
  MEDIUM          = 'MEDIUM';
  HIGH            = 'HIGH';
  CRITICAL        = 'CRITICAL';
}

type ReviewStatus : String enum {
  PENDING         = 'PENDING';
  IN_REVIEW       = 'IN_REVIEW';
  RESOLVED        = 'RESOLVED';
}

type ProcessingStatus : String enum {
  PENDING         = 'PENDING';
  PROCESSING      = 'PROCESSING';
  COMPLETED       = 'COMPLETED';
  FAILED          = 'FAILED';
}

type PayloadSource : String enum {
  S4_ODATA        = 'S4_ODATA';         // S/4HANA OData API (primary)
  API             = 'API';              // Generic REST API call
}

type SapAdapterType : String enum {
  MOCK            = 'MOCK';
  S4_CLOUD        = 'S4_CLOUD';
}

type InvoiceEventType : String enum {
  RECEIVED          = 'RECEIVED';
  AGENT_ANALYZED    = 'AGENT_ANALYZED';
  AUTO_RESOLVED     = 'AUTO_RESOLVED';    // Within-tolerance auto-resolution
  AUTO_CORRECTED    = 'AUTO_CORRECTED';
  PENDING_GR        = 'PENDING_GR';       // Waiting for GR to be posted
  GR_RECEIVED       = 'GR_RECEIVED';      // GR posted — invoice requeued
  FLAGGED           = 'FLAGGED';
  ASSIGNED          = 'ASSIGNED';
  REVIEWED          = 'REVIEWED';
  ESCALATED         = 'ESCALATED';
  RESOLVED          = 'RESOLVED';
  REJECTED          = 'REJECTED';
}
// Reference Data (read from S/4HANA, cached locally)
entity VendorMaster : cuid, managed {
  vendorId        : String(10)  not null;  // SAP format: 0000100001
  vendorName      : String(100);
  companyCode     : String(4);             // SAP format: 1000
  currency        : String(3);             // ISO 4217: EUR, USD, GBP
  paymentTerms    : String(4);             // SAP payment term key: ZB14
  // Pattern data — enriched over time by the agent
  swapErrorRate   : Decimal(5,4) default 0; // 0.0000–1.0000
  totalInvoices   : Integer      default 0;
  totalDiscrepancies : Integer   default 0;
}

entity PurchaseOrder : cuid, managed {
  poNumber        : String(10)  not null;  // SAP format: 4500001234
  vendorId        : String(10);
  companyCode     : String(4);
  purchasingOrg   : String(4);             // SAP purchasing org: 1000
  currency        : String(3);
  status          : String(10);            // OPEN | CLOSED | CANCELLED | BLOCKED
  createdAt       : Date;
  lines           : Composition of many PurchaseOrderLine on lines.po = $self;
}

entity PurchaseOrderLine : cuid {
  po              : Association to PurchaseOrder;
  lineNumber      : Integer       not null; // SAP format: 10, 20, 30 ...
  materialNumber  : String(18);             // SAP format: 000000000000000001
  description     : String(200);
  quantity        : Decimal(13,3) not null;
  unitOfMeasure   : String(3);              // UN, KG, LTR, EA
  unitPrice       : Decimal(15,5) not null;
  netAmount       : Decimal(15,2);
  currency        : String(3);
  deliveryDate    : Date;
}

entity GoodsReceiptLine : cuid, managed {
  grDocument      : String(10)  not null;   // Material document: 5000001234
  grYear          : String(4);
  grItem          : String(6);              // GR item: 000001
  poNumber        : String(10);
  poLine          : Integer;
  materialNumber  : String(18);
  deliveredQty    : Decimal(13,3);
  unitOfMeasure   : String(3);
  unitPrice       : Decimal(15,5);          // GR valuation price (optional — may not exist for service POs)
  netAmount       : Decimal(15,2);          // GR line net amount (optional)
  postingDate     : Date;
  companyCode     : String(4);
}
// Core: Invoice Payload — what the agent receives and processes
entity InvoicePayload : cuid, managed {
  // Inbound metadata
  source            : PayloadSource   not null default 'S4_ODATA';
  externalId        : String(50);     // SAP invoice document number or vendor invoice no
  receivedAt        : Timestamp;
  rawPayload        : LargeString;    // Original JSON stored as-is for traceability

  // Invoice header (SAP fields)
  vendorId          : String(10);     // 0000100001
  vendorInvoiceNo   : String(50);     // Vendor's own invoice number
  invoiceDate       : Date;
  postingDate       : Date;
  companyCode       : String(4);      // 1000
  currency          : String(3);
  totalAmount       : Decimal(15,2);
  taxAmount         : Decimal(15,2);
  netAmount         : Decimal(15,2);

  // PO references — single (most common) or multiple (multi-PO invoice)
  poNumber          : String(10);     // Primary/single PO reference: 4500001234
  poReferences      : Composition of many InvoicePoReference on poReferences.invoice = $self;
  isMultiPo         : Boolean default false;

  // Line items
  lines             : Composition of many InvoicePayloadLine on lines.invoice = $self;

  // Agent outputs
  discrepancies     : Association to many Discrepancy on discrepancies.invoice = $self;
  trace             : Association to one AgentTrace on trace.invoice = $self;
  events            : Association to many InvoiceEvent on events.invoice = $self;

  // Processing state
  processingStatus  : ProcessingStatus default 'PENDING';
  processedAt       : Timestamp;
  pendingGrSince    : Timestamp;      // Set when decision = PENDING_GR; cleared on GR receipt
  adapterUsed       : SapAdapterType;
  processingError   : String(1000);   // Set if processingStatus = FAILED
}

// Junction table for multi-PO invoice references
entity InvoicePoReference : cuid {
  invoice           : Association to InvoicePayload;
  poNumber          : String(10) not null;
  poLineFrom        : Integer;        // Invoice lines that reference this PO
  poLineTo          : Integer;
}

entity InvoicePayloadLine : cuid {
  invoice           : Association to InvoicePayload;
  lineNumber        : Integer       not null; // 10, 20, 30 ...
  materialNumber    : String(18);
  description       : String(200);
  quantity          : Decimal(13,3);
  unitOfMeasure     : String(3);
  unitPrice         : Decimal(15,5);
  netAmount         : Decimal(15,2);
  poLine            : Integer;        // Reference to PO line number

  // Corrected values — populated by agent, only written to S/4 after human Accept
  correctedQty      : Decimal(13,3);
  correctedUnitPrice: Decimal(15,5);
  correctedNetAmount: Decimal(15,2);
  hasCorrection     : Boolean default false;
}
// Core: Discrepancy — one record per detected issue
entity Discrepancy : cuid, managed {
  invoice           : Association to InvoicePayload not null;
  discrepancyType   : DiscrepancyType not null;
  riskTier          : RiskTier        not null default 'MEDIUM';
  riskRationale     : String(500);    // Why this tier was assigned
  confidence        : Decimal(5,4);   // 0.0000–1.0000

  // What was detected
  detectedFields    : LargeString;    // JSON: [{field, invoiceValue, expectedValue, poValue}]
  description       : String(500);    // Human-readable summary for clerk UI

  // Agent recommendation (human still approves all actions)
  agentDecision     : AgentDecision;
  decisionReason    : String(1000);

  // Corrections proposed (applied to InvoicePayloadLine.corrected* fields)
  correctionsApplied: LargeString;    // JSON: [{lineNumber, field, before, after}]

  // Assignment
  assignedTo        : String(100);    // User ID of current owner
  assignedAt        : Timestamp;

  // Human review
  reviewStatus      : ReviewStatus    default 'PENDING';
  reviewedBy        : String(100);
  reviewedAt        : Timestamp;
  reviewOutcome     : ReviewOutcome;
  reviewNotes       : String(1000);

  trace             : Association to AgentTrace;
}
// Core: Invoice Event — append-only timeline (every action on an invoice)
entity InvoiceEvent : cuid {
  invoice           : Association to InvoicePayload not null;
  eventType         : InvoiceEventType not null;
  eventAt           : Timestamp        not null;
  actor             : String(100);     // User ID or 'AGENT'
  actorRole         : String(20);      // AGENT | AP_CLERK | AP_MANAGER | ADMIN
  summary           : String(500);     // "Agent detected field swap on lines 10 & 20"
  detail            : LargeString;     // JSON: additional context
  discrepancy       : Association to Discrepancy; // Optional — if event relates to a discrepancy
}
// Core: Agent Trace — full execution record
entity AgentTrace : cuid, managed {
  invoice           : Association to InvoicePayload not null;

  // Execution metadata
  startedAt         : Timestamp;
  completedAt       : Timestamp;
  durationMs        : Integer;
  aiProvider        : String(30);     // SAP_AI_CORE | ANTHROPIC_DIRECT
  modelUsed         : String(50);     // Provider model identifier
  promptTokens      : Integer;
  completionTokens  : Integer;
  totalTokensUsed   : Integer;

  // Summary shown in clerk UI (collapsed)
  summary           : String(2000);

  // Full reasoning chain — shown in eval console only
  llmPrompt         : LargeString;    // Exact prompt sent
  llmResponse       : LargeString;    // Raw LLM JSON response

  steps             : Composition of many AgentStep on steps.trace = $self;
}

entity AgentStep : cuid {
  trace             : Association to AgentTrace;
  stepOrder         : Integer     not null;
  stepName          : String(100); // PARSE_PAYLOAD | FETCH_REFERENCE | RUN_DETECTORS | LLM_REASON | DIAGNOSE | DECIDE_ACT | PERSIST_TRACE
  input             : LargeString; // JSON input to this step
  output            : LargeString; // JSON output from this step
  durationMs        : Integer;
  error             : String(500); // Null if step succeeded
}
// Core: Agent Action — audit log of every write action taken
entity AgentAction : cuid, managed {
  invoice           : Association to InvoicePayload;
  discrepancy       : Association to Discrepancy;
  trace             : Association to AgentTrace;
  actionType        : String(50);   // CORRECTION_ACCEPTED | CORRECTION_OVERRIDDEN | S4_WRITE_BACK
  targetSystem      : String(30);   // S4 | INTERNAL
  initiatedBy       : String(100);  // User ID who triggered (for S4 write-backs post-Accept)
  payload           : LargeString;  // JSON sent to target system
  responseCode      : String(10);
  responseBody      : LargeString;
  success           : Boolean default false;
  executedAt        : Timestamp;
}
// Eval: Human feedback for accuracy measurement
entity EvalFeedback : cuid, managed {
  discrepancy       : Association to Discrepancy not null;
  trace             : Association to AgentTrace;

  aiWasCorrect      : Boolean;
  correctDecision   : AgentDecision; // What should have happened

  // 1–5 ratings
  ratingAccuracy    : Integer;       // Was the discrepancy correctly identified?
  ratingReasoning   : Integer;       // Was the explanation clear and correct?
  ratingConfidence  : Integer;       // Was the confidence score well-calibrated?

  feedbackCategory  : String(50);    // FALSE_POSITIVE | FALSE_NEGATIVE | WRONG_CORRECTION | CORRECT
  feedbackNotes     : String(2000);

  submittedBy       : String(100);
  role              : String(20);    // AP_CLERK | AP_MANAGER | ADMIN
}
// Configuration — runtime-tunable, no redeploy needed
entity AgentConfig : cuid, managed {
  configKey         : String(100) not null;
  configValue       : String(500);
  description       : String(500);
  updatedBy         : String(100);
  // Keys (see .env.example for defaults):
  //   -- Agent thresholds --
  //   auto_correct_threshold    '0.92'   Confidence >= this → recommend AUTO_CORRECT
  //   auto_approve_threshold    '0.85'   Confidence >= this → recommend AUTO_APPROVE
  //   field_swap_always_llm     'true'   true = always call LLM for FIELD_SWAP; false = rules-only when signature is unambiguous
  //   -- Adapter / AI provider --
  //   active_adapter            'MOCK'   MOCK | S4_CLOUD
  //   active_ai_provider        'MOCK'   MOCK | ANTHROPIC_DIRECT | SAP_AI_CORE
  //   active_discrepancy_types  '["FIELD_SWAP","PRICE_VARIANCE","QTY_VARIANCE","MISSING_GR","INVOICE_BEFORE_GR","WRONG_PO_REFERENCE","LINE_STRUCTURE","CURRENCY_MISMATCH","ENTITY_MISMATCH","MULTI_PO","DUPLICATE"]'
  //   -- Invoice matching tolerances --
  //   tol_price_pct             '10'     Invoice price vs PO price tolerance %
  //   tol_price_abs             '1000'   Invoice price vs PO price tolerance abs EUR
  //   tol_qty_pct               '5'      Invoiced qty vs received qty tolerance %
  //   tol_qty_abs               '500'    Invoiced qty vs received qty tolerance abs EUR
  //   tol_receipt_vs_po_pct     '5'      GR qty vs PO qty tolerance %
  //   tol_invoice_vs_receipt    '0'      Invoice qty vs GR qty — exact match required
  //   tol_inv_vs_po_qty_pct     '10'     Invoice vs PO unit qty tolerance %
  //   tol_inv_vs_po_qty_abs     '1'      Invoice vs PO unit qty abs tolerance EUR/unit
  //   tol_inv_vs_po_amount_pct  '10'     Invoice vs PO total amount tolerance %
  //   tol_inv_vs_po_amount_abs  '1000'   Invoice vs PO total amount tolerance abs EUR
  //   amount_threshold_critical '50000'  Total amount above which all discrepancies → CRITICAL
}
// Config Change Log — append-only audit trail of every config value change
entity AgentConfigChangeLog : cuid {
  changedAt   : Timestamp   not null;
  changedBy   : String(100) not null;
  configKey   : String(100) not null;  // Stored as plain string — survives key renames
  oldValue    : String(500);
  newValue    : String(500);
}
// Assistant Conversations — persisted chat sessions with full message + action audit
type AssistantConversationStatus : String enum {
  ACTIVE  = 'ACTIVE';
  CLOSED  = 'CLOSED';
}

entity AssistantConversation : cuid, managed {
  userId    : String(100) not null;
  startedAt : Timestamp   not null;
  endedAt   : Timestamp;
  status    : AssistantConversationStatus default 'ACTIVE';
  title     : String(200);
  messages  : Composition of many AssistantMessage on messages.conversation = $self;
  actions   : Composition of many AssistantAction  on actions.conversation  = $self;
}

entity AssistantMessage : cuid {
  conversation     : Association to AssistantConversation not null;
  role             : String(10) not null;    // 'user' | 'assistant'
  content          : LargeString;
  richContent      : LargeString;            // JSON: serialized RichContentBlock
  suggestedBubbles : LargeString;            // JSON: [{label, prompt}]
  timestamp        : Timestamp not null;
}

entity AssistantAction : cuid {
  conversation : Association to AssistantConversation not null;
  messageId    : String(36);
  invoiceId    : String(36);
  action       : String(30);                 // accept_correction | escalate | reject | assign
  reason       : String(500);
  executedAt   : Timestamp not null;
  executedBy   : String(100);
}
