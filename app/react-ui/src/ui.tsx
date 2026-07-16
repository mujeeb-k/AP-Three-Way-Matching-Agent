import type { RiskTier, AgentDecision, DiscrepancyType } from './types'

// Formatters
export function displayIdentity(value: string | null | undefined) {
  if (!value) return '—'
  return value.toLowerCase() === 'demo' ? 'AP Analyst' : value
}

export function fmtCurrency(n: number | null | undefined, currency = 'EUR') {
  if (n == null) return '—'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(n)
}
export function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtDatetime(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${Math.round(n * 100)}%`
}

// ─── Risk badge styles (CSS var based) ───────────────────────────────────────
export const RISK_STYLES: Record<RiskTier, { bg: string; color: string; border: string }> = {
  CRITICAL: { bg: 'var(--status-critical-bg)', color: 'var(--status-critical)', border: 'var(--status-critical-bg)' },
  HIGH:     { bg: 'var(--status-high-bg)',     color: 'var(--status-high)',     border: 'var(--status-high-bg)' },
  MEDIUM:   { bg: 'var(--status-medium-bg)',   color: 'var(--status-medium)',   border: 'var(--status-medium-bg)' },
  LOW:      { bg: 'var(--status-low-bg)',      color: 'var(--status-low)',      border: 'var(--status-low-bg)' },
}

export const DECISION_STYLES: Record<AgentDecision, { bg: string; color: string; border: string }> = {
  AUTO_RESOLVED:  { bg: 'var(--status-low-bg)',      color: 'var(--status-low-text)', border: 'var(--status-low-border)' },
  AUTO_CORRECTED: { bg: 'var(--status-low-bg)',      color: 'var(--status-low-text)', border: 'var(--status-low-border)' },
  PENDING_GR:     { bg: 'var(--status-medium-bg)',   color: 'var(--status-medium)',   border: 'var(--status-medium-bg)' },
  FLAGGED_REVIEW: { bg: 'var(--status-high-bg)',     color: 'var(--status-high)',     border: 'var(--status-high-bg)' },
  FLAGGED_REJECT: { bg: 'var(--status-critical-bg)', color: 'var(--status-critical)', border: 'var(--status-critical-bg)' },
  ESCALATED:      { bg: 'var(--status-critical-bg)', color: 'var(--status-critical)', border: 'var(--status-critical-bg)' },
  NO_DISCREPANCY: { bg: 'var(--bg-active)',          color: 'var(--text-tertiary)',   border: 'var(--border-default)' },
}

export const DECISION_LABELS: Record<AgentDecision, string> = {
  AUTO_RESOLVED:  'Auto Resolved',
  AUTO_CORRECTED: 'Auto Corrected',
  PENDING_GR:     'Pending GR',
  FLAGGED_REVIEW: 'Flagged Review',
  FLAGGED_REJECT: 'Flagged Reject',
  ESCALATED:      'Escalated',
  NO_DISCREPANCY: 'No Discrepancy',
}

export const TYPE_LABELS: Record<DiscrepancyType, string> = {
  PRICE_VARIANCE:     'Price Variance',
  QTY_VARIANCE:       'Qty Variance',
  MISSING_GR:         'Missing GR',
  INVOICE_BEFORE_GR:  'Inv. Before GR',
  WRONG_PO_REFERENCE: 'Wrong PO',
  LINE_STRUCTURE:     'Line Structure',
  CURRENCY_MISMATCH:  'Currency',
  ENTITY_MISMATCH:    'Entity',
  MULTI_PO:           'Multi-PO',
  FIELD_SWAP:         'Field Swap',
  DUPLICATE:          'Duplicate',
  UOM_MISMATCH:       'UOM Mismatch',
  SEPARATOR_AMBIGUITY:'Separator',
  MATERIAL_MISMATCH:  'Material',
}

// Type badges use neutral styling (informational, not status-indicating)
export const TYPE_STYLES: Record<DiscrepancyType, { bg: string; color: string; border: string }> = {
  PRICE_VARIANCE:     { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  QTY_VARIANCE:       { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  MISSING_GR:         { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  INVOICE_BEFORE_GR:  { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  WRONG_PO_REFERENCE: { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  LINE_STRUCTURE:     { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  CURRENCY_MISMATCH:  { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  ENTITY_MISMATCH:    { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  MULTI_PO:           { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  FIELD_SWAP:         { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  DUPLICATE:          { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  UOM_MISMATCH:       { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  SEPARATOR_AMBIGUITY:{ bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
  MATERIAL_MISMATCH:  { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ style: styleProp, children }: {
  style?: { bg: string; color: string; border: string }
  children: React.ReactNode
}) {
  const s = styleProp || { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' }
  return (
    <span
      className="badge"
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {children}
    </span>
  )
}

export function RiskBadge({ tier }: { tier: RiskTier }) {
  return <Badge style={RISK_STYLES[tier]}>{tier}</Badge>
}

export function DecisionBadge({ decision }: { decision: AgentDecision }) {
  return <Badge style={DECISION_STYLES[decision]}>{DECISION_LABELS[decision]}</Badge>
}

export function TypeBadge({ type }: { type: DiscrepancyType }) {
  return <Badge style={TYPE_STYLES[type]}>{TYPE_LABELS[type]}</Badge>
}

// ─── Stat card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, cardStyle }: {
  label: string
  value: number | string
  sub?: string
  cardStyle?: React.CSSProperties
}) {
  return (
    <div className="card" style={{ padding: '14px 16px', ...cardStyle }}>
      <p className="label mb-2">{label}</p>
      <p
        className="font-sans font-medium"
        style={{
          fontSize: 28,
          lineHeight: 1,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          {sub}
        </p>
      )}
    </div>
  )
}

// ─── Section panel ────────────────────────────────────────────────────────────
export function Panel({ title, children, className = '' }: {
  title?: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      {title && (
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <h2 className="label" style={{ color: 'var(--text-muted)' }}>{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── Table helpers ────────────────────────────────────────────────────────────
export function Th({ children, right, onClick, style: s }: {
  children: React.ReactNode
  right?: boolean
  onClick?: () => void
  style?: React.CSSProperties
}) {
  return (
    <th
      className={`label ${right ? 'text-right' : 'text-left'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ padding: '10px 12px', fontSize: 9, ...s }}
      onClick={onClick}
    >
      {children}
    </th>
  )
}

// ─── Loading / Error ──────────────────────────────────────────────────────────
export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <div
        className="animate-spin"
        style={{
          width: 16, height: 16,
          border: '2px solid var(--border-active)',
          borderTopColor: 'transparent',
          borderRadius: '50%',
        }}
      />
      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{text}</p>
    </div>
  )
}

export function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-1.5">
      <p className="font-sans" style={{ fontSize: 13, fontWeight: 500, color: 'var(--status-critical)' }}>
        Error
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{message}</p>
    </div>
  )
}
