import { useEffect, useState, useRef } from 'react'
import { Search } from 'lucide-react'
import { fetchAllTimeline } from '../api'
import type { TimelineEvent } from '../types'
import { Loading, ErrorMsg, displayIdentity, fmtDatetime } from '../ui'

const TYPE_LABEL: Record<string, string> = {
  RECEIVED:       'Received',
  AGENT_ANALYZED: 'Agent Analyzed',
  FLAGGED:        'Flagged',
  AUTO_CORRECTED: 'Auto Corrected',
  ASSIGNED:       'Assigned',
  REVIEWED:       'Reviewed',
  ESCALATED:      'Escalated',
  RESOLVED:       'Resolved',
  REJECTED:       'Rejected',
  NORMALISED:     'Normalised',
  PENDING_GR:     'Pending GR',
}

const EVENT_DOT_COLOR: Record<string, string> = {
  RECEIVED:       'var(--text-muted)',
  AGENT_ANALYZED: 'var(--accent-link)',
  FLAGGED:        'var(--status-high)',
  AUTO_CORRECTED: 'var(--status-low)',
  ASSIGNED:       'var(--accent-link)',
  REVIEWED:       'var(--status-low)',
  ESCALATED:      'var(--status-critical)',
  RESOLVED:       'var(--status-low)',
  REJECTED:       'var(--status-critical)',
  NORMALISED:     'var(--status-medium)',
  PENDING_GR:     'var(--status-medium)',
}

function actorDisplay(ev: TimelineEvent): string {
  if (ev.actorRole === 'ASSISTANT' || ev.actor === 'ASSISTANT') return 'AP Copilot'
  if (ev.actorRole === 'AGENT' || ev.actor === 'AGENT') return 'Agent'
  if (ev.actorRole === 'SYSTEM' || ev.actor === 'SYSTEM') return 'System'
  return displayIdentity(ev.actor || ev.actorRole)
}

function actorBadgeStyle(ev: TimelineEvent): { bg: string; color: string } {
  const role = ev.actorRole || ev.actor
  if (role === 'ASSISTANT') return { bg: 'var(--bg-active)', color: 'var(--accent-link)' }
  if (role === 'AGENT') return { bg: 'var(--status-high-bg)', color: 'var(--status-high)' }
  if (role === 'SYSTEM') return { bg: 'var(--bg-active)', color: 'var(--text-tertiary)' }
  if (role === 'AP_CLERK') return { bg: 'var(--bg-active)', color: 'var(--accent-link)' }
  if (role === 'AP_MANAGER') return { bg: 'var(--status-high-bg)', color: 'var(--status-high)' }
  return { bg: 'var(--bg-active)', color: 'var(--text-tertiary)' }
}

export default function TimelinePage() {
  const [events, setEvents]         = useState<TimelineEvent[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [pending, setPending]       = useState('')
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function load(inv?: string) {
    setLoading(true)
    fetchAllTimeline(inv).then(setEvents).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function onSearch(v: string) {
    setPending(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(v || undefined), 400)
  }

  const types    = [...new Set(events.map(e => e.eventType))].sort()
  const filtered = typeFilter ? events.filter(e => e.eventType === typeFilter) : events

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h1 className="font-sans text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
            Timeline
          </h1>
          <p className="label mt-1">Last 100 events across all invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-2"
              size={14}
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text" placeholder="Filter by Invoice ID…"
              value={pending} onChange={e => onSearch(e.target.value)}
              className="input pl-8 pr-3 py-2 w-52"
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input px-2.5 py-2">
            <option value="">All event types</option>
            {types.map(t => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
          </select>
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorMsg message={error} /> : (
        <div className="card flex-1 overflow-hidden flex flex-col min-h-0">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No events
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-3 space-y-0">
                {filtered.map((ev, idx) => {
                  const dotColor = EVENT_DOT_COLOR[ev.eventType] || 'var(--text-muted)'
                  const actor = actorBadgeStyle(ev)
                  return (
                    <div key={ev.ID} className="flex gap-3">
                      {/* Dot + connector */}
                      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 16 }}>
                        <div
                          style={{
                            width: 8, height: 8, borderRadius: 1,
                            background: dotColor, marginTop: 4, flexShrink: 0,
                          }}
                        />
                        {idx < filtered.length - 1 && (
                          <div className="flex-1" style={{ width: 1, background: 'var(--border-default)', marginTop: 2 }} />
                        )}
                      </div>
                      {/* Content */}
                      <div style={{ paddingBottom: 12 }}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className="badge"
                            style={{
                              background: 'var(--bg-active)',
                              color: 'var(--text-tertiary)',
                              border: '1px solid var(--border-default)',
                            }}
                          >
                            {TYPE_LABEL[ev.eventType] ?? ev.eventType}
                          </span>
                          <span
                            className="badge"
                            style={{ background: actor.bg, color: actor.color, border: `1px solid ${actor.bg}` }}
                          >
                            {actorDisplay(ev)}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, lineHeight: 1.5 }}>
                          {ev.summary}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {fmtDatetime(ev.eventAt)}
                          </span>
                          {ev.invoice_ID && (
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                              {ev.invoice_ID}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
