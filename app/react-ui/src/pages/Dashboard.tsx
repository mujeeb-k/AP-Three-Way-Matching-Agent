import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { fetchStats, fetchActivityTrend } from '../api'
import type { ActivityTrendPoint, DashboardStats } from '../types'
import { Loading, ErrorMsg, StatCard } from '../ui'

function ActivityChart({ data }: { data: ActivityTrendPoint[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="card" style={{ padding: '16px' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="label">INVOICES PROCESSED — LAST 7 DAYS</p>
        <div className="flex items-center gap-1.5">
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--status-low)' }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Processed</span>
        </div>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 64 }}>
        {data.map(({ date, count }) => {
          const pct = Math.round((count / max) * 100)
          const label = new Date(date).toLocaleDateString('en-GB', { weekday: 'short' })
          return (
            <div key={date} className="flex-1 flex flex-col items-center gap-1">
              {count > 0 && (
                <span className="dynamic-number" style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {count}
                </span>
              )}
              <div className="w-full relative" style={{ height: 48, background: 'var(--border-default)', borderRadius: 2 }}>
                <div
                  className="absolute bottom-0 left-0 right-0"
                  style={{ height: `${pct}%`, background: 'var(--status-low)', borderRadius: 2, opacity: 0.8 }}
                />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AlertBanner({ critical, escalated, onClick }: { critical: number; escalated: number; onClick: () => void }) {
  if (critical === 0 && escalated === 0) return null
  return (
    <button
      type="button"
      className="dashboard-alert flex items-center gap-3"
      style={{
        padding: '10px 14px',
        background: 'var(--status-critical-surface)',
        border: '1px solid var(--status-critical-bg)',
        borderRadius: 2,
      }}
      onClick={onClick}
    >
      <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-critical)', flexShrink: 0 }} />
      <p style={{ fontSize: 11, color: 'var(--status-critical-text)', flex: 1 }}>
        {critical} critical and {escalated} escalated invoice{critical + escalated !== 1 ? 's' : ''} require immediate attention
      </p>
      <span className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--status-critical)', whiteSpace: 'nowrap' }}>
        View <ArrowRight size={13} aria-hidden="true" />
      </span>
    </button>
  )
}

function RiskDistribution({ data }: { data: { tier: string; count: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="card" style={{ padding: '16px' }}>
      <p className="label mb-3">RISK DISTRIBUTION</p>
      <div className="space-y-3">
        {data.map(({ tier, count, color }) => (
          <div key={tier} className="flex items-center gap-3">
            <span style={{ fontSize: 10, color, width: 56, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              {tier}
            </span>
            <div className="flex-1" style={{ height: 3, background: 'var(--border-default)', borderRadius: 1 }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: color, borderRadius: 1 }} />
            </div>
            <span className="dynamic-number" style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', width: 16, textAlign: 'right' }}>
              {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResolutionDecisions({ data }: { data: { label: string; count: number; color: string; border?: string }[] }) {
  return (
    <div className="card" style={{ padding: '16px' }}>
      <p className="label mb-3">RESOLUTION DECISIONS</p>
      <div className="grid grid-cols-2 gap-1.5">
        {data.map(({ label, count, color, border }) => (
          <div
            key={label}
            style={{
              padding: '10px 12px',
              background: 'var(--bg-elevated)',
              border: `1px solid ${border || 'var(--border-default)'}`,
              borderRadius: 2,
            }}
          >
            <p className="dynamic-number" style={{ fontSize: 20, fontFamily: 'var(--font-sans)', fontWeight: 500, color }}>
              {count}
            </p>
            <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginTop: 2 }}>
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [trend, setTrend] = useState<ActivityTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchStats(), fetchActivityTrend()])
      .then(([s, t]) => { setStats(s); setTrend(t) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />
  if (error) return <ErrorMsg message={error} />
  if (!stats) return <ErrorMsg message="Dashboard statistics are unavailable" />

  const riskData = [
    { tier: 'CRITICAL', count: stats.critical,    color: 'var(--status-critical)' },
    { tier: 'HIGH',     count: stats.high,         color: 'var(--status-high)' },
    { tier: 'MEDIUM',   count: stats.medium,        color: 'var(--status-medium)' },
    { tier: 'LOW',      count: stats.low,           color: 'var(--status-low)' },
  ]

  const decisionData = [
    { label: 'Auto Corrected', count: stats.autoCorrections, color: 'var(--status-low-text)',    border: 'var(--status-low-border)' },
    { label: 'Flagged Review', count: stats.flaggedReview, color: 'var(--status-high)' },
    { label: 'Escalated',      count: stats.escalated,       color: 'var(--status-critical)',    border: 'var(--status-critical-bg)' },
    { label: 'Resolved',       count: stats.resolved,        color: stats.resolved === 0 ? 'var(--text-ghost)' : 'var(--text-primary)' },
  ]

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="font-sans" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            Invoice reconciliation dashboard
          </h1>
          <p className="label" style={{ letterSpacing: '0.1em' }}>
            AP INVOICE RECONCILIATION | INTELLIGENT 3-WAY MATCHING
          </p>
        </div>
      </div>

      {/* Alert banner */}
      <AlertBanner
        critical={stats.critical}
        escalated={stats.escalated}
        onClick={() => navigate('/queue?risk=CRITICAL')}
      />

      {/* Metric cards — 2 rows × 3 columns */}
      <div className="grid grid-cols-3 gap-2 flex-shrink-0">
        <button type="button" onClick={() => navigate('/queue')} className="dashboard-card-button">
          <StatCard label="Total Invoices" value={stats.totalInvoices} sub={`${stats.pending} pending`} />
        </button>
        <button type="button" onClick={() => navigate('/queue?status=PENDING')} className="dashboard-card-button">
          <StatCard label="Pending Review" value={stats.pending} sub={stats.inReview > 0 ? `${stats.inReview} in review` : '—'} />
        </button>
        <button type="button" onClick={() => navigate('/queue?risk=CRITICAL')} className="dashboard-card-button">
          <StatCard
            label="Critical / High"
            value={`${stats.critical} / ${stats.high}`}
            sub="by risk tier"
            cardStyle={{ background: 'var(--status-critical-surface)', borderColor: 'var(--status-critical-bg)' }}
          />
        </button>
        <button type="button" onClick={() => navigate('/queue?decision=AUTO_CORRECTED')} className="dashboard-card-button">
          <StatCard
            label="Auto-Corrections"
            value={stats.autoCorrections}
            sub="human approval required"
          />
        </button>
        <StatCard
          label="Resolved"
          value={stats.resolved}
          sub="—"
        />
        <button type="button" onClick={() => navigate('/queue?decision=ESCALATED')} className="dashboard-card-button">
          <StatCard label="Escalated" value={stats.escalated} sub="awaiting manager" />
        </button>
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-3 gap-2 flex-1 min-h-0">
        <RiskDistribution data={riskData} />
        <ResolutionDecisions data={decisionData} />
        {trend.length > 0 && <ActivityChart data={trend} />}
      </div>
    </div>
  )
}
