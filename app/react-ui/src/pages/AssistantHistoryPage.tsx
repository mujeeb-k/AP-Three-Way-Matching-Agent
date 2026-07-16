import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, MessageSquare, Zap, Search } from 'lucide-react'
import { fetchConversations, fetchConversationDetail } from '../api'
import type { AssistantConversation, AssistantConversationDetail, AssistantConversationAction } from '../types'
import { ChatMessage } from './assistant/ChatMessage'
import { Loading, ErrorMsg, Badge, displayIdentity } from '../ui'

// Action type → display label
const ACTION_LABELS: Record<string, string> = {
  accept_correction: 'Accept',
  escalate: 'Escalate',
  reject_invoice: 'Reject',
  assign_to_me: 'Assign',
}

const ACTION_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  accept_correction: { bg: 'var(--status-low-bg)', color: 'var(--status-low-text)', border: 'var(--status-low-border)' },
  escalate:          { bg: 'var(--status-high-bg)', color: 'var(--status-high)', border: 'var(--status-high-bg)' },
  reject_invoice:    { bg: 'var(--status-critical-bg)', color: 'var(--status-critical)', border: 'var(--status-critical-bg)' },
  assign_to_me:      { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' },
}

function fmtTime(s: string | null) {
  if (!s) return ''
  return new Date(s).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(start: string, end: string | null) {
  if (!end) return 'Active'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// List View
function ConversationList({ conversations, onSelect }: {
  conversations: AssistantConversation[]
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')

  // Collect all unique action types for filter dropdown
  const allActions = [...new Set(conversations.flatMap(c => c.actionTypes))].sort()

  const filtered = conversations.filter(c => {
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const matchesInvoice = c.linkedInvoiceIds.some(id => id.toLowerCase().includes(q))
      const matchesTitle = c.title?.toLowerCase().includes(q)
      const matchesUser = c.userId.toLowerCase().includes(q)
      if (!matchesInvoice && !matchesTitle && !matchesUser) return false
    }
    if (actionFilter !== 'all') {
      if (!c.actionTypes.includes(actionFilter)) return false
    }
    return true
  })

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
        <div className="flex items-center flex-1" style={{ position: 'relative', maxWidth: 320 }}>
          <Search
            size={12}
            style={{
              position: 'absolute', left: 10,
              color: 'var(--text-muted)', pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by invoice, title, or user..."
            className="input w-full"
            style={{ padding: '8px 10px 8px 28px', fontSize: 11 }}
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="input"
          style={{ padding: '8px 10px', fontSize: 11, minWidth: 140 }}
        >
          <option value="all">All Actions</option>
          {allActions.map(a => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
          ))}
        </select>
      </div>

      {/* Result count */}
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
        {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Card list */}
      <div className="space-y-1">
        {filtered.map(conv => (
          <div
            key={conv.ID}
            className="card cursor-pointer tr-hover"
            style={{ padding: '12px 14px' }}
            onClick={() => onSelect(conv.ID)}
          >
            <div className="flex items-start gap-3">
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Title / first message */}
                <p
                  className="font-sans"
                  style={{
                    fontSize: 12, fontWeight: 500,
                    color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {conv.title || 'Untitled Conversation'}
                </p>

                {/* Time + user */}
                <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmtTime(conv.startedAt)}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {fmtDuration(conv.startedAt, conv.endedAt)}
                  </span>
                  <span
                    style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                      padding: '1px 6px', borderRadius: 2,
                      background: 'var(--bg-active)', color: 'var(--text-tertiary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    {displayIdentity(conv.userId)}
                  </span>
                </div>

                {/* Linked invoices */}
                {conv.linkedInvoiceIds.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap" style={{ marginTop: 6 }}>
                    {conv.linkedInvoiceIds.slice(0, 5).map(id => (
                      <span
                        key={id}
                        style={{
                          fontSize: 9, fontFamily: 'var(--font-mono)',
                          padding: '1px 5px', borderRadius: 2,
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--accent-link)',
                        }}
                      >
                        {id}
                      </span>
                    ))}
                    {conv.linkedInvoiceIds.length > 5 && (
                      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                        +{conv.linkedInvoiceIds.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right side: counts + action badges */}
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    <MessageSquare size={10} /> {conv.messageCount}
                  </span>
                  {conv.actionCount > 0 && (
                    <span className="flex items-center gap-1" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      <Zap size={10} /> {conv.actionCount}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {conv.actionTypes.map(a => (
                    <Badge key={a} style={ACTION_STYLES[a] ?? { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' }}>
                      {ACTION_LABELS[a] ?? a}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: 40 }}>
            No conversations match the current filters.
          </p>
        )}
      </div>
    </>
  )
}

// Transcript View
function ConversationTranscript({ detail, onBack }: {
  detail: AssistantConversationDetail
  onBack: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [detail.ID])

  const noop = () => {} // read-only: clicks do nothing

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0" style={{ paddingBottom: 12 }}>
        <button
          onClick={onBack}
          className="btn btn-ghost flex items-center gap-1.5"
          style={{ padding: '4px 8px', fontSize: 11, marginBottom: 8 }}
        >
          <ArrowLeft size={12} /> Back to list
        </button>

        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-sans font-medium" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            {detail.title || 'Untitled Conversation'}
          </h2>
          <span
            className="badge"
            style={{
              background: detail.status === 'ACTIVE' ? 'var(--status-low-bg)' : 'var(--bg-active)',
              color: detail.status === 'ACTIVE' ? 'var(--status-low-text)' : 'var(--text-tertiary)',
              border: `1px solid ${detail.status === 'ACTIVE' ? 'var(--status-low-border)' : 'var(--border-default)'}`,
            }}
          >
            {detail.status}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {fmtTime(detail.startedAt)}
            {detail.endedAt ? ` — ${fmtTime(detail.endedAt)}` : ''}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {detail.messages.length} messages
          </span>
          <span
            style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
              padding: '1px 6px', borderRadius: 2,
              background: 'var(--bg-active)', color: 'var(--text-tertiary)',
              border: '1px solid var(--border-default)',
            }}
          >
            {displayIdentity(detail.userId)}
          </span>
        </div>
      </div>

      {/* Transcript + Actions sidebar */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0" style={{ paddingBottom: 16 }}>
          <div className="space-y-2" style={{ maxWidth: 680 }}>
            {detail.messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} onSend={noop} readOnly />
            ))}
          </div>
        </div>

        {/* Actions sidebar (only if actions exist) */}
        {detail.actions.length > 0 && (
          <div
            className="flex-shrink-0 overflow-y-auto"
            style={{
              width: 220,
              borderLeft: '1px solid var(--border-default)',
              paddingLeft: 16,
            }}
          >
            <p className="label" style={{ marginBottom: 8 }}>
              ACTIONS TAKEN ({detail.actions.length})
            </p>
            <div className="space-y-2">
              {detail.actions.map((action: AssistantConversationAction) => (
                <div
                  key={action.ID}
                  className="card"
                  style={{ padding: '8px 10px' }}
                >
                  <div className="flex items-center gap-1.5">
                    <Badge style={ACTION_STYLES[action.action] ?? { bg: 'var(--bg-active)', color: 'var(--text-tertiary)', border: 'var(--border-default)' }}>
                      {ACTION_LABELS[action.action] ?? action.action}
                    </Badge>
                  </div>
                  {action.invoiceId && (
                    <p style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent-link)', marginTop: 4 }}>
                      {action.invoiceId}
                    </p>
                  )}
                  {action.reason && (
                    <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                      {action.reason}
                    </p>
                  )}
                  <p style={{ fontSize: 8, color: 'var(--text-dim)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                    {fmtTime(action.executedAt)} · {displayIdentity(action.executedBy)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Main Page
export default function AssistantHistoryPage() {
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AssistantConversationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Load conversation list
  useEffect(() => {
    fetchConversations()
      .then(setConversations)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Load conversation detail when selected
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    setDetailLoading(true)
    fetchConversationDetail(selectedId)
      .then(setDetail)
      .catch(e => setError(e.message))
      .finally(() => setDetailLoading(false))
  }, [selectedId])

  if (loading) return <Loading text="Loading conversations..." />
  if (error && !conversations.length) return <ErrorMsg message={error} />

  // Transcript view
  if (selectedId) {
    if (detailLoading || !detail) return <Loading text="Loading conversation..." />
    return <ConversationTranscript detail={detail} onBack={() => setSelectedId(null)} />
  }

  // List view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0" style={{ paddingBottom: 12 }}>
        <h1 className="font-sans font-medium" style={{ fontSize: 18, color: 'var(--text-primary)' }}>
          Conversation History
        </h1>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Past AP Copilot sessions and recorded actions
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <ConversationList
          conversations={conversations}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  )
}
