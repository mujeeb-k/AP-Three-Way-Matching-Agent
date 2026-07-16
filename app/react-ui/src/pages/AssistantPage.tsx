import { useState, useRef, useEffect } from 'react'
import { Send, Plus } from 'lucide-react'
import { sendAssistantMessage, startConversation, closeConversation } from '../api'
import type { AssistantChatMessage, RichContentBlock, SuggestedBubble } from '../types'
import type { AssistantHistoryMessage } from '../api'
import { ChatMessage, TypingIndicator } from './assistant/ChatMessage'
import { WelcomeMessage } from './assistant/WelcomeMessage'

export default function AssistantPage() {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')

    // Add user message
    const userMsg: AssistantChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      // Start a conversation on first message if none exists
      let activeConvId = conversationId
      if (!activeConvId) {
        try {
          const { conversationId: newId } = await startConversation()
          activeConvId = newId
          setConversationId(newId)
        } catch {
          // Fallback: proceed without persistence
        }
      }

      // Build conversation history (only used when no conversationId)
      const history: AssistantHistoryMessage[] = activeConvId ? [] : messages.map(m => ({
        role: m.role,
        content: m.content,
      }))

      const response = await sendAssistantMessage(trimmed, history, activeConvId ?? undefined)

      // Track the conversationId from backend response
      if (response.conversationId && !activeConvId) {
        setConversationId(response.conversationId)
      }

      // Parse rich content and bubbles
      let richContent: RichContentBlock | undefined
      if (response.richContent) {
        try { richContent = JSON.parse(response.richContent) } catch { /* ignore parse errors */ }
      }

      let suggestedBubbles: SuggestedBubble[] | undefined
      if (response.suggestedBubbles) {
        try { suggestedBubbles = JSON.parse(response.suggestedBubbles) } catch { /* ignore */ }
      }

      const assistantMsg: AssistantChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.response,
        richContent,
        suggestedBubbles,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errorResponse: AssistantChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `I encountered an error: ${errMsg}`,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorResponse])
    } finally {
      setLoading(false)
    }
  }

  async function handleNewConversation() {
    // Close current conversation if active
    if (conversationId) {
      try { await closeConversation(conversationId) } catch { /* ignore */ }
    }
    setMessages([])
    setConversationId(null)
    setInput('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between" style={{ paddingBottom: 12 }}>
        <div>
          <h1 className="font-sans font-medium" style={{ fontSize: 18, color: 'var(--text-primary)' }}>
            AP Copilot
          </h1>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Invoice review assistant
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleNewConversation}
            className="btn btn-ghost flex items-center gap-1.5"
            style={{ padding: '5px 10px', fontSize: 11 }}
          >
            <Plus size={12} />
            New Conversation
          </button>
        )}
      </div>

      {/* Message area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0"
        style={{ paddingBottom: 8 }}
      >
        <div className="space-y-2" style={{ maxWidth: 680 }}>
          {/* Welcome message (only when no conversation yet) */}
          {messages.length === 0 && !loading && (
            <WelcomeMessage onSend={sendMessage} />
          )}

          {/* Messages */}
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} onSend={sendMessage} />
          ))}

          {/* Typing indicator */}
          {loading && <TypingIndicator />}
        </div>
      </div>

      {/* Input bar */}
      <div
        className="flex-shrink-0 flex items-center gap-2"
        style={{
          paddingTop: 12,
          borderTop: '1px solid var(--border-default)',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask AP Copilot about invoices, actions, or the queue..."
          disabled={loading}
          className="input flex-1"
          style={{
            padding: '10px 14px',
            fontSize: 12,
            background: 'var(--bg-elevated)',
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 36, height: 36, borderRadius: 2,
            background: 'var(--bg-active)',
            border: '1px solid var(--border-active)',
            color: input.trim() && !loading ? 'var(--text-secondary)' : 'var(--text-dim)',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
