import { useEffect, useState } from 'react'
import { Card } from './ui'
import { getCachedInsight, generateInsight, type Scope, type Insight } from '../lib/insights'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Executive Insight panel — shown on every page. Generation is manual
 * (button click), never automatic on load: each click is a real Tavily +
 * Claude API call, so firing it on every page view would bill per visitor.
 * The last generated insight is cached in Supabase and reused until the user
 * asks for a fresh one.
 */
export default function ExecutiveInsight({
  scope, scopeKey, entityLabel, kpis,
}: {
  scope: Scope
  scopeKey: string
  entityLabel: string
  kpis: Record<string, unknown>
}) {
  const [insight, setInsight] = useState<Insight | null | undefined>(undefined) // undefined = loading cache
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setInsight(undefined)
    setError('')
    getCachedInsight(scope, scopeKey)
      .then(res => { if (alive) setInsight(res) })
      .catch(e => { if (alive) { setError(e.message); setInsight(null) } })
    return () => { alive = false }
  }, [scope, scopeKey])

  async function handleGenerate() {
    setGenerating(true); setError('')
    try {
      const res = await generateInsight(scope, scopeKey, entityLabel, kpis)
      setInsight(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card
      title="Executive Insight"
      subtitle={insight ? `Generated ${timeAgo(insight.created_at)} · grounded in current KPIs + recent news` : 'AI-generated, on demand'}
      actions={
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs px-3 py-1.5 rounded border font-medium transition-colors disabled:opacity-50"
          style={{ borderColor: 'var(--accent)', color: generating ? 'var(--muted)' : 'var(--accent)' }}
        >
          {generating ? 'Generating…' : insight ? 'Regenerate' : 'Generate insight'}
        </button>
      }
    >
      {insight === undefined ? (
        <div className="h-5 w-2/3 rounded animate-pulse" style={{ background: 'var(--panel-alt)' }} />
      ) : generating ? (
        <div className="space-y-2">
          <div className="h-3 rounded animate-pulse" style={{ background: 'var(--panel-alt)' }} />
          <div className="h-3 w-5/6 rounded animate-pulse" style={{ background: 'var(--panel-alt)' }} />
          <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: 'var(--panel-alt)' }} />
        </div>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : insight ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{insight.narrative}</p>
          {insight.sources.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
              {insight.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                   className="text-[10px] hover:underline" style={{ color: 'var(--dim)' }}>
                  [{i + 1}] {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--dim)' }}>
          No insight generated yet for this view. Click "Generate insight" for an AI-written
          briefing that combines these numbers with recent shipping news.
        </p>
      )}
    </Card>
  )
}
