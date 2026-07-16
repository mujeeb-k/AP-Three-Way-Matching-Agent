import cds from '@sap/cds';
import { childLogger } from './lib/util/logger.js';

const log = childLogger('workqueue-service');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function userRole(req: any): string {
  if (req.user?.is?.('AP_MANAGER') || req.user?.is?.('ADMIN')) return 'AP_MANAGER';
  return 'AP_CLERK';
}

async function writeEvent(
  db: any,
  invoiceId: string,
  eventType: string,
  actor: string,
  actorRole: string,
  summary: string,
  discrepancyId?: string,
  detail?: object,
): Promise<void> {
  await db.run(INSERT.into('ir.InvoiceEvent').entries({
    ID:           cds.utils.uuid(),
    invoice_ID:   invoiceId,
    eventType,
    eventAt:      new Date().toISOString(),
    actor,
    actorRole,
    summary,
    detail:       detail ? JSON.stringify(detail) : null,
    discrepancy_ID: discrepancyId ?? null,
  }));
}

async function getDisc(db: any, discrepancyId: string) {
  const disc = await db.run(
    SELECT.one.from('ir.Discrepancy').where({ ID: discrepancyId })
  );
  return disc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service implementation
// ─────────────────────────────────────────────────────────────────────────────

export default cds.service.impl(async function WorkQueueServiceImpl(this: any) {

  // ── acceptCorrection ──────────────────────────────────────────────────────
  this.on('acceptCorrection', async (req: any) => {
    const { discrepancyId, notes } = req.data as { discrepancyId: string; notes?: string };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const disc = await getDisc(db, discrepancyId);
    if (!disc) return req.error(404, `Discrepancy ${discrepancyId} not found`);
    if (disc.reviewStatus === 'RESOLVED') {
      return req.error(409, 'Discrepancy is already resolved');
    }

    const now = new Date().toISOString();

    await db.run(
      UPDATE('ir.Discrepancy').set({
        reviewStatus:  'RESOLVED',
        reviewOutcome: 'ACCEPTED',
        reviewedBy:    user,
        reviewedAt:    now,
        reviewNotes:   notes ?? null,
      }).where({ ID: discrepancyId })
    );

    await writeEvent(db, disc.invoice_ID, 'REVIEWED', user, role,
      `Correction accepted by ${user}: ${disc.discrepancyType}`,
      discrepancyId,
      { outcome: 'ACCEPTED', notes }
    );

    // Audit record
    await db.run(INSERT.into('ir.AgentAction').entries({
      ID:          cds.utils.uuid(),
      invoice_ID:  disc.invoice_ID,
      discrepancy_ID: discrepancyId,
      actionType:  'CORRECTION_ACCEPTED',
      targetSystem:'INTERNAL',
      initiatedBy: user,
      payload:     JSON.stringify({ discrepancyId, notes }),
      success:     true,
      executedAt:  now,
    }));

    log.info({ discrepancyId, user }, 'Correction accepted');
    return { success: true, message: 'Correction accepted successfully' };
  });

  // ── overrideCorrection ────────────────────────────────────────────────────
  this.on('overrideCorrection', async (req: any) => {
    const { discrepancyId, correctedLines, notes } = req.data as {
      discrepancyId: string;
      correctedLines: string;
      notes?: string;
    };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const disc = await getDisc(db, discrepancyId);
    if (!disc) return req.error(404, `Discrepancy ${discrepancyId} not found`);
    if (disc.reviewStatus === 'RESOLVED') {
      return req.error(409, 'Discrepancy is already resolved');
    }

    let lines: Array<{ lineNumber: number; field: string; value: number }>;
    try {
      lines = JSON.parse(correctedLines);
    } catch {
      return req.error(400, 'correctedLines must be valid JSON array');
    }

    const now = new Date().toISOString();

    // Apply corrections to InvoicePayloadLine.corrected* fields
    for (const correction of lines) {
      const updateFields: Record<string, unknown> = { hasCorrection: true };
      if (correction.field === 'quantity')   updateFields.correctedQty       = correction.value;
      if (correction.field === 'unitPrice')  updateFields.correctedUnitPrice = correction.value;
      if (correction.field === 'netAmount')  updateFields.correctedNetAmount = correction.value;

      await db.run(
        UPDATE('ir.InvoicePayloadLine').set(updateFields).where({
          invoice_ID: disc.invoice_ID,
          lineNumber: correction.lineNumber,
        })
      );
    }

    await db.run(
      UPDATE('ir.Discrepancy').set({
        reviewStatus:      'RESOLVED',
        reviewOutcome:     'OVERRIDDEN',
        reviewedBy:        user,
        reviewedAt:        now,
        reviewNotes:       notes ?? null,
        correctionsApplied:correctedLines,
      }).where({ ID: discrepancyId })
    );

    await writeEvent(db, disc.invoice_ID, 'REVIEWED', user, role,
      `Correction overridden by ${user}: ${disc.discrepancyType}`,
      discrepancyId,
      { outcome: 'OVERRIDDEN', correctedLines: lines, notes }
    );

    await db.run(INSERT.into('ir.AgentAction').entries({
      ID:          cds.utils.uuid(),
      invoice_ID:  disc.invoice_ID,
      discrepancy_ID: discrepancyId,
      actionType:  'CORRECTION_OVERRIDDEN',
      targetSystem:'INTERNAL',
      initiatedBy: user,
      payload:     correctedLines,
      success:     true,
      executedAt:  now,
    }));

    log.info({ discrepancyId, user, linesCount: lines.length }, 'Correction overridden');
    return { success: true, message: 'Override applied successfully' };
  });

  // ── escalate ──────────────────────────────────────────────────────────────
  this.on('escalate', async (req: any) => {
    const { discrepancyId, reason } = req.data as { discrepancyId: string; reason?: string };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const disc = await getDisc(db, discrepancyId);
    if (!disc) return req.error(404, `Discrepancy ${discrepancyId} not found`);

    await db.run(
      UPDATE('ir.Discrepancy').set({
        reviewStatus:  'IN_REVIEW',
        agentDecision: 'ESCALATED',
      }).where({ ID: discrepancyId })
    );

    await writeEvent(db, disc.invoice_ID, 'ESCALATED', user, role,
      `Escalated by ${user}: ${reason ?? 'No reason given'}`,
      discrepancyId,
      { reason }
    );

    log.info({ discrepancyId, user }, 'Discrepancy escalated');
    return { success: true, message: 'Escalated to manager for review' };
  });

  // ── rejectInvoice ─────────────────────────────────────────────────────────
  this.on('rejectInvoice', async (req: any) => {
    const { invoiceId, reason } = req.data as { invoiceId: string; reason?: string };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const inv = await db.run(SELECT.one.from('ir.InvoicePayload').where({ ID: invoiceId }));
    if (!inv) return req.error(404, `Invoice ${invoiceId} not found`);

    const now = new Date().toISOString();

    // Resolve all pending discrepancies as REJECTED
    await db.run(
      UPDATE('ir.Discrepancy').set({
        reviewStatus:  'RESOLVED',
        reviewOutcome: 'REJECTED',
        reviewedBy:    user,
        reviewedAt:    now,
        reviewNotes:   reason ?? null,
      }).where({
        invoice_ID:   invoiceId,
        reviewStatus: { in: ['PENDING', 'IN_REVIEW'] },
      })
    );

    await writeEvent(db, invoiceId, 'REJECTED', user, role,
      `Invoice rejected by ${user}: ${reason ?? 'No reason given'}`,
      undefined,
      { reason }
    );

    log.info({ invoiceId, user }, 'Invoice rejected');
    return { success: true, message: 'Invoice rejected and returned to vendor' };
  });

  // ── assignToMe ────────────────────────────────────────────────────────────
  this.on('assignToMe', async (req: any) => {
    const { discrepancyId } = req.data as { discrepancyId: string };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const disc = await getDisc(db, discrepancyId);
    if (!disc) return req.error(404, `Discrepancy ${discrepancyId} not found`);

    const now = new Date().toISOString();

    await db.run(
      UPDATE('ir.Discrepancy').set({
        assignedTo:   user,
        assignedAt:   now,
        reviewStatus: 'IN_REVIEW',
      }).where({ ID: discrepancyId })
    );

    await writeEvent(db, disc.invoice_ID, 'ASSIGNED', user, role,
      `Assigned to ${user}`,
      discrepancyId
    );

    log.info({ discrepancyId, user }, 'Discrepancy assigned');
    return { success: true, message: `Assigned to ${user}` };
  });

  // ── submitFeedback ────────────────────────────────────────────────────────
  this.on('submitFeedback', async (req: any) => {
    const { discrepancyId, aiWasCorrect, feedbackCategory, notes } = req.data as {
      discrepancyId: string;
      aiWasCorrect: boolean;
      feedbackCategory?: string;
      notes?: string;
    };
    const db = await cds.connect.to('db');
    const user = req.user?.id ?? 'unknown';
    const role = userRole(req);

    const disc = await getDisc(db, discrepancyId);
    if (!disc) return req.error(404, `Discrepancy ${discrepancyId} not found`);

    await db.run(INSERT.into('ir.EvalFeedback').entries({
      ID:               cds.utils.uuid(),
      discrepancy_ID:   discrepancyId,
      trace_ID:         disc.trace_ID ?? null,
      aiWasCorrect,
      feedbackCategory: feedbackCategory ?? 'CORRECT',
      feedbackNotes:    notes ?? null,
      submittedBy:      user,
      role,
    }));

    log.info({ discrepancyId, aiWasCorrect, user }, 'Feedback submitted');
    return { success: true };
  });
});
