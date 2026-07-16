import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ArrowUpDown, X, HelpCircle, ChevronUp, ChevronDown } from 'lucide-react'
import { fetchWorkItems, fetchTimeline, fetchDiscrepanciesForInvoice, acceptCorrection, overrideCorrection, escalate, rejectInvoice, assignToMe } from '../api'
import type { WorkItem, DiscrepancyType, RiskTier, AgentDecision, TimelineEvent } from '../types'
import {
  Loading, ErrorMsg, Badge, RiskBadge, DecisionBadge, TypeBadge,
  RISK_STYLES, DECISION_STYLES, DECISION_LABELS, TYPE_LABELS, TYPE_STYLES,
  displayIdentity, fmtCurrency, fmtDate, fmtDatetime
} from '../ui'

type SortKey = 'riskOrder' | 'totalAmount' | 'createdAt' | 'discrepancyType'

const RISK_ORDER: Record<RiskTier, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

const TYPE_DEFS: Record<DiscrepancyType, string> = {
  PRICE_VARIANCE:     'Invoice unit price differs from PO price beyond tolerance.',
  QTY_VARIANCE:       'Invoice quantity differs from GR quantity.',
  MISSING_GR:         'No goods receipt found; invoice arrived before delivery confirmed.',
  INVOICE_BEFORE_GR:  'Invoice date precedes GR posting date.',
  WRONG_PO_REFERENCE: 'PO number references cancelled, closed, or non-existent PO.',
  LINE_STRUCTURE:     'Invoice line structure does not match PO lines.',
  CURRENCY_MISMATCH:  'Invoice currency does not match PO currency.',
  ENTITY_MISMATCH:    'Company code or vendor on invoice differs from PO.',
  MULTI_PO:           'Invoice references multiple POs; requires split.',
  FIELD_SWAP:         'Qty and price values appear transposed across lines.',
  DUPLICATE:          'Invoice number + vendor combination already processed.',
  UOM_MISMATCH:       'Invoice unit of measure differs from PO; quantity requires conversion.',
  SEPARATOR_AMBIGUITY:'Numeric separator ambiguity — value could be read as two different amounts.',
  MATERIAL_MISMATCH:  'Invoice material number differs from PO or GR material number.',
}

// ── Group WorkItems by invoice (deduplicate), keeping worst risk per invoice ──
interface InvoiceGroup {
  invoiceId: string
  invoiceNumber: string
  vendorId: string
  poNumber: string
  companyCode: string
  currency: string
  totalAmount: number
  postingDate: string
  createdAt: string
  // Worst-case discrepancy fields for display
  riskTier: RiskTier
  riskOrder: number
  agentDecision: AgentDecision
  discrepancyType: DiscrepancyType
  reviewStatus: string
  discrepancyCount: number
  // Primary item for opening detail
  primaryItem: WorkItem
  items: WorkItem[]
}

function groupByInvoice(items: WorkItem[]): InvoiceGroup[] {
  const map = new Map<string, WorkItem[]>()
  for (const item of items) {
    const key = item.invoiceId
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  const groups: InvoiceGroup[] = []
  for (const [invoiceId, itemList] of map) {
    // Sort by riskOrder (worst first)
    itemList.sort((a, b) => (a.riskOrder ?? 3) - (b.riskOrder ?? 3))
    const worst = itemList[0]
    groups.push({
      invoiceId,
      invoiceNumber: worst.invoiceNumber,
      vendorId: worst.vendorId,
      poNumber: worst.poNumber,
      companyCode: worst.companyCode,
      currency: worst.currency,
      totalAmount: worst.totalAmount,
      postingDate: worst.postingDate,
      createdAt: worst.createdAt,
      riskTier: worst.riskTier,
      riskOrder: worst.riskOrder,
      agentDecision: worst.agentDecision,
      discrepancyType: worst.discrepancyType,
      reviewStatus: worst.reviewStatus,
      discrepancyCount: itemList.length,
      primaryItem: worst,
      items: itemList,
    })
  }
  return groups
}

// ── Type popover ──────────────────────────────────────────────────────────────
function TypePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center"
        style={{ width: 18, height: 18, color: 'var(--text-muted)' }}
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-7 z-50 card overflow-hidden"
          style={{ width: 320, boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}
        >
          <div className="label px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-default)' }}>
            MISMATCH TYPES
          </div>
          <div>
            {(Object.entries(TYPE_DEFS) as [DiscrepancyType, string][]).map(([key, desc]) => (
              <div
                key={key}
                className="flex items-start gap-2.5 px-3 py-2"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <TypeBadge type={key} />
                <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI Diagnosis panel ──────────────────────────────────────────────────────
function AIDiagnosisPanel({ item }: { item: WorkItem }) {
  const decision = item.agentDecision as AgentDecision
  let corrections: any[] = []
  let detectedFields: any[] = []
  try { corrections = JSON.parse(item.correctionsApplied) } catch {}
  try { detectedFields = JSON.parse(item.detectedFields) } catch {}

  if (decision === 'AUTO_RESOLVED' || decision === 'NO_DISCREPANCY') {
    return (
      <div className="px-4 pb-4 space-y-3">
        <div style={{ background: 'var(--status-low-bg)', border: `1px solid var(--status-low-border)`, borderRadius: 2, padding: '12px 14px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-low-text)' }}>No Real Discrepancy Detected</p>
          <p style={{ fontSize: 11, color: 'var(--status-low)', marginTop: 4, lineHeight: 1.5 }}>
            {decision === 'AUTO_RESOLVED'
              ? 'The variance is within the configured tolerance. Automatically resolved.'
              : 'All values match. No clerk action required.'}
          </p>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="label mb-1">Confidence</p>
            <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{Math.round((item.confidence ?? 0) * 100)}%</p>
          </div>
          <div>
            <p className="label mb-1">Posting Date</p>
            <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmtDate(item.postingDate)}</p>
          </div>
        </div>
      </div>
    )
  }

  if (decision === 'AUTO_CORRECTED') {
    const discType = item.discrepancyType as DiscrepancyType
    return (
      <div className="px-4 pb-4 space-y-3">
        <div style={{ background: 'var(--status-low-bg)', border: `1px solid var(--status-low-border)`, borderRadius: 2, padding: '12px 14px' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-low-text)' }}>Correction Applied — Review &amp; Accept</p>
          <p style={{ fontSize: 11, color: 'var(--status-low)', marginTop: 4, lineHeight: 1.5 }}>
            {discType === 'FIELD_SWAP'
              ? 'Transposed qty/price values detected. Correction restores PO match.'
              : discType === 'UOM_MISMATCH'
              ? 'Unit-of-measure conversion applied.'
              : discType === 'SEPARATOR_AMBIGUITY'
              ? 'Numeric value normalised using PO reference.'
              : 'Discrepancy identified and corrected. Review before accepting.'}
          </p>
        </div>

        {/* FIELD_SWAP before/after */}
        {discType === 'FIELD_SWAP' && corrections.length > 0 && (
          <div>
            <p className="label mb-1.5">SWAP CORRECTION</p>
            <div className="overflow-hidden" style={{ border: '1px solid var(--border-default)', borderRadius: 2 }}>
              <div className="grid grid-cols-4 gap-0 px-3 py-2 label" style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border-default)' }}>
                <span>Line</span><span>Field</span>
                <span style={{ color: 'var(--status-critical)' }}>Before</span>
                <span style={{ color: 'var(--status-low-text)' }}>After</span>
              </div>
              {corrections.map((c: any, i: number) => (
                <div key={i} className="grid grid-cols-4 gap-0 px-3 py-2"
                  style={{ background: 'var(--bg-surface)', borderBottom: i < corrections.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{c.lineNumber}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.field}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--status-critical)', textDecoration: 'line-through' }}>{c.before}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--status-low-text)', fontWeight: 600 }}>{c.after}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* UOM conversion */}
        {discType === 'UOM_MISMATCH' && detectedFields.length > 0 && (
          <div>
            <p className="label mb-1.5">UNIT CONVERSION</p>
            <div className="space-y-1.5">
              {detectedFields.map((f: any, i: number) => (
                <div key={i} className="flex items-center gap-2 flex-wrap px-3 py-2"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.field}</span>
                  <span style={{ color: 'var(--status-critical)', fontFamily: 'var(--font-mono)' }}>{String(f.invoiceValue)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <span style={{ color: 'var(--status-low-text)', fontFamily: 'var(--font-mono)' }}>{String(f.expectedValue)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SEPARATOR normalisation */}
        {discType === 'SEPARATOR_AMBIGUITY' && detectedFields.length > 0 && (
          <div>
            <p className="label mb-1.5">NORMALISATION APPLIED</p>
            <div className="space-y-1.5">
              {detectedFields.map((f: any, i: number) => (
                <div key={i} className="px-3 py-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 2, fontSize: 11 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.field}</span>
                    <span style={{ color: 'var(--status-critical)', fontFamily: 'var(--font-mono)' }}>raw: {String(f.invoiceValue)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <span style={{ color: 'var(--status-low-text)', fontFamily: 'var(--font-mono)' }}>normalised: {String(f.expectedValue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Generic corrections fallback */}
        {!['FIELD_SWAP','UOM_MISMATCH','SEPARATOR_AMBIGUITY'].includes(discType) && corrections.length > 0 && (
          <div>
            <p className="label mb-1.5">CORRECTIONS APPLIED</p>
            <div className="space-y-1">
              {corrections.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--bg-elevated)', borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Line {c.lineNumber} · {c.field}:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--status-critical)', textDecoration: 'line-through' }}>{c.before}</span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--status-low-text)' }}>{c.after}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {item.decisionReason && (
          <div>
            <p className="label mb-1">AGENT REASONING</p>
            <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 2, border: '1px solid var(--border-default)' }}>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>{item.decisionReason}</p>
            </div>
          </div>
        )}
        <div className="flex gap-6">
          <div>
            <p className="label mb-1">Confidence</p>
            <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{Math.round((item.confidence ?? 0) * 100)}%</p>
          </div>
          <div>
            <p className="label mb-1">Posting Date</p>
            <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmtDate(item.postingDate)}</p>
          </div>
        </div>
      </div>
    )
  }

  // FLAGGED_REVIEW / ESCALATED / FLAGGED_REJECT / PENDING_GR
  const isEscalated = decision === 'ESCALATED'
  const isPendingGr = decision === 'PENDING_GR'
  const bannerBg    = isEscalated ? 'var(--status-critical-surface)' : isPendingGr ? 'var(--status-medium-bg)' : 'var(--status-high-surface)'
  const bannerBdr   = isEscalated ? 'var(--status-critical-bg)' : isPendingGr ? 'var(--status-medium-bg)' : 'var(--status-high-bg)'
  const bannerTitle = isEscalated ? 'var(--status-critical)' : isPendingGr ? 'var(--status-medium)' : 'var(--status-high)'
  const bannerBody  = isEscalated ? 'var(--status-critical-text)' : isPendingGr ? 'var(--status-medium)' : 'var(--status-high)'

  const clerkInstruction = isPendingGr
    ? 'Awaiting goods receipt. Invoice is parked until GR is posted.'
    : isEscalated
    ? 'This item has been escalated. Manager review required.'
    : decision === 'FLAGGED_REJECT'
    ? 'The agent recommends returning this invoice to the vendor.'
    : 'The agent could not resolve this automatically. Review and decide.'

  return (
    <div className="px-4 pb-4 space-y-3">
      <div style={{ background: bannerBg, border: `1px solid ${bannerBdr}`, borderRadius: 2, padding: '12px 14px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: bannerTitle }}>
          {isEscalated ? 'Escalated — Manager Review Required'
            : isPendingGr ? 'Parked — Awaiting Goods Receipt'
            : decision === 'FLAGGED_REJECT' ? 'Recommended for Rejection'
            : 'Clerk Decision Required'}
        </p>
        <p style={{ fontSize: 11, color: bannerBody, marginTop: 4, lineHeight: 1.5 }}>{clerkInstruction}</p>
      </div>

      {item.description && (
        <div>
          <p className="label mb-1">WHAT WAS DETECTED</p>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.description}</p>
        </div>
      )}

      {detectedFields.length > 0 && (
        <div>
          <p className="label mb-1.5">DISCREPANCY DETAIL</p>
          <div className="space-y-1.5">
            {detectedFields.map((f: any, i: number) => (
              <div key={i} className="px-3 py-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 2, fontSize: 11 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.field}</span>
                  <span style={{ color: 'var(--status-critical)', fontFamily: 'var(--font-mono)' }}>invoice: {String(f.invoiceValue)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>vs</span>
                  <span style={{ color: 'var(--status-low-text)', fontFamily: 'var(--font-mono)' }}>expected: {String(f.poValue ?? f.expectedValue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {item.decisionReason && (
        <div>
          <p className="label mb-1">WHY IT WAS FLAGGED</p>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.decisionReason}</p>
        </div>
      )}

      {item.riskRationale && (
        <div>
          <p className="label mb-1">RISK ASSESSMENT</p>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.riskRationale}</p>
        </div>
      )}

      <div className="flex gap-6">
        <div>
          <p className="label mb-1">Confidence</p>
          <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{Math.round((item.confidence ?? 0) * 100)}%</p>
        </div>
        <div>
          <p className="label mb-1">Posting Date</p>
          <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmtDate(item.postingDate)}</p>
        </div>
      </div>
    </div>
  )
}

// ── Invoice Detail Modal (centered overlay) ──────────────────────────────────
function InvoiceModal({ group, onClose }: { group: InvoiceGroup; onClose: () => void }) {
  const item = group.primaryItem
  const navigate = useNavigate()
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [tlLoading, setTlLoading] = useState(true)
  const [allDiscrepancies, setAllDiscrepancies] = useState<WorkItem[]>(group.items)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [modal, setModal] = useState<null | 'accept' | 'escalate' | 'reject'>(null)
  const [notes, setNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'match' | 'timeline' | 'document'>('match')

  useEffect(() => {
    fetchTimeline(item.invoiceId).then(setTimeline).finally(() => setTlLoading(false))
    fetchDiscrepanciesForInvoice(item.invoiceId)
      .then(discs => {
        const ORDER: Record<string, number> = {
          ESCALATED: 0, FLAGGED_REJECT: 1, FLAGGED_REVIEW: 2,
          PENDING_GR: 3, AUTO_CORRECTED: 4, AUTO_RESOLVED: 5, NO_DISCREPANCY: 6,
        }
        discs.sort((a, b) => (ORDER[a.agentDecision] ?? 7) - (ORDER[b.agentDecision] ?? 7))
        setAllDiscrepancies(discs.length > 0 ? discs : group.items)
      })
      .catch(() => {})
  }, [item.invoiceId])

  async function doAction(fn: () => Promise<any>) {
    setActionLoading(true); setActionMsg(null)
    try {
      const r = await fn()
      setActionMsg({ ok: r.success !== false, text: r.message ?? 'Done' })
      setModal(null); setNotes('')
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }) }
    finally { setActionLoading(false) }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs = [
    { key: 'match' as const, label: '3-Way Match' },
    { key: 'timeline' as const, label: 'Timeline' },
    { key: 'document' as const, label: 'Document' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center"
        style={{ background: 'rgba(10, 11, 14, 0.7)' }}
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="modal-content card flex flex-col"
          style={{
            width: 620,
            maxHeight: '80vh',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 4,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-shrink-0 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-sans" style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {item.invoiceNumber}
                  </span>
                  <RiskBadge tier={item.riskTier} />
                  <DecisionBadge decision={item.agentDecision} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  {item.vendorId} · {item.poNumber} · {fmtCurrency(item.totalAmount, item.currency)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/queue/${item.ID}`)}
                  style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Open full page
                </button>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center"
                  style={{ width: 28, height: 28, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 mt-3" style={{ marginBottom: -1 }}>
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    fontSize: 11,
                    padding: '6px 14px',
                    color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === tab.key ? '2px solid var(--text-primary)' : '2px solid transparent',
                    background: 'none',
                    border: 'none',
                    borderBottomWidth: 2,
                    borderBottomStyle: 'solid',
                    borderBottomColor: activeTab === tab.key ? 'var(--text-primary)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Body (scrollable) */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === 'match' && (
              <div>
                {/* Per-discrepancy sections */}
                {allDiscrepancies.map((disc, idx) => (
                  <div key={disc.ID} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    {/* Section header (only if multiple discrepancies) */}
                    {allDiscrepancies.length > 1 && (
                      <div className="px-5 pt-3 pb-1 flex items-center gap-2">
                        <span className="label">Issue {idx + 1}</span>
                        <TypeBadge type={disc.discrepancyType as DiscrepancyType} />
                        <DecisionBadge decision={disc.agentDecision as AgentDecision} />
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {Math.round((disc.confidence ?? 0) * 100)}% conf.
                        </span>
                      </div>
                    )}

                    {/* 3-Way Match table */}
                    <div className="px-5 py-3">
                      <p className="label mb-2">3-WAY MATCH</p>
                      {(() => {
                        let fields: any[] = []
                        try { fields = JSON.parse(disc.detectedFields) } catch {}
                        if (fields.length === 0) return <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No field-level discrepancies</p>
                        return (
                          <div style={{ border: '1px solid var(--border-default)', borderRadius: 2 }}>
                            <div className="grid grid-cols-4 gap-0 px-3 py-2 label" style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                              <span>Field</span><span>Invoice</span><span>PO / Expected</span><span>Detected</span>
                            </div>
                            {fields.map((f: any, i: number) => (
                              <div key={i} className="grid grid-cols-4 gap-0 px-3 py-2 items-center"
                                style={{ borderBottom: i < fields.length - 1 ? '1px solid var(--border-subtle)' : 'none', background: 'var(--bg-surface)' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{f.field}</span>
                                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--status-critical)', fontWeight: 500 }}>{String(f.invoiceValue)}</span>
                                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--status-low-text)', fontWeight: 500 }}>{String(f.poValue ?? f.expectedValue)}</span>
                                <TypeBadge type={disc.discrepancyType as DiscrepancyType} />
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>

                    {/* AI Diagnosis */}
                    <AIDiagnosisPanel item={disc} />

                    {/* Per-discrepancy actions */}
                    <div className="px-5 pb-4 flex gap-2">
                      <button
                        onClick={() => doAction(() => acceptCorrection(disc.ID, ''))}
                        disabled={actionLoading}
                        className="btn btn-success"
                        style={{ fontSize: 11, padding: '5px 12px' }}
                      >
                        Accept Correction
                      </button>
                      <button
                        onClick={() => doAction(() => escalate(disc.ID, ''))}
                        disabled={actionLoading}
                        className="btn btn-warn"
                        style={{ fontSize: 11, padding: '5px 12px' }}
                      >
                        Escalate
                      </button>
                    </div>
                  </div>
                ))}

                {/* Invoice-level actions */}
                <div className="px-5 py-4 flex gap-2" style={{ borderTop: '1px solid var(--border-default)' }}>
                  {!item.assignedTo && (
                    <button onClick={() => doAction(() => assignToMe(item.ID))} disabled={actionLoading}
                      className="btn" style={{ fontSize: 11, padding: '5px 12px' }}>
                      Assign to me
                    </button>
                  )}
                  <button onClick={() => doAction(() => rejectInvoice(item.invoiceId, ''))} disabled={actionLoading}
                    className="btn btn-danger" style={{ fontSize: 11, padding: '5px 12px' }}>
                    Reject Invoice
                  </button>
                </div>

                {actionMsg && (
                  <div className="mx-5 mb-4 px-3 py-2" style={{
                    borderRadius: 2, fontSize: 11, fontWeight: 500,
                    background: actionMsg.ok ? 'var(--status-low-bg)' : 'var(--status-critical-surface)',
                    color: actionMsg.ok ? 'var(--status-low-text)' : 'var(--status-critical)',
                    border: `1px solid ${actionMsg.ok ? 'var(--status-low-border)' : 'var(--status-critical-bg)'}`,
                  }}>
                    {actionMsg.text}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="px-5 py-4">
                {tlLoading ? (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</p>
                ) : timeline.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No events yet</p>
                ) : (
                  <div className="space-y-0">
                    {timeline.map((ev, idx) => (
                      <div key={ev.ID} className="flex gap-2.5">
                        <div className="flex flex-col items-center flex-shrink-0" style={{ width: 12 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--accent-link)', marginTop: 4, opacity: 0.6 }} />
                          {idx < timeline.length - 1 && <div className="flex-1" style={{ width: 1, background: 'var(--border-default)', marginTop: 2 }} />}
                        </div>
                        <div style={{ paddingBottom: 10 }}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="badge" style={{ background: 'var(--bg-active)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }}>
                              {ev.eventType.replace(/_/g, ' ')}
                            </span>
                            <span className="badge" style={{
                              background: ev.actorRole === 'AGENT' ? 'var(--status-high-bg)' : 'var(--bg-active)',
                              color: ev.actorRole === 'AGENT' ? 'var(--status-high)' : 'var(--text-tertiary)',
                              border: '1px solid transparent',
                            }}>
                              {ev.actorRole === 'AGENT' || ev.actorRole === 'SYSTEM' ? ev.actorRole : displayIdentity(ev.actor)}
                            </span>
                          </div>
                          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.5 }}>{ev.summary}</p>
                          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{fmtDatetime(ev.eventAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'document' && (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Invoice document preview</p>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>PDF viewer would render here</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorkQueue() {
  const [items, setItems]       = useState<WorkItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [filterRisk, setFilterRisk]     = useState<RiskTier | ''>('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDecision, setFilterDecision] = useState<AgentDecision | ''>('')
  const [filterType, setFilterType] = useState<DiscrepancyType | ''>('')
  const [sortKey, setSortKey]   = useState<SortKey>('riskOrder')
  const [sortAsc, setSortAsc]   = useState(true)
  const [selected, setSelected] = useState<InvoiceGroup | null>(null)
  const [searchParams] = useSearchParams()

  useEffect(() => {
    fetchWorkItems().then(items => {
      setItems(items)
      const risk = searchParams.get('risk') as RiskTier | null
      const decision = searchParams.get('decision') as AgentDecision | null
      const status = searchParams.get('status')
      if (risk) setFilterRisk(risk)
      if (decision) setFilterDecision(decision)
      if (status) setFilterStatus(status)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />
  if (error)   return <ErrorMsg message={error} />

  // Group by invoice
  const groups = groupByInvoice(items)

  const filtered = groups
    .filter(g => {
      const q = search.toLowerCase()
      if (q && !g.invoiceNumber.toLowerCase().includes(q) && !g.vendorId.toLowerCase().includes(q) && !g.poNumber.toLowerCase().includes(q)) return false
      if (filterRisk     && g.riskTier      !== filterRisk)     return false
      if (filterStatus   && g.reviewStatus  !== filterStatus)   return false
      if (filterDecision && g.agentDecision !== filterDecision) return false
      if (filterType     && !g.items.some(i => i.discrepancyType === filterType)) return false
      return true
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortKey === 'riskOrder')       cmp = a.riskOrder - b.riskOrder
      if (sortKey === 'totalAmount')     cmp = b.totalAmount - a.totalAmount
      if (sortKey === 'createdAt')       cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sortKey === 'discrepancyType') cmp = (TYPE_LABELS[a.discrepancyType] ?? '').localeCompare(TYPE_LABELS[b.discrepancyType] ?? '')
      return sortAsc ? cmp : -cmp
    })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown size={11} style={{ opacity: 0.3, display: 'inline', marginLeft: 4 }} />
    return sortAsc
      ? <ChevronUp size={11} style={{ opacity: 0.6, display: 'inline', marginLeft: 4 }} />
      : <ChevronDown size={11} style={{ opacity: 0.6, display: 'inline', marginLeft: 4 }} />
  }

  const allTypes = Object.keys(TYPE_LABELS) as DiscrepancyType[]

  return (
    <>
      {selected && <InvoiceModal group={selected} onClose={() => setSelected(null)} />}

      <div className="h-full flex flex-col gap-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-sans text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              Work Queue
            </h1>
            <p className="label mt-1">{filtered.length} of {groups.length} items</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap gap-2 flex-shrink-0">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-2" size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text" placeholder="Search invoice, vendor, PO…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="input w-full pl-8 pr-3 py-2"
            />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value as DiscrepancyType | '')} className="input px-2.5 py-2">
            <option value="">All types</option>
            {allTypes.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value as RiskTier | '')} className="input px-2.5 py-2">
            <option value="">All risks</option>
            {['CRITICAL','HIGH','MEDIUM','LOW'].map(r => <option key={r}>{r}</option>)}
          </select>
          <select value={filterDecision} onChange={e => setFilterDecision(e.target.value as AgentDecision | '')} className="input px-2.5 py-2">
            <option value="">All decisions</option>
            <option value="AUTO_CORRECTED">Auto Corrected</option>
            <option value="FLAGGED_REVIEW">Flagged Review</option>
            <option value="ESCALATED">Escalated</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input px-2.5 py-2">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_REVIEW">In Review</option>
          </select>
        </div>

        {/* Table */}
        <div className="card flex-1 overflow-hidden flex flex-col min-h-0">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No items match your filters
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                    <th className="label text-left cursor-pointer select-none" style={{ padding: '10px 12px', width: '22%' }}>
                      Invoice
                    </th>
                    <th className="label text-left cursor-pointer select-none" style={{ padding: '10px 12px', width: '13%' }}
                      onClick={() => toggleSort('discrepancyType')}>
                      Type <SortIcon k="discrepancyType" /> <TypePopover />
                    </th>
                    <th className="label text-left cursor-pointer select-none" style={{ padding: '10px 12px', width: '12%' }}
                      onClick={() => toggleSort('riskOrder')}>
                      Risk <SortIcon k="riskOrder" />
                    </th>
                    <th className="label text-left" style={{ padding: '10px 12px', width: '15%' }}>Decision</th>
                    <th className="label text-right cursor-pointer select-none" style={{ padding: '10px 12px', width: '16%' }}
                      onClick={() => toggleSort('totalAmount')}>
                      Amount <SortIcon k="totalAmount" />
                    </th>
                    <th className="label text-left" style={{ padding: '10px 12px', width: '12%' }}>Status</th>
                  </tr>
                </thead>
              </table>
              <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full">
                  <tbody>
                    {filtered.map(group => (
                      <tr
                        key={group.invoiceId}
                        onClick={() => setSelected(group)}
                        className="cursor-pointer tr-hover"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      >
                        <td style={{ padding: '8px 12px', width: '22%' }}>
                          <div className="font-sans" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {group.invoiceNumber}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                            {group.vendorId} · {group.poNumber}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', width: '13%' }}>
                          <div className="flex items-center gap-1.5">
                            <TypeBadge type={group.discrepancyType} />
                            {group.discrepancyCount > 1 && (
                              <span style={{
                                fontSize: 9, fontFamily: 'var(--font-mono)',
                                color: 'var(--status-high)',
                                background: 'var(--status-high-bg)',
                                padding: '1px 5px', borderRadius: 2,
                              }}>
                                +{group.discrepancyCount - 1}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', width: '12%' }}>
                          <RiskBadge tier={group.riskTier} />
                        </td>
                        <td style={{ padding: '8px 12px', width: '15%' }}>
                          <DecisionBadge decision={group.agentDecision} />
                        </td>
                        <td style={{
                          padding: '8px 12px', width: '16%', textAlign: 'right',
                          fontSize: 12, fontFamily: 'var(--font-mono)',
                          color: 'var(--text-secondary)', fontWeight: 500,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {fmtCurrency(group.totalAmount, group.currency)}
                        </td>
                        <td style={{ padding: '8px 12px', width: '12%' }}>
                          <Badge style={{
                            bg: 'var(--bg-active)',
                            color: 'var(--text-tertiary)',
                            border: 'var(--border-default)',
                          }}>
                            {group.reviewStatus === 'IN_REVIEW' ? 'In Review' : 'Pending'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
