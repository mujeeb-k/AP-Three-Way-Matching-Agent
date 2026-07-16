import { useEffect, useState } from 'react'
import { fetchStats, fetchWorkItems } from '../../api'
import type { SuggestedBubble } from '../../types'
import { SuggestedBubbles } from './SuggestedBubbles'

// AssistantAvatar (same as ChatMessage — keeps module self-contained)
function AssistantAvatar() {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: 28, height: 28, borderRadius: 2,
        background: 'var(--bg-active)',
        border: '1px solid var(--border-active)',
        color: 'var(--text-muted)',
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M7 2h10l5 10-10 10L2 12 7 2z" />
      </svg>
    </div>
  )
}

export function WelcomeMessage({ onSend }: { onSend: (prompt: string) => void }) {
  const [stats, setStats] = useState<{
    pending: number; critical: number; high: number
    autoCorrections: number; escalated: number; flaggedReview: number
  } | null>(null)

  useEffect(() => {
    fetchStats().then(s => setStats({
      pending: s.pending,
      critical: s.critical,
      high: s.high,
      autoCorrections: s.autoCorrections,
      escalated: s.escalated,
      flaggedReview: (s as any).flaggedReview ?? 0,
    })).catch(() => {})
  }, [])

  // Count flagged review from work items as fallback
  useEffect(() => {
    if (stats && stats.flaggedReview === 0) {
      fetchWorkItems().then(items => {
        const flagged = items.filter(i => i.agentDecision === 'FLAGGED_REVIEW').length
        setStats(prev => prev ? { ...prev, flaggedReview: flagged } : prev)
      }).catch(() => {})
    }
  }, [stats?.flaggedReview])

  const bubbles: SuggestedBubble[] = []
  if (stats) {
    if (stats.critical > 0 || stats.escalated > 0) {
      bubbles.push({
        label: `${stats.critical + stats.escalated} critical/escalated items`,
        prompt: 'Show me the critical and escalated invoices',
      })
    }
    if (stats.autoCorrections > 0) {
      bubbles.push({
        label: `${stats.autoCorrections} auto-corrections ready`,
        prompt: 'Show me invoices with auto-corrections ready for approval',
      })
    }
    if (stats.flaggedReview > 0) {
      bubbles.push({
        label: `${stats.flaggedReview} flagged for review`,
        prompt: 'Show me flagged invoices that need manual review',
      })
    }
    bubbles.push({
      label: 'Show full queue',
      prompt: 'Show me the full work queue',
    })
  }

  return (
    <div className="flex gap-2.5" style={{ padding: '4px 0' }}>
      <AssistantAvatar />
      <div style={{ maxWidth: '80%' }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>AP Copilot</p>
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 2,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {stats
            ? `${stats.pending} invoices are pending review.`
            : 'Loading queue status...'
          }
        </div>
        {bubbles.length > 0 && (
          <SuggestedBubbles bubbles={bubbles} onSend={onSend} />
        )}
      </div>
    </div>
  )
}
