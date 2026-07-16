import type {
  ODataList, WorkItem, InvoiceLine, TimelineEvent, AgentConfig, ConfigChangeLog, ActionResult,
  AssistantChatResponse, AssistantConversation, AssistantConversationDetail,
  ActivityTrendPoint, DashboardStats,
} from './types'

// All requests go through Vite proxy → CAP at localhost:4004
// Local demo credentials match the mocked development profile in .cdsrc.json.
const AUTH = 'Basic ' + btoa('demo:demo')

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: AUTH } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.json()
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// Work Queue
export async function fetchWorkItems(): Promise<WorkItem[]> {
  const data = await get<ODataList<WorkItem>>(
    '/workqueue/WorkItems?$count=true&$orderby=riskOrder asc'
  )
  return data.value
}

export async function fetchWorkItem(id: string): Promise<WorkItem> {
  const data = await get<ODataList<WorkItem>>(
    `/workqueue/WorkItems?$filter=ID eq '${id}'`
  )
  if (!data.value[0]) throw new Error('Work item not found')
  return data.value[0]
}

// Invoice Lines
export async function fetchInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const data = await get<ODataList<InvoiceLine>>(
    `/workqueue/InvoiceLines?$filter=invoice_ID eq '${invoiceId}'&$orderby=lineNumber asc`
  )
  return data.value
}

// Timeline
export async function fetchTimeline(invoiceId: string): Promise<TimelineEvent[]> {
  const data = await get<ODataList<TimelineEvent>>(
    `/workqueue/InvoiceTimeline?$orderby=eventAt asc`
  )
  // Client-side filter: InvoiceTimeline has ORDER BY in its CDS definition, which
  // makes CAP reject $filter on the view via OData. Fetch all and filter in JS.
  return data.value.filter(e => e.invoice_ID === invoiceId)
}

// All timeline (client-side filtered — CAP view doesn't support $filter)
export async function fetchAllTimeline(invoiceFilter?: string): Promise<TimelineEvent[]> {
  const data = await get<ODataList<TimelineEvent>>(
    '/workqueue/InvoiceTimeline?$orderby=eventAt desc&$top=200'
  )
  // Client-side filter: InvoiceTimeline has ORDER BY in its CDS definition, which
  // makes CAP reject $filter on the view via OData. Fetch all and filter in JS.
  const filter = invoiceFilter?.trim()
  if (!filter) return data.value.slice(0, 100)
  return data.value.filter(e => e.invoice_ID === filter).slice(0, 100)
}

// Agent Config
export async function fetchConfigs(): Promise<AgentConfig[]> {
  const data = await get<ODataList<AgentConfig>>(
    '/agent/AgentConfigs?$orderby=configKey asc'
  )
  return data.value
}

export async function updateConfig(id: string, configValue: string): Promise<void> {
  const res = await fetch(`/agent/AgentConfigs(${id})`, {
    method: 'PATCH',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ configValue }),
  })
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`)
}

export async function fetchConfigChangeLogs(): Promise<ConfigChangeLog[]> {
  const data = await get<ODataList<ConfigChangeLog>>(
    '/agent/AgentConfigChangeLogs?$orderby=changedAt desc&$top=10'
  )
  return data.value
}

// Stats (computed from live CAP data)
export async function fetchStats(): Promise<DashboardStats> {
  const [allDisc, allInvoices] = await Promise.all([
    get<ODataList<{ ID: string; reviewStatus: string; riskTier: string; agentDecision: string }>>(
      '/agent/Discrepancies?$select=ID,reviewStatus,riskTier,agentDecision'
    ),
    get<ODataList<{ ID: string }> & { '@odata.count'?: number }>(
      '/agent/InvoicePayloads?$select=ID&$count=true'
    ),
  ])
  const discs = allDisc.value
  return {
    totalInvoices: allInvoices['@odata.count'] ?? allInvoices.value.length,
    pending:        discs.filter(d => d.reviewStatus === 'PENDING').length,
    inReview:       discs.filter(d => d.reviewStatus === 'IN_REVIEW').length,
    resolved:       discs.filter(d => d.reviewStatus === 'RESOLVED').length,
    critical:       discs.filter(d => d.riskTier === 'CRITICAL').length,
    high:           discs.filter(d => d.riskTier === 'HIGH').length,
    medium:         discs.filter(d => d.riskTier === 'MEDIUM').length,
    low:            discs.filter(d => d.riskTier === 'LOW').length,
    autoCorrections:discs.filter(d => d.agentDecision === 'AUTO_CORRECTED').length,
    flaggedReview:  discs.filter(d => d.agentDecision === 'FLAGGED_REVIEW').length,
    escalated:      discs.filter(d => d.agentDecision === 'ESCALATED').length,
  }
}

// Activity trend: invoices processed per day (last 7 days)
// Uses AGENT_ANALYZED events as proxy for "processed" — one per invoice run.
// Fetches all events client-side (CAP view with order-by doesn't support $filter).
export async function fetchActivityTrend(): Promise<ActivityTrendPoint[]> {
  const data = await get<ODataList<{ ID: string; eventType: string; eventAt: string }>>(
    `/workqueue/InvoiceTimeline?$select=ID,eventType,eventAt&$top=500`
  )
  const since = Date.now() - 7 * 24 * 3_600_000
  // Pre-fill last 7 days with 0
  const counts: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3_600_000)
    counts[d.toISOString().slice(0, 10)] = 0
  }
  for (const ev of data.value) {
    // Client-side filter: InvoiceTimeline's ORDER BY in CDS makes CAP reject OData
    // $filter on this view, so eventType and date filtering is done here instead.
    if (ev.eventType !== 'AGENT_ANALYZED') continue
    if (new Date(ev.eventAt).getTime() < since) continue
    const day = ev.eventAt.slice(0, 10)
    if (day in counts) counts[day] = (counts[day] ?? 0) + 1
  }
  return Object.entries(counts).map(([date, count]) => ({ date, count }))
}

export async function reprocessInvoice(invoiceId: string): Promise<ActionResult> {
  return post('/agent/reprocessInvoice', { invoiceId })
}

// All discrepancies for an invoice (client-side filtered)
// AllDiscrepancies supports $filter, unlike InvoiceTimeline.
export async function fetchDiscrepanciesForInvoice(invoiceId: string): Promise<WorkItem[]> {
  const data = await get<ODataList<WorkItem>>(
    `/workqueue/AllDiscrepancies?$filter=invoice_ID eq '${invoiceId}'&$orderby=riskOrder asc`
  )
  return data.value
}

// Clerk Actions
export async function assignToMe(discrepancyId: string): Promise<ActionResult> {
  return post('/workqueue/assignToMe', { discrepancyId })
}

export async function acceptCorrection(discrepancyId: string, notes: string): Promise<ActionResult> {
  return post('/workqueue/acceptCorrection', { discrepancyId, notes })
}

export async function overrideCorrection(
  discrepancyId: string, correctedLines: string, notes: string
): Promise<ActionResult> {
  return post('/workqueue/overrideCorrection', { discrepancyId, correctedLines, notes })
}

export async function escalate(discrepancyId: string, reason: string): Promise<ActionResult> {
  return post('/workqueue/escalate', { discrepancyId, reason })
}

export async function rejectInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  return post('/workqueue/rejectInvoice', { invoiceId, reason })
}

// Assistant Chat
export interface AssistantHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  richContent?: string
  suggestedBubbles?: string
}

export async function sendAssistantMessage(
  message: string,
  conversationHistory: AssistantHistoryMessage[],
  conversationId?: string,
): Promise<AssistantChatResponse> {
  return post('/assistant/chat', { message, conversationHistory, conversationId })
}

// Assistant Conversations
export async function startConversation(): Promise<{ conversationId: string }> {
  return post('/assistant/startConversation', {})
}

export async function closeConversation(conversationId: string): Promise<{ success: boolean }> {
  return post('/assistant/closeConversation', { conversationId })
}

export async function fetchConversations(): Promise<AssistantConversation[]> {
  const data = await get<ODataList<any>>(
    '/assistant/Conversations?$expand=messages($select=ID),actions($select=ID,invoiceId,action)&$orderby=startedAt desc&$top=50'
  )
  return data.value.map((c: any) => ({
    ID: c.ID,
    userId: c.userId,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    status: c.status,
    title: c.title,
    messageCount: c.messages?.length ?? 0,
    actionCount: c.actions?.length ?? 0,
    linkedInvoiceIds: [...new Set((c.actions ?? []).map((a: any) => a.invoiceId).filter(Boolean))] as string[],
    actionTypes: [...new Set((c.actions ?? []).map((a: any) => a.action).filter(Boolean))] as string[],
  }))
}

export async function fetchConversationDetail(conversationId: string): Promise<AssistantConversationDetail> {
  const data = await get<any>(
    `/assistant/Conversations(${conversationId})?$expand=messages($orderby=timestamp asc),actions($orderby=executedAt asc)`
  )
  return {
    ID: data.ID,
    userId: data.userId,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    status: data.status,
    title: data.title,
    messages: (data.messages ?? []).map((m: any) => ({
      id: m.ID,
      role: m.role,
      content: m.content ?? '',
      richContent: m.richContent ? (() => { try { return JSON.parse(m.richContent) } catch { return undefined } })() : undefined,
      suggestedBubbles: m.suggestedBubbles ? (() => { try { return JSON.parse(m.suggestedBubbles) } catch { return undefined } })() : undefined,
      timestamp: m.timestamp,
    })),
    actions: data.actions ?? [],
  }
}
