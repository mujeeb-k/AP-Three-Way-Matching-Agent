import type { SuggestedBubble } from '../../types'

export function SuggestedBubbles({ bubbles, onSend }: {
  bubbles: SuggestedBubble[]
  onSend: (prompt: string) => void
}) {
  if (!bubbles || bubbles.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 8 }}>
      {bubbles.map((b, i) => (
        <button
          key={i}
          style={{
            padding: '6px 12px',
            borderRadius: 2,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
          onClick={() => onSend(b.prompt)}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--border-active)'
            e.currentTarget.style.background = 'var(--bg-active)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border-default)'
            e.currentTarget.style.background = 'var(--bg-elevated)'
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  )
}
