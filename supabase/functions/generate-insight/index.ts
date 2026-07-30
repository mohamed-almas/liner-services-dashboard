// generate-insight — executive AI narrative grounded in live dashboard KPIs
// plus recent real-world news (Tavily), synthesized by Claude (Anthropic).
//
// Called from the dashboard with the anon key (verify_jwt passes because the
// Supabase anon key is itself a signed JWT — no extra auth needed for this
// public read-only dashboard). Writes to ai_insights using the service-role
// key, which Supabase injects automatically into every Edge Function — the
// client itself never gets write access to that table.
//
// Required secrets (set via Supabase Dashboard -> Edge Functions -> Secrets,
// never via this code): TAVILY_API_KEY, ANTHROPIC_API_KEY.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  scope: string;          // 'global' | 'port' | 'country' | 'coastal_region' | 'trade_route' | 'liner' | 'service'
  scope_key: string;      // e.g. port_code; 'global' for the overview page
  entity_label: string;   // display name used to build the news search query
  kpis: Record<string, unknown>;
};

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

const SCOPE_QUERY_HINT: Record<string, string> = {
  global: "global container shipping liner market",
  port: "port congestion capacity expansion shipping",
  country: "container shipping trade port",
  coastal_region: "shipping route maritime trade",
  trade_route: "trade lane container shipping capacity",
  liner: "container line shipping alliance capacity",
  service: "container shipping service route",
};

async function tavilySearch(entityLabel: string, scope: string): Promise<TavilyResult[]> {
  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) return [];

  const hint = SCOPE_QUERY_HINT[scope] ?? "container shipping";
  const query = scope === "global" ? hint : `${entityLabel} ${hint}`;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      topic: "news",
      days: 30,
      max_results: 6,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    console.error("Tavily error", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.results ?? []) as TavilyResult[];
}

async function synthesize(
  scope: string,
  entityLabel: string,
  kpis: Record<string, unknown>,
  sources: TavilyResult[],
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const sourceBlock = sources.length
    ? sources
        .map((s, i) => `[${i + 1}] ${s.title} (${s.published_date ?? "undated"})\n${s.content.slice(0, 500)}\nURL: ${s.url}`)
        .join("\n\n")
    : "(no recent news results were found for this entity)";

  const prompt = `You are a maritime shipping analyst briefing an executive. You will be given:
1. Live KPI data for "${entityLabel}" (scope: ${scope}) from a liner-services intelligence dashboard.
2. Recent news search results (last 30 days) that may or may not be relevant.

Write a 3-5 sentence executive narrative that:
- States the clear headline takeaway from the KPI data FIRST — use only the numbers given, never invent or round dramatically.
- Then, ONLY if a news item is genuinely relevant to the specific entity or the trend shown, ties it in with an inline citation like [1]. If nothing in the news results is actually relevant, do not force a connection — just skip that part.
- Plain prose, no bullet points, no headers, no markdown.
- Do not editorialize about topics unrelated to shipping/trade/ports even if they appear in results.

KPI DATA (JSON):
${JSON.stringify(kpis, null, 2)}

NEWS RESULTS:
${sourceBlock}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text as string | undefined;
  if (!text) throw new Error("Anthropic response had no text content");
  return text.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const body = (await req.json()) as Body;
    if (!body.scope || !body.scope_key || !body.entity_label || !body.kpis) {
      return new Response(JSON.stringify({ error: "scope, scope_key, entity_label and kpis are required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sources = await tavilySearch(body.entity_label, body.scope);
    const narrative = await synthesize(body.scope, body.entity_label, body.kpis, sources);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sourcesForStorage = sources.map((s) => ({
      title: s.title,
      url: s.url,
      published_date: s.published_date ?? null,
    }));

    const { data: inserted, error } = await supabase
      .from("ai_insights")
      .insert({
        scope: body.scope,
        scope_key: body.scope_key,
        entity_label: body.entity_label,
        kpi_snapshot: body.kpis,
        narrative,
        sources: sourcesForStorage,
        model: "claude-sonnet-5",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify(inserted), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-insight failed:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
