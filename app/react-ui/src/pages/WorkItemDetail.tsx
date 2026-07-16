import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Edit3, TrendingUp, XCircle, UserCheck, RefreshCw, FileX } from 'lucide-react'
import { fetchWorkItem, fetchInvoiceLines, fetchTimeline, assignToMe, acceptCorrection, overrideCorrection, escalate, rejectInvoice, reprocessInvoice } from '../api'
import type { WorkItem, InvoiceLine, TimelineEvent, DiscrepancyType, RiskTier, AgentDecision, Correction, DetectedField } from '../types'
import { Loading, ErrorMsg, RiskBadge, DecisionBadge, TypeBadge, displayIdentity, fmtCurrency, fmtDate, fmtDatetime, fmtPct } from '../ui'

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

function actorBadgeStyle(role: string): { bg: string; color: string } {
  if (role === 'ASSISTANT') return { bg: 'var(--bg-active)', color: 'var(--accent-link)' }
  if (role === 'AGENT') return { bg: 'var(--status-high-bg)', color: 'var(--status-high)' }
  if (role === 'SYSTEM') return { bg: 'var(--bg-active)', color: 'var(--text-tertiary)' }
  if (role === 'AP_CLERK') return { bg: 'var(--bg-active)', color: 'var(--accent-link)' }
  if (role === 'AP_MANAGER') return { bg: 'var(--status-high-bg)', color: 'var(--status-high)' }
  return { bg: 'var(--bg-active)', color: 'var(--text-tertiary)' }
}

function TlItem({ ev }: { ev: TimelineEvent }) {
  const actor = actorBadgeStyle(ev.actorRole)
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center flex-none" style={{ width: 16 }}>
        <div
          style={{
            width: 6, height: 6, borderRadius: 1,
            background: 'var(--text-muted)', marginTop: 6, flexShrink: 0,
          }}
        />
        <div className="flex-1" style={{ width: 1, background: 'var(--border-default)', marginTop: 2 }} />
      </div>
      <div style={{ paddingBottom: 10 }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>{ev.summary}</span>
          <span
            className="badge"
            style={{ background: actor.bg, color: actor.color, border: `1px solid ${actor.bg}` }}
          >
            {displayIdentity(ev.actor)}
          </span>
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {fmtDatetime(ev.eventAt)}
        </p>
      </div>
    </div>
  )
}

function OverrideModal({ loading, onCancel, onConfirm }: { loading: boolean; onCancel: () => void; onConfirm: (cl: string, n: string) => void }) {
  const [notes, setNotes] = useState('')
  const [json, setJson] = useState('[\n  { "lineNumber": 1, "field": "quantity", "value": 10 }\n]')
  const [jsonError, setJsonError] = useState<string | null>(null)
  function onJson(v: string) { setJson(v); try { JSON.parse(v); setJsonError(null) } catch(e: any) { setJsonError(e.message) } }
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal-content card" style={{ padding: 20, width: '100%', maxWidth: 512 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', marginBottom: 16 }}>
          Override Correction
        </h3>
        <div>
          <label className="label" style={{ display: 'block', marginBottom: 6 }}>
            Corrected Lines <span style={{ color: 'var(--text-muted)' }}>(JSON array)</span>
          </label>
          <textarea
            className="input"
            style={{
              width: '100%', padding: 12, fontSize: 11, fontFamily: 'var(--font-mono)',
              resize: 'none', borderColor: jsonError ? 'var(--status-critical)' : undefined,
            }}
            rows={5} value={json} onChange={e => onJson(e.target.value)} spellCheck={false}
          />
          {jsonError && <p style={{ fontSize: 10, color: 'var(--status-critical)', marginTop: 4 }}>JSON: {jsonError}</p>}
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            fields: lineNumber · field (quantity|unitPrice|netAmount) · value
          </p>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="label" style={{ display: 'block', marginBottom: 6 }}>
            Notes <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <textarea
            className="input"
            style={{ width: '100%', padding: 12, fontSize: 12, resize: 'none' }}
            rows={2} placeholder="Reason…" value={notes} onChange={e => setNotes(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button disabled={loading || !!jsonError} onClick={() => onConfirm(json, notes)} className="btn btn-primary">
            {loading ? 'Processing…' : 'Apply Override'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SimpleModal({ title, placeholder, destructive, loading, onCancel, onConfirm }: {
  title: string; placeholder: string; destructive: boolean; loading: boolean; onCancel: () => void; onConfirm: (n: string) => void
}) {
  const [notes, setNotes] = useState('')
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal-content card" style={{ padding: 20, width: '100%', maxWidth: 448 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', marginBottom: 12 }}>
          {title}
        </h3>
        <textarea
          className="input"
          style={{ width: '100%', padding: 12, fontSize: 12, resize: 'none' }}
          rows={3} placeholder={placeholder} value={notes} onChange={e => setNotes(e.target.value)}
        />
        <div className="flex justify-end gap-2" style={{ marginTop: 12 }}>
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button disabled={loading} onClick={() => onConfirm(notes)} className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}>
            {loading ? 'Processing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

const SectionHeader = ({ title }: { title: string }) => (
  <div className="label" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-default)' }}>{title}</div>
)

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem]         = useState<WorkItem | null>(null)
  const [lines, setLines]       = useState<InvoiceLine[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [linesLoaded, setLinesLoaded] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [modal, setModal] = useState<null | 'accept' | 'override' | 'escalate' | 'reject'>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([fetchWorkItem(id), fetchTimeline(id)])
      .then(([wi, tl]) => { setItem(wi); setTimeline(tl); return fetchInvoiceLines(wi.invoiceId) })
      .then(l => { setLines(l); setLinesLoaded(true) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Loading />
  if (error)   return <ErrorMsg message={error} />
  if (!item)   return <ErrorMsg message="Item not found" />

  const corrections   = parseJson<Correction[]>(item.correctionsApplied, [])
  const detectedFields = parseJson<DetectedField[]>(item.detectedFields, [])

  async function doAction(fn: () => Promise<any>) {
    setActionLoading(true); setActionMsg(null)
    try {
      const r = await fn()
      setActionMsg({ ok: r.success !== false, text: r.message ?? 'Done' })
      setModal(null)
      const [wi, tl] = await Promise.all([fetchWorkItem(id!), fetchTimeline(id!)])
      setItem(wi); setTimeline(tl)
    } catch(e: any) { setActionMsg({ ok: false, text: e.message }) }
    finally { setActionLoading(false) }
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Breadcrumb header */}
      <div className="flex items-start gap-3 flex-shrink-0">
        <button onClick={() => navigate('/queue')} className="btn btn-ghost" style={{ width: 32, height: 32, padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 2 }}>
          <ArrowLeft size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {item.invoiceNumber}
            </h1>
            <RiskBadge tier={item.riskTier as RiskTier} />
            <DecisionBadge decision={item.agentDecision as AgentDecision} />
            <TypeBadge type={item.discrepancyType as DiscrepancyType} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 4 }} className="truncate">
            {item.vendorId} · {item.poNumber} · {item.companyCode} · {fmtCurrency(item.totalAmount, item.currency)} · {fmtDate(item.postingDate)}
          </p>
        </div>
      </div>

      {actionMsg && (
        <div
          className="flex-shrink-0"
          style={{
            padding: '8px 12px',
            borderRadius: 2,
            fontSize: 11,
            fontWeight: 500,
            color: actionMsg.ok ? 'var(--status-low-text)' : 'var(--status-critical)',
            background: actionMsg.ok ? 'var(--status-low-bg)' : 'var(--status-critical-bg)',
            border: `1px solid ${actionMsg.ok ? 'var(--status-low-border)' : 'var(--status-critical-bg)'}`,
          }}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4">
          {/* Left: content */}
          <div className="lg:col-span-2 space-y-4">

            {/* AI Analysis */}
            <div className="card overflow-hidden">
              <SectionHeader title="AI ANALYSIS" />
              <div style={{ padding: 16 }} className="space-y-3">
                <div>
                  <p className="label" style={{ marginBottom: 4 }}>Description</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.description || '—'}</p>
                </div>
                <div>
                  <p className="label" style={{ marginBottom: 4 }}>Decision Reason</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.decisionReason || '—'}</p>
                </div>
                <div>
                  <p className="label" style={{ marginBottom: 4 }}>Risk Rationale</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{item.riskRationale || '—'}</p>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="label" style={{ marginBottom: 4 }}>Confidence</p>
                    <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {fmtPct(item.confidence)}
                    </p>
                  </div>
                  {item.traceId && (
                    <div>
                      <p className="label" style={{ marginBottom: 4 }}>Trace ID</p>
                      <p style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {item.traceId}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Detected discrepancies */}
            {detectedFields.length > 0 && (
              <div className="card overflow-hidden">
                <SectionHeader title="DETECTED DISCREPANCIES" />
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                      <th className="label text-left" style={{ padding: '10px 12px' }}>Field</th>
                      <th className="label text-right" style={{ padding: '10px 12px' }}>Invoice</th>
                      <th className="label text-right" style={{ padding: '10px 12px' }}>Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detectedFields.map((f, i) => (
                      <tr key={i} className="tr-hover" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)' }}>{f.field}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--status-critical)' }}>
                          {String(f.invoiceValue)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--status-low-text)' }}>
                          {String(f.expectedValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Invoice Lines */}
            <div className="card overflow-hidden">
              <SectionHeader title="INVOICE LINES" />
              {linesLoaded && lines.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2" style={{ padding: '40px 0', color: 'var(--text-muted)' }}>
                  <FileX size={24} />
                  <p style={{ fontSize: 11 }}>No line items found for this invoice</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                        {['#', 'Material', 'Qty', 'Unit Price', 'Net Amount'].map((h, i) => (
                          <th
                            key={i}
                            className={`label ${i > 1 ? 'text-right' : 'text-left'}`}
                            style={{ padding: '10px 12px' }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(l => (
                        <tr
                          key={l.ID}
                          className="tr-hover"
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: l.hasCorrection ? 'var(--status-low-surface)' : undefined,
                          }}
                        >
                          <td style={{ padding: '8px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {l.lineNumber}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500 }}>{l.materialNumber}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{l.description}</div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {l.hasCorrection && l.correctedQty != null ? (
                              <>
                                <span style={{ textDecoration: 'line-through', color: 'var(--status-critical)', marginRight: 4 }}>{l.quantity}</span>
                                <span style={{ color: 'var(--status-low-text)', fontWeight: 500 }}>{l.correctedQty}</span>
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>{l.quantity}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {l.hasCorrection && l.correctedUnitPrice != null ? (
                              <>
                                <span style={{ textDecoration: 'line-through', color: 'var(--status-critical)', marginRight: 4 }}>{fmtCurrency(l.unitPrice, item.currency)}</span>
                                <span style={{ color: 'var(--status-low-text)', fontWeight: 500 }}>{fmtCurrency(l.correctedUnitPrice, item.currency)}</span>
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>{fmtCurrency(l.unitPrice, item.currency)}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {fmtCurrency(l.hasCorrection && l.correctedNetAmount != null ? l.correctedNetAmount : l.netAmount, item.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Proposed corrections diff */}
            {corrections.length > 0 && (
              <div className="card overflow-hidden">
                <SectionHeader title="PROPOSED CORRECTIONS" />
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                      <th className="label text-left" style={{ padding: '10px 12px' }}>Line</th>
                      <th className="label text-left" style={{ padding: '10px 12px' }}>Field</th>
                      <th className="label text-right" style={{ padding: '10px 12px' }}>Before</th>
                      <th className="label text-center" style={{ padding: '10px 12px' }}>→</th>
                      <th className="label text-right" style={{ padding: '10px 12px' }}>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrections.map((c, i) => (
                      <tr key={i} className="tr-hover" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                          {c.lineNumber}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)' }}>
                          {c.field}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 10,
                            color: 'var(--status-critical)', background: 'var(--status-critical-bg)',
                            padding: '2px 6px', borderRadius: 2, textDecoration: 'line-through',
                          }}>
                            {c.before}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>→</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 10,
                            color: 'var(--status-low-text)', background: 'var(--status-low-bg)',
                            padding: '2px 6px', borderRadius: 2, fontWeight: 600,
                          }}>
                            {c.after}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right: actions + timeline */}
          <div className="space-y-4">
            <div className="card overflow-hidden">
              <SectionHeader title="ACTIONS" />
              <div style={{ padding: 12 }} className="space-y-1.5">
                {!item.assignedTo && (
                  <button onClick={() => doAction(() => assignToMe(item.ID))} disabled={actionLoading} className="btn w-full justify-start">
                    <UserCheck size={14} />Assign to me
                  </button>
                )}
                {item.assignedTo && (
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', padding: '0 4px 4px' }}>
                    Assigned to {displayIdentity(item.assignedTo)}
                  </p>
                )}
                <button onClick={() => setModal('accept')}   disabled={actionLoading} className="btn btn-success w-full justify-start"><CheckCircle2 size={14} />Accept Correction</button>
                <button onClick={() => setModal('override')} disabled={actionLoading} className="btn w-full justify-start" style={{ color: 'var(--accent-link)' }}><Edit3 size={14} />Override Correction</button>
                <button onClick={() => setModal('escalate')} disabled={actionLoading} className="btn btn-warn w-full justify-start"><TrendingUp size={14} />Escalate</button>
                <button onClick={() => setModal('reject')}   disabled={actionLoading} className="btn btn-danger w-full justify-start"><XCircle size={14} />Reject Invoice</button>
                <div style={{ paddingTop: 4, borderTop: '1px solid var(--border-default)' }}>
                  <button onClick={() => doAction(() => reprocessInvoice(item.invoiceId))} disabled={actionLoading} className="btn btn-ghost w-full justify-start" style={{ color: 'var(--text-muted)' }}>
                    <RefreshCw size={14} />Retry AI Analysis
                  </button>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <SectionHeader title="TIMELINE" />
              <div style={{ padding: 16 }}>
                {timeline.length === 0
                  ? <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No events yet</p>
                  : timeline.map(ev => <TlItem key={ev.ID} ev={ev} />)
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      {modal === 'override' && <OverrideModal loading={actionLoading} onCancel={() => setModal(null)} onConfirm={(cl, n) => doAction(() => overrideCorrection(item.ID, cl, n))} />}
      {modal === 'accept'   && <SimpleModal title="Accept Correction"  placeholder="Notes (optional)…"    destructive={false} loading={actionLoading} onCancel={() => setModal(null)} onConfirm={n => doAction(() => acceptCorrection(item.ID, n))} />}
      {modal === 'escalate' && <SimpleModal title="Escalate"           placeholder="Reason…"              destructive={true}  loading={actionLoading} onCancel={() => setModal(null)} onConfirm={r => doAction(() => escalate(item.ID, r))} />}
      {modal === 'reject'   && <SimpleModal title="Reject Invoice"     placeholder="Reason for rejection…" destructive={true} loading={actionLoading} onCancel={() => setModal(null)} onConfirm={r => doAction(() => rejectInvoice(item.invoiceId, r))} />}
    </div>
  )
}
