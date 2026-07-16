import { useEffect, useState } from 'react'
import { fetchConfigs, updateConfig, fetchConfigChangeLogs } from '../api'
import type { AgentConfig, ConfigChangeLog } from '../types'
import { Loading, ErrorMsg, Badge, fmtDatetime } from '../ui'

const HIDDEN_KEYS = new Set([
  'active_adapter',
  'active_ai_provider',
  'field_swap_always_llm',
  'auto_escalate_enabled',
])

const SECTION_ORDER = [
  { label: 'Agent Behaviour', prefix: ['auto_correct_threshold', 'auto_approve_threshold'] },
  { label: 'Match Tolerance Rules', prefix: ['tol_', 'amount_threshold_critical'] },
  { label: 'Enabled Detectors', prefix: ['active_discrepancy_types'] },
]

function sectionFor(key: string): string {
  for (const s of SECTION_ORDER) {
    if (s.prefix.some(p => key.startsWith(p) || key === p)) return s.label
  }
  return 'Other'
}

export default function ConfigPage() {
  const [configs, setConfigs]   = useState<AgentConfig[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [editing, setEditing]   = useState<string | null>(null)
  const [draft, setDraft]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState<{ ok: boolean; key: string; text: string } | null>(null)
  const [changelog, setChangelog] = useState<ConfigChangeLog[]>([])

  function refreshChangelog() {
    fetchConfigChangeLogs().then(setChangelog).catch(() => {})
  }

  useEffect(() => {
    fetchConfigs().then(setConfigs).catch(e => setError(e.message)).finally(() => setLoading(false))
    refreshChangelog()
  }, [])

  if (loading) return <Loading />
  if (error)   return <ErrorMsg message={error} />

  async function save(cfg: AgentConfig) {
    setSaving(true); setSaveMsg(null)
    try {
      await updateConfig(cfg.ID, draft)
      setConfigs(prev => prev.map(c => c.ID === cfg.ID ? { ...c, configValue: draft } : c))
      setSaveMsg({ ok: true, key: cfg.ID, text: 'Saved' })
      setEditing(null)
      refreshChangelog()
    } catch(e: any) { setSaveMsg({ ok: false, key: cfg.ID, text: e.message }) }
    finally { setSaving(false) }
  }

  const visible = configs.filter(c => !HIDDEN_KEYS.has(c.configKey))
  const sections: Record<string, AgentConfig[]> = {}
  for (const cfg of visible) {
    const s = sectionFor(cfg.configKey)
    if (!sections[s]) sections[s] = []
    sections[s].push(cfg)
  }

  // Enabled detectors as chips
  const detectorConfig = configs.find(c => c.configKey === 'active_discrepancy_types')
  let enabledDetectors: string[] = []
  try { enabledDetectors = JSON.parse(detectorConfig?.configValue || '[]') } catch {}

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0">
        <h1 className="font-sans text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
          Configuration
        </h1>
        <p className="label mt-1">Confidence thresholds, match tolerance rules, and enabled detectors</p>
      </div>

      <div
        className="flex-shrink-0"
        style={{
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 2,
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        Changes take effect on the next invoice processed.
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">

        {/* Enabled Detectors — chips */}
        {enabledDetectors.length > 0 && (
          <div className="card" style={{ padding: '16px' }}>
            <p className="label mb-3">ENABLED DETECTORS</p>
            <div className="flex flex-wrap gap-1.5">
              {enabledDetectors.map((det: string) => (
                <span
                  key={det}
                  className="badge"
                  style={{
                    background: 'var(--bg-active)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-active)',
                  }}
                >
                  {det.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Config sections */}
        {Object.entries(sections)
          .filter(([s]) => s !== 'Enabled Detectors')
          .map(([section, cfgs]) => (
            <div key={section} className="card overflow-hidden">
              <div
                className="label px-4 py-3"
                style={{ borderBottom: '1px solid var(--border-default)' }}
              >
                {section}
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                    <th className="label text-left" style={{ padding: '10px 12px' }}>Key</th>
                    <th className="label text-left" style={{ padding: '10px 12px' }}>Value</th>
                    <th className="label text-left" style={{ padding: '10px 12px' }}>Description</th>
                    <th className="label text-left" style={{ padding: '10px 12px' }}>Updated</th>
                    <th style={{ padding: '10px 12px', width: 100 }} />
                  </tr>
                </thead>
                <tbody>
                  {cfgs.map(cfg => (
                    <tr
                      key={cfg.ID}
                      className="tr-hover"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <td style={{ padding: '8px 12px' }}>
                        <code style={{
                          fontSize: 11, fontFamily: 'var(--font-mono)',
                          color: 'var(--accent-link)',
                          background: 'var(--bg-elevated)',
                          padding: '2px 6px', borderRadius: 2,
                        }}>
                          {cfg.configKey}
                        </code>
                      </td>
                      <td style={{ padding: '8px 12px', minWidth: 120 }}>
                        {editing === cfg.ID ? (
                          <input
                            type="text" value={draft}
                            onChange={e => setDraft(e.target.value)}
                            className="input px-2 py-1 w-full"
                            style={{ fontSize: 12 }}
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') save(cfg); if (e.key === 'Escape') setEditing(null) }}
                          />
                        ) : (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {cfg.configValue}
                          </span>
                        )}
                        {saveMsg?.key === cfg.ID && (
                          <p style={{
                            fontSize: 10, marginTop: 2,
                            color: saveMsg.ok ? 'var(--status-low-text)' : 'var(--status-critical)',
                          }}>
                            {saveMsg.text}
                          </p>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 240 }}>
                        {cfg.description}
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {fmtDatetime(cfg.modifiedAt)}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {editing === cfg.ID ? (
                          <div className="flex gap-1.5">
                            <button onClick={() => save(cfg)} disabled={saving} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }}>
                              {saving ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditing(null)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditing(cfg.ID); setDraft(cfg.configValue); setSaveMsg(null) }}
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {/* Recent Changes */}
        {changelog.length > 0 && (
          <div className="card overflow-hidden">
            <div className="label px-4 py-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
              RECENT CHANGES
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-base)' }}>
                  <th className="label text-left" style={{ padding: '10px 12px' }}>Timestamp</th>
                  <th className="label text-left" style={{ padding: '10px 12px' }}>Key</th>
                  <th className="label text-left" style={{ padding: '10px 12px' }}>Old Value</th>
                  <th className="label text-left" style={{ padding: '10px 12px' }}>New Value</th>
                  <th className="label text-left" style={{ padding: '10px 12px' }}>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {changelog.map(entry => (
                  <tr key={entry.ID} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {fmtDatetime(entry.changedAt)}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <code style={{
                        fontSize: 11, fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-link)',
                        background: 'var(--bg-elevated)',
                        padding: '2px 6px', borderRadius: 2,
                      }}>
                        {entry.configKey}
                      </code>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--status-critical)' }}>
                      {entry.oldValue ?? '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--status-low-text)' }}>
                      {entry.newValue ?? '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                      {entry.changedBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
