import { supabase } from './supabase'

export type Scope = 'global' | 'port' | 'country' | 'coastal_region' | 'trade_route' | 'liner' | 'service'

export type Insight = {
  id: number
  scope: Scope
  scope_key: string
  entity_label: string
  kpi_snapshot: Record<string, unknown>
  narrative: string
  sources: { title: string; url: string; published_date: string | null }[]
  model: string
  created_at: string
}

/** Most recent cached insight for this scope/key, or null if never generated. */
export async function getCachedInsight(scope: Scope, scopeKey: string): Promise<Insight | null> {
  const { data, error } = await supabase
    .from('ai_insights')
    .select('*')
    .eq('scope', scope)
    .eq('scope_key', scopeKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Insight | null
}

/**
 * Calls the generate-insight Edge Function: Tavily search + Claude synthesis,
 * grounded in the exact KPIs passed in. Costs a real API call each time — only
 * invoke on an explicit user action, never automatically on page load.
 */
export async function generateInsight(
  scope: Scope, scopeKey: string, entityLabel: string, kpis: Record<string, unknown>,
): Promise<Insight> {
  const { data, error } = await supabase.functions.invoke('generate-insight', {
    body: { scope, scope_key: scopeKey, entity_label: entityLabel, kpis },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as Insight
}
