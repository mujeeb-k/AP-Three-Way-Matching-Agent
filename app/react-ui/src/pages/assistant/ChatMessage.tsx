import type { AssistantChatMessage } from '../../types'
import { RichContent } from './RichContent'
import { SuggestedBubbles } from './SuggestedBubbles'

// Reuse the AssistantIcon from App.tsx (flat-top diamond)
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

export function ChatMessage({ message, onSend, readOnly }: {
  message: AssistantChatMessage
  onSend: (prompt: string) => void
  readOnly?: boolean
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" style={{ padding: '4px 0' }}>
        <div
          style={{
            maxWidth: '70%',
            padding: '10px 14px',
            borderRadius: 2,
            background: 'var(--bg-active)',
            border: '1px solid var(--border-active)',
            color: 'var(--text-primary)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex gap-2.5" style={{ padding: '4px 0' }}>
      <AssistantAvatar />
      <div style={{ maxWidth: '80%', minWidth: 0 }}>
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
          {message.content}
        </div>

        {/* Rich content */}
        {message.richContent && (
          <RichContent block={message.richContent} onSend={onSend} readOnly={readOnly} />
        )}

        {/* Suggested bubbles (hidden in read-only mode) */}
        {!readOnly && message.suggestedBubbles && message.suggestedBubbles.length > 0 && (
          <SuggestedBubbles bubbles={message.suggestedBubbles} onSend={onSend} />
        )}
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2.5" style={{ padding: '4px 0' }}>
      <AssistantAvatar />
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>AP Copilot</p>
        <div
          className="flex items-center gap-1"
          style={{
            padding: '10px 14px',
            borderRadius: 2,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
          }}
        >
          <div className="assistant-dot" style={{ width: 5, height: 5, borderRadius: 1, background: 'var(--text-muted)' }} />
          <div className="assistant-dot" style={{ width: 5, height: 5, borderRadius: 1, background: 'var(--text-muted)' }} />
          <div className="assistant-dot" style={{ width: 5, height: 5, borderRadius: 1, background: 'var(--text-muted)' }} />
        </div>
      </div>
    </div>
  )
}
