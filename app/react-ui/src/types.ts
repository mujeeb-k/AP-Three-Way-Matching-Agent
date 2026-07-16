// OData response wrapper
export interface ODataList<T> {
  '@odata.count'?: number
  value: T[]
}

// Work Queue
export interface WorkItem {
  ID: string
  invoiceId: string
  invoiceNumber: string
  vendorId: string
  companyCode: string
  currency: string
  totalAmount: number
  postingDate: string
  poNumber: string
  processingStatus: string
  discrepancyType: DiscrepancyType
  riskTier: RiskTier
  riskRationale: string
  confidence: number
  description: string
  agentDecision: AgentDecision
  decisionReason: string
  detectedFields: string   // JSON string
  correctionsApplied: string // JSON string
  assignedTo: string | null
  assignedAt: string | null
  reviewStatus: ReviewStatus
  reviewedBy: string | null
  reviewedAt: string | null
  reviewOutcome: string | null
  reviewNotes: string | null
  createdAt: string
  traceId: string | null
  riskOrder: number
}

export type DiscrepancyType =
  | 'PRICE_VARIANCE' | 'QTY_VARIANCE' | 'MISSING_GR' | 'INVOICE_BEFORE_GR'
  | 'WRONG_PO_REFERENCE' | 'LINE_STRUCTURE' | 'CURRENCY_MISMATCH'
  | 'ENTITY_MISMATCH' | 'MULTI_PO' | 'FIELD_SWAP' | 'DUPLICATE'
  | 'UOM_MISMATCH' | 'SEPARATOR_AMBIGUITY' | 'MATERIAL_MISMATCH'

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type AgentDecision =
  | 'AUTO_RESOLVED' | 'AUTO_CORRECTED' | 'PENDING_GR'
  | 'FLAGGED_REVIEW' | 'FLAGGED_REJECT' | 'ESCALATED' | 'NO_DISCREPANCY'
export type ReviewStatus = 'PENDING' | 'IN_REVIEW' | 'RESOLVED'

export interface DashboardStats {
  totalInvoices: number
  pending: number
  inReview: number
  resolved: number
  critical: number
  high: number
  medium: number
  low: number
  autoCorrections: number
  flaggedReview: number
  escalated: number
}

export interface ActivityTrendPoint {
  date: string
  count: number
}

// Invoice Payload
export interface InvoicePayload {
  ID: string
  vendorId: string
  vendorInvoiceNo: string
  invoiceDate: string
  postingDate: string
  companyCode: string
  currency: string
  totalAmount: number
  taxAmount: number
  netAmount: number
  poNumber: string
  processingStatus: string
  receivedAt: string
  source: string
}

// Invoice Lines
export interface InvoiceLine {
  ID: string
  lineNumber: number
  materialNumber: string
  description: string
  quantity: number
  unitOfMeasure: string
  unitPrice: number
  netAmount: number
  poLine: number | null
  correctedQty: number | null
  correctedUnitPrice: number | null
  correctedNetAmount: number | null
  hasCorrection: boolean
}

// Timeline
export interface TimelineEvent {
  ID: string
  eventType: string
  eventAt: string
  actor: string
  actorRole: string
  summary: string
  detail: string | null
  invoice_ID: string
  discrepancy_ID: string | null
}

// Agent Config
export interface AgentConfig {
  ID: string
  configKey: string
  configValue: string
  description: string
  updatedBy: string | null
  modifiedAt: string
}

// Config Change Log
export interface ConfigChangeLog {
  ID: string
  changedAt: string
  changedBy: string
  configKey: string
  oldValue: string | null
  newValue: string | null
}

// Action Results
export interface ActionResult {
  success: boolean
  message: string
}

// Parsed Corrections
export interface Correction {
  lineNumber: number
  field: string
  before: number
  after: number
}

export interface DetectedField {
  field: string
  invoiceValue: string | number
  expectedValue: string | number
  poValue?: string | number
}

// Assistant Chat
export interface AssistantChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  richContent?: RichContentBlock
  suggestedBubbles?: SuggestedBubble[]
  timestamp: string
}

export interface SuggestedBubble {
  label: string
  prompt: string
}

export type RichContentBlock =
  | InvoiceDetailBlock
  | InvoiceListBlock
  | SelectionBlock
  | ConfirmationBlock
  | SequentialReviewBlock
  | ReviewCompleteBlock
  | ActionResultBlock

export interface InvoiceDetailBlock {
  type: 'invoice_detail'
  data: {
    invoice: {
      ID: string
      vendorInvoiceNo: string
      vendorId: string
      companyCode: string
      currency: string
      totalAmount: number
      postingDate: string
      poNumber: string
    }
    discrepancies: Array<{
      ID: string
      discrepancyType: DiscrepancyType
      riskTier: RiskTier
      confidence: number
      description: string
      agentDecision: AgentDecision
      decisionReason: string
      riskRationale: string
      detectedFields: string
      correctionsApplied: string
      reviewStatus: ReviewStatus
      assignedTo: string | null
    }>
    lines: Array<{
      lineNumber: number
      materialNumber: string
      description: string
      quantity: number
      unitPrice: number
      netAmount: number
      correctedQty: number | null
      correctedUnitPrice: number | null
      correctedNetAmount: number | null
      hasCorrection: boolean
    }>
  }
}

export interface InvoiceListBlock {
  type: 'invoice_list'
  data: {
    items: Array<{
      discrepancyId: string
      invoiceId: string
      invoiceNumber: string
      vendorId: string
      totalAmount: number
      currency: string
      riskTier: RiskTier
      discrepancyType: DiscrepancyType
      agentDecision: AgentDecision
      description: string
    }>
    totalCount: number
  }
}

export interface SelectionBlock {
  type: 'selection'
  data: {
    prompt: string
    items: Array<{
      id: string
      invoiceNumber: string
      vendorId: string
      totalAmount: number
      currency: string
      riskTier: RiskTier
      discrepancyType: DiscrepancyType
    }>
  }
}

export interface ConfirmationBlock {
  type: 'confirmation'
  data: {
    action: string
    invoiceNumber: string
    discrepancyId?: string
    invoiceId?: string
    consequence: string
  }
}

export interface SequentialReviewBlock {
  type: 'sequential_review'
  data: {
    items: Array<{
      discrepancyId: string
      invoiceNumber: string
      vendorId: string
      totalAmount: number
      currency: string
      riskTier: RiskTier
      discrepancyType: DiscrepancyType
      description: string
    }>
    currentIndex: number
  }
}

export interface ReviewCompleteBlock {
  type: 'review_complete'
  data: {
    decisions: Array<{
      discrepancyId: string
      invoiceNumber: string
      action: 'accept' | 'escalate' | 'reject' | 'skip'
      timestamp?: string
    }>
  }
}

export interface ActionResultBlock {
  type: 'action_result'
  data: {
    success: boolean
    action: string
    target: string
    message: string
  }
}

export interface AssistantChatResponse {
  response: string
  richContent: string | null
  suggestedBubbles: string
  conversationId?: string
}

// Assistant Conversations
export interface AssistantConversation {
  ID: string
  userId: string
  startedAt: string
  endedAt: string | null
  status: 'ACTIVE' | 'CLOSED'
  title: string | null
  messageCount: number
  actionCount: number
  linkedInvoiceIds: string[]
  actionTypes: string[]
}

export interface AssistantConversationDetail {
  ID: string
  userId: string
  startedAt: string
  endedAt: string | null
  status: 'ACTIVE' | 'CLOSED'
  title: string | null
  messages: AssistantChatMessage[]
  actions: AssistantConversationAction[]
}

export interface AssistantConversationAction {
  ID: string
  messageId: string | null
  invoiceId: string
  action: string
  reason: string | null
  executedAt: string
  executedBy: string
}
