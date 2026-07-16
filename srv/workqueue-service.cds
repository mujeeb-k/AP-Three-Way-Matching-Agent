using ir from '../db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// WorkQueueService — AP Clerk + Manager facing work queue
// Base path: /workqueue
// ─────────────────────────────────────────────────────────────────────────────

@path: '/workqueue'
service WorkQueueService @(requires: ['AP_CLERK', 'AP_MANAGER', 'ADMIN']) {

  // ── Work Items ────────────────────────────────────────────────────────────
  // The primary list — one row per discrepancy requiring human action.
  // Joined with invoice header for display. Ordered by risk tier (CRITICAL first)
  // so highest priority items surface first.

  @readonly @(
    UI.HeaderInfo: {
      TypeName: 'Work Item',
      TypeNamePlural: 'Work Items',
      Title: { $Type: 'UI.DataField', Value: invoiceNumber },
      Description: { $Type: 'UI.DataField', Value: discrepancyType }
    }
  )
  entity WorkItems as select from ir.Discrepancy as d
    left join ir.InvoicePayload as i on d.invoice.ID = i.ID
  {
    key d.ID,
    @title: 'Invoice ID'
    i.ID                  as invoiceId,
    @title: 'Invoice #'
    i.vendorInvoiceNo     as invoiceNumber,
    @title: 'Vendor'
    i.vendorId,
    @title: 'Company Code'
    i.companyCode,
    @title: 'Currency'
    i.currency,
    @title: 'Total Amount'
    i.totalAmount,
    @title: 'Posting Date'
    i.postingDate,
    @title: 'PO Number'
    i.poNumber,
    @title: 'Processing Status'
    i.processingStatus,
    @title: 'Discrepancy'
    d.discrepancyType,
    @title: 'Risk'
    d.riskTier,
    @title: 'Risk Rationale'
    d.riskRationale,
    @title: 'Confidence'
    d.confidence,
    @title: 'Description'
    d.description,
    @title: 'AI Decision'
    d.agentDecision,
    @title: 'Decision Reason'
    d.decisionReason,
    @title: 'Detected Fields'
    d.detectedFields,
    @title: 'Proposed Corrections'
    d.correctionsApplied,
    @title: 'Assigned To'
    d.assignedTo,
    @title: 'Assigned At'
    d.assignedAt,
    @title: 'Status'
    d.reviewStatus,
    @title: 'Reviewed By'
    d.reviewedBy,
    @title: 'Reviewed At'
    d.reviewedAt,
    @title: 'Review Outcome'
    d.reviewOutcome,
    @title: 'Review Notes'
    d.reviewNotes,
    @title: 'Created'
    d.createdAt,
    @title: 'Trace ID'
    d.trace.ID            as traceId,

    // Computed criticality for Fiori colour coding:
    // 1=Error(red), 2=Warning(orange), 3=Success(green), 0=None(grey)
    @UI.Hidden
    @title: 'Criticality'
    case d.riskTier
      when 'CRITICAL' then 1
      when 'HIGH'     then 1
      when 'MEDIUM'   then 2
      when 'LOW'      then 3
      else 0
    end                   as criticality    : Integer,

    // Risk order for backend sort: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3
    @UI.Hidden
    case d.riskTier
      when 'CRITICAL' then 0
      when 'HIGH'     then 1
      when 'MEDIUM'   then 2
      when 'LOW'      then 3
      else 4
    end                   as riskOrder      : Integer
  }
  where d.reviewStatus in ('PENDING', 'IN_REVIEW')
  order by riskOrder asc;

  // ── Invoice Detail ────────────────────────────────────────────────────────
  @readonly entity InvoiceDetail as projection on ir.InvoicePayload {
    *,
    lines,
    discrepancies,
    events
  };

  // ── Invoice Lines ─────────────────────────────────────────────────────────
  @readonly entity InvoiceLines as projection on ir.InvoicePayloadLine;

  // ── Timeline ──────────────────────────────────────────────────────────────
  @readonly @(UI.HeaderInfo: {
    TypeName: 'Event',
    TypeNamePlural: 'Invoice Timeline'
  })
  entity InvoiceTimeline as select from ir.InvoiceEvent {
    *,
    invoice,
    discrepancy
  }
  order by eventAt asc;

  // ── All Discrepancies (including resolved) ────────────────────────────────
  @readonly entity AllDiscrepancies as projection on ir.Discrepancy {
    *,
    invoice,
    trace
  };

  // ── Vendor lookup ─────────────────────────────────────────────────────────
  @readonly entity Vendors as projection on ir.VendorMaster;

  // ── Actions ──────────────────────────────────────────────────────────────

  action acceptCorrection(
    discrepancyId: UUID,
    notes        : String
  ) returns { success: Boolean; message: String };

  action overrideCorrection(
    discrepancyId : UUID,
    correctedLines: LargeString,
    notes         : String
  ) returns { success: Boolean; message: String };

  action escalate(
    discrepancyId: UUID,
    reason       : String
  ) returns { success: Boolean; message: String };

  action rejectInvoice(
    invoiceId: UUID,
    reason   : String
  ) returns { success: Boolean; message: String };

  action assignToMe(
    discrepancyId: UUID
  ) returns { success: Boolean; message: String };

  action submitFeedback(
    discrepancyId   : UUID,
    aiWasCorrect    : Boolean,
    feedbackCategory: String,
    notes           : String
  ) returns { success: Boolean };
}
