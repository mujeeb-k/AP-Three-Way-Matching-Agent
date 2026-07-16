using ir from '../db/schema';

// ─────────────────────────────────────────────────────────────────────────────
// AgentService — invoice submission + read projections
// Base path: /agent
// ─────────────────────────────────────────────────────────────────────────────

@path: '/agent'
service AgentService @(requires: ['AP_CLERK', 'AP_MANAGER', 'ADMIN']) {

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Main entry point: submit an invoice for AI analysis.
   * payload: JSON string of the invoice (InvoiceInput shape)
   * source:  PayloadSource enum value (API | S4_ODATA)
   * externalId: SAP invoice document number or vendor invoice number (for dedup)
   */
  action processInvoice(
    payload    : LargeString,
    source     : String default 'API',
    externalId : String
  ) returns {
    invoiceId       : UUID;
    finalDecision   : String;
    discrepancyCount: Integer;
    traceId         : UUID;
    durationMs      : Integer;
    promptTokens    : Integer;
    completionTokens: Integer;
    error           : String;
  };

  /**
   * Re-run the agent on an already-persisted invoice (for eval comparison).
   */
  action reprocessInvoice(
    invoiceId: UUID
  ) returns {
    invoiceId       : UUID;
    finalDecision   : String;
    discrepancyCount: Integer;
    traceId         : UUID;
    durationMs      : Integer;
    error           : String;
  };

  /**
   * Health check — returns active adapter + AI provider.
   */
  function health() returns {
    status     : String;
    adapter    : String;
    aiProvider : String;
    modelId    : String;
  };

  // ── Read projections ──────────────────────────────────────────────────────

  @readonly entity InvoicePayloads as projection on ir.InvoicePayload {
    *,
    lines,
    discrepancies,
    trace,
    events
  };

  @readonly entity Discrepancies as projection on ir.Discrepancy {
    *,
    invoice,
    trace
  };

  @readonly entity AgentTraces as projection on ir.AgentTrace {
    *,
    invoice,
    steps
  };

  @readonly entity AgentSteps as projection on ir.AgentStep {
    *,
    trace
  };

  // ── Config management (ADMIN only) ───────────────────────────────────────

  @(requires: 'ADMIN')
  entity AgentConfigs as projection on ir.AgentConfig;

  @(requires: 'ADMIN')
  @readonly entity AgentConfigChangeLogs as projection on ir.AgentConfigChangeLog;
}
