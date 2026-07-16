import { useState } from 'react'
import type {
  RichContentBlock, InvoiceDetailBlock, InvoiceListBlock, SelectionBlock,
  ConfirmationBlock, ActionResultBlock, SequentialReviewBlock, ReviewCompleteBlock,
  DiscrepancyType, RiskTier, AgentDecision,
} from '../../types'
import { RiskBadge, DecisionBadge, TypeBadge, Badge, fmtCurrency } from '../../ui'

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function RichContent({ block, onSend, readOnly }: {
  block: RichContentBlock
  onSend: (prompt: string) => void
  readOnly?: boolean
}) {
  switch (block.type) {
    case 'invoice_detail':  return <InvoiceDetailCard data={block.data} onSend={onSend} readOnly={readOnly} />
    case 'invoice_list':    return <InvoiceListCard data={block.data} onSend={onSend} readOnly={readOnly} />
    case 'selection':       return <SelectionChips data={block.data} onSend={onSend} readOnly={readOnly} />
    case 'confirmation':    return <ConfirmationCard data={block.data} onSend={onSend} readOnly={readOnly} />
    case 'action_result':      return <ActionResultCard data={block.data} />
    case 'sequential_review':  return <SequentialReviewCard data={block.data} onSend={onSend} readOnly={readOnly} />
    case 'review_complete':    return <ReviewCompleteCard data={block.data} />
    default:                   return null
  }
}

// ─── Invoice Detail Card ─────────────────────────────────────────────────────

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

function InvoiceDetailCard({ data, onSend, readOnly }: { data: InvoiceDetailBlock['data']; onSend: (p: string) => void; readOnly?: boolean }) {
  const { invoice, discrepancies, lines } = data
  const primaryDisc = discrepancies[0]
  if (!primaryDisc) return null

  const detectedFields = parseJson<Array<{ field: string; invoiceValue: string | number; expectedValue: string | number }>>(primaryDisc.detectedFields, [])

  return (
    <div className="card overflow-hidden" style={{ marginTop: 8, maxWidth: 520 }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-default)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {invoice.vendorInvoiceNo}
          </span>
          <RiskBadge tier={primaryDisc.riskTier as RiskTier} />
          <DecisionBadge decision={primaryDisc.agentDecision as AgentDecision} />
          {discrepancies.length > 1 && (
            <span className="badge" style={{ background: 'var(--bg-active)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }}>
              +{discrepancies.length - 1} more
            </span>
          )}
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          {invoice.vendorId} · {invoice.poNumber} · {fmtCurrency(invoice.totalAmount, invoice.currency)}
        </p>
      </div>

      {/* Detected Fields */}
      {detectedFields.length > 0 && (
        <table className="w-full" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <thead>
            <tr style={{ background: 'var(--bg-base)' }}>
              <th className="label text-left" style={{ padding: '6px 14px', fontSize: 8 }}>Field</th>
              <th className="label text-right" style={{ padding: '6px 14px', fontSize: 8 }}>Invoice</th>
              <th className="label text-right" style={{ padding: '6px 14px', fontSize: 8 }}>Expected</th>
            </tr>
          </thead>
          <tbody>
            {detectedFields.slice(0, 4).map((f, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '5px 14px', fontSize: 10, color: 'var(--text-secondary)' }}>{f.field}</td>
                <td style={{ padding: '5px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--status-critical)', textAlign: 'right' }}>{String(f.invoiceValue)}</td>
                <td style={{ padding: '5px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--status-low-text)', textAlign: 'right' }}>{String(f.expectedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* AI Description */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-default)' }}>
        <p style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {primaryDisc.description}
        </p>
      </div>

      {/* Action buttons */}
      {primaryDisc.reviewStatus !== 'RESOLVED' && !readOnly && (
        <div className="flex gap-1.5" style={{ padding: '10px 14px' }}>
          <button
            className="btn btn-success"
            style={{ padding: '4px 10px', fontSize: 10 }}
            onClick={() => onSend(`Accept the correction for ${invoice.vendorInvoiceNo}`)}
          >
            Accept
          </button>
          <button
            className="btn btn-warn"
            style={{ padding: '4px 10px', fontSize: 10 }}
            onClick={() => onSend(`Escalate ${invoice.vendorInvoiceNo}`)}
          >
            Escalate
          </button>
          <button
            className="btn btn-danger"
            style={{ padding: '4px 10px', fontSize: 10 }}
            onClick={() => onSend(`Reject invoice ${invoice.vendorInvoiceNo}`)}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Invoice List Card ───────────────────────────────────────────────────────

function InvoiceListCard({ data, onSend, readOnly }: { data: InvoiceListBlock['data']; onSend: (p: string) => void; readOnly?: boolean }) {
  return (
    <div className="card overflow-hidden" style={{ marginTop: 8, maxWidth: 520 }}>
      <div className="label" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-default)' }}>
        {data.totalCount} INVOICE{data.totalCount !== 1 ? 'S' : ''} FOUND
      </div>
      <div className="space-y-0">
        {data.items.slice(0, 10).map(item => (
          <div
            key={item.discrepancyId}
            className={`flex items-center gap-2 ${readOnly ? '' : 'cursor-pointer'} tr-hover`}
            style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)' }}
            onClick={readOnly ? undefined : () => onSend(`Show me the details on ${item.invoiceNumber}`)}
          >
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-link)', fontWeight: 500, minWidth: 120 }}>
              {item.invoiceNumber}
            </span>
            <RiskBadge tier={item.riskTier} />
            <TypeBadge type={item.discrepancyType} />
            <span className="ml-auto" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {fmtCurrency(item.totalAmount, item.currency)}
            </span>
          </div>
        ))}
      </div>
      {data.totalCount > 10 && (
        <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)' }}>
          + {data.totalCount - 10} more
        </div>
      )}
    </div>
  )
}

// ─── Selection Chips ─────────────────────────────────────────────────────────

function SelectionChips({ data, onSend, readOnly }: { data: SelectionBlock['data']; onSend: (p: string) => void; readOnly?: boolean }) {
  return (
    <div style={{ marginTop: 8 }}>
      {data.prompt && (
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{data.prompt}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {data.items.map(item => (
          <button
            key={item.id}
            className="flex items-center gap-1.5"
            disabled={readOnly}
            style={{
              padding: '6px 10px', borderRadius: 2, cursor: readOnly ? 'default' : 'pointer',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              fontSize: 11, color: 'var(--text-secondary)',
              opacity: readOnly ? 0.7 : 1,
            }}
            onClick={readOnly ? undefined : () => onSend(`Show me the details on ${item.invoiceNumber}`)}
            onMouseEnter={readOnly ? undefined : e => { e.currentTarget.style.borderColor = 'var(--border-active)'; e.currentTarget.style.background = 'var(--bg-active)' }}
            onMouseLeave={readOnly ? undefined : e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{item.invoiceNumber}</span>
            <RiskBadge tier={item.riskTier} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Confirmation Block ──────────────────────────────────────────────────────

function ConfirmationCard({ data, onSend, readOnly }: { data: ConfirmationBlock['data']; onSend: (p: string) => void; readOnly?: boolean }) {
  return (
    <div
      className="card"
      style={{
        marginTop: 8, maxWidth: 480, padding: '14px',
        border: '1px solid var(--status-high-bg)',
        background: 'var(--status-high-surface)',
      }}
    >
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        About to <strong style={{ color: 'var(--text-primary)' }}>{data.action}</strong> on{' '}
        <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{data.invoiceNumber}</strong>.{' '}
        {data.consequence}
      </p>
      <div className="flex gap-1.5" style={{ marginTop: 10 }}>
        <button
          className="btn btn-success"
          style={{ padding: '5px 14px', fontSize: 11 }}
          disabled={readOnly}
          onClick={readOnly ? undefined : () => onSend(`Yes, confirm the ${data.action}`)}
        >
          Confirm
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: '5px 14px', fontSize: 11 }}
          disabled={readOnly}
          onClick={readOnly ? undefined : () => onSend(`Cancel, don't ${data.action}`)}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Action Result ───────────────────────────────────────────────────────────

function ActionResultCard({ data }: { data: ActionResultBlock['data'] }) {
  const ok = data.success
  return (
    <div
      className="card flex items-center gap-2.5"
      style={{
        marginTop: 8, padding: '10px 14px', maxWidth: 420,
        background: ok ? 'var(--status-low-surface)' : 'var(--status-critical-surface)',
        border: `1px solid ${ok ? 'var(--status-low-border)' : 'var(--status-critical-bg)'}`,
      }}
    >
      <div
        style={{
          width: 6, height: 6, borderRadius: 1, flexShrink: 0,
          background: ok ? 'var(--status-low)' : 'var(--status-critical)',
        }}
      />
      <p style={{ fontSize: 11, color: ok ? 'var(--status-low-text)' : 'var(--status-critical-text)' }}>
        {data.message}
      </p>
    </div>
  )
}

// ─── Sequential Review Card ─────────────────────────────────────────────────

type ReviewDecision = 'accept' | 'escalate' | 'reject' | 'skip'

const DECISION_COLORS: Record<ReviewDecision, { bg: string; color: string; border: string; label: string }> = {
  accept:   { bg: 'var(--status-low-bg)',      color: 'var(--status-low-text)',  border: 'var(--status-low-border)', label: 'Accepted' },
  escalate: { bg: 'var(--status-high-bg)',      color: 'var(--status-high)',      border: 'var(--status-high-bg)',    label: 'Escalated' },
  reject:   { bg: 'var(--status-critical-bg)',  color: 'var(--status-critical)',  border: 'var(--status-critical-bg)',label: 'Rejected' },
  skip:     { bg: 'var(--bg-active)',           color: 'var(--text-tertiary)',    border: 'var(--border-default)',    label: 'Skipped' },
}

function SequentialReviewCard({ data, onSend, readOnly }: {
  data: SequentialReviewBlock['data']
  onSend: (p: string) => void
  readOnly?: boolean
}) {
  const [currentIndex, setCurrentIndex] = useState(data.currentIndex ?? 0)
  const [decisions, setDecisions] = useState<Record<number, ReviewDecision>>({})

  function decide(index: number, action: ReviewDecision) {
    setDecisions(prev => ({ ...prev, [index]: action }))

    if (action === 'skip') {
      // Skip doesn't commit — just advance
      if (index < data.items.length - 1) {
        setCurrentIndex(index + 1)
      }
      return
    }

    // For committing actions (accept/escalate/reject), send a message that
    // triggers the confirmation flow. The LLM will respond with a confirmation
    // block, then on user confirm, the backend call fires individually.
    const item = data.items[index]
    const actionVerb = action === 'accept' ? 'Accept the correction for'
      : action === 'escalate' ? 'Escalate'
      : 'Reject invoice'
    onSend(`${actionVerb} ${item.invoiceNumber}`)
  }

  // Advance to next item when a decision has been recorded
  // (called after confirmation completes via action_result)
  function advanceAfterCommit(index: number) {
    if (index < data.items.length - 1) {
      setCurrentIndex(index + 1)
    }
  }

  return (
    <div className="card overflow-hidden" style={{ marginTop: 8, maxWidth: 540 }}>
      <div className="label flex items-center justify-between" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-default)' }}>
        <span>SEQUENTIAL REVIEW ({Object.keys(decisions).length}/{data.items.length})</span>
      </div>

      {data.items.map((item, i) => {
        const decided = decisions[i]
        const isCurrent = i === currentIndex && !decided

        // Already decided: compact row
        if (decided) {
          const dc = DECISION_COLORS[decided]
          return (
            <div
              key={item.discrepancyId}
              className="flex items-center gap-2"
              style={{
                padding: '6px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                opacity: 0.8,
              }}
            >
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', minWidth: 100 }}>
                {item.invoiceNumber}
              </span>
              <RiskBadge tier={item.riskTier} />
              <Badge style={{ bg: dc.bg, color: dc.color, border: dc.border }}>
                {dc.label}
              </Badge>
              <span className="ml-auto" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {fmtCurrency(item.totalAmount, item.currency)}
              </span>
            </div>
          )
        }

        // Current item: expanded card
        if (isCurrent) {
          return (
            <div
              key={item.discrepancyId}
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border-default)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {item.invoiceNumber}
                </span>
                <RiskBadge tier={item.riskTier} />
                <TypeBadge type={item.discrepancyType} />
                <span className="ml-auto" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {fmtCurrency(item.totalAmount, item.currency)}
                </span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                {item.vendorId}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
                {item.description}
              </p>

              {/* Action buttons — each fires individually */}
              {!readOnly && (
                <div className="flex gap-1.5" style={{ marginTop: 10 }}>
                  <button className="btn btn-success" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => decide(i, 'accept')}>
                    Accept
                  </button>
                  <button className="btn btn-warn" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => decide(i, 'escalate')}>
                    Escalate
                  </button>
                  <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => decide(i, 'reject')}>
                    Reject
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => decide(i, 'skip')}>
                    Skip
                  </button>
                </div>
              )}
            </div>
          )
        }

        // Future item: dimmed pending row
        return (
          <div
            key={item.discrepancyId}
            className="flex items-center gap-2"
            style={{
              padding: '6px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              opacity: 0.4,
            }}
          >
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', minWidth: 100 }}>
              {item.invoiceNumber}
            </span>
            <RiskBadge tier={item.riskTier} />
            <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>Pending</span>
            <span className="ml-auto" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              {fmtCurrency(item.totalAmount, item.currency)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Review Complete Card (read-only summary) ───────────────────────────────

function ReviewCompleteCard({ data }: {
  data: ReviewCompleteBlock['data']
}) {
  const counts = { accept: 0, escalate: 0, reject: 0, skip: 0 }
  for (const d of data.decisions) {
    if (d.action in counts) counts[d.action as ReviewDecision]++
  }

  // Build human-readable summary
  const parts: string[] = []
  if (counts.accept > 0) parts.push(`${counts.accept} correction${counts.accept !== 1 ? 's' : ''} applied`)
  if (counts.escalate > 0) parts.push(`${counts.escalate} escalated`)
  if (counts.reject > 0) parts.push(`${counts.reject} rejected`)
  if (counts.skip > 0) parts.push(`${counts.skip} invoice${counts.skip !== 1 ? 's' : ''} skipped`)

  return (
    <div className="card overflow-hidden" style={{ marginTop: 8, maxWidth: 480 }}>
      <div className="label" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-default)' }}>
        REVIEW COMPLETE
      </div>

      {/* Decision table */}
      <table className="w-full">
        <thead>
          <tr style={{ background: 'var(--bg-base)' }}>
            <th className="label text-left" style={{ padding: '6px 14px', fontSize: 8 }}>Invoice</th>
            <th className="label text-left" style={{ padding: '6px 14px', fontSize: 8 }}>Decision</th>
          </tr>
        </thead>
        <tbody>
          {data.decisions.map(d => {
            const dc = DECISION_COLORS[d.action as ReviewDecision] ?? DECISION_COLORS.skip
            return (
              <tr key={d.discrepancyId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '5px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {d.invoiceNumber}
                </td>
                <td style={{ padding: '5px 14px' }}>
                  <Badge style={{ bg: dc.bg, color: dc.color, border: dc.border }}>
                    {dc.label}
                  </Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Summary line */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-default)' }}>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {parts.join('. ')}.
        </p>
      </div>
    </div>
  )
}
