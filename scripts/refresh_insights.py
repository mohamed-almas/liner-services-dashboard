"""
Market Intelligence refresh — pre-warms the ai_insights cache for the
highest-traffic entities so a visitor usually finds a recent insight already
generated rather than an empty state.

This does NOT replace on-demand generation: any port/country/liner/service a
user actually opens can still be generated live via the "Generate insight"
button in the dashboard. Refreshing all ~807 ports / 173 countries / 225
liners on a schedule would mean hundreds of billed Tavily + Anthropic calls
for entities almost nobody views, so this script only covers a bounded,
curated set: global + the top N ports/countries/liners by activity.

Calls the generate-insight Edge Function over HTTPS with the Supabase anon
key as the bearer token — the same trust level as the browser client, since
the anon key is already public in the deployed dashboard bundle. The Edge
Function's own service-role key (a separate secret, never used here) is what
actually authorizes the write to ai_insights.
"""
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("refresh_insights")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")  # e.g. https://<ref>.supabase.co/rest/v1
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
FUNCTIONS_URL = SUPABASE_URL.replace("/rest/v1", "/functions/v1")

TOP_N = int(os.environ.get("INSIGHTS_TOP_N", "8"))
REQUEST_TIMEOUT = 60  # each call does a Tavily search + a Claude generation

HEADERS_REST = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
}


def rest_get(path: str, params: dict) -> list[dict]:
    r = requests.get(f"{SUPABASE_URL}/{path}", headers=HEADERS_REST, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def generate(scope: str, scope_key: str, entity_label: str, kpis: dict) -> None:
    body = {"scope": scope, "scope_key": scope_key, "entity_label": entity_label, "kpis": kpis}
    r = requests.post(
        f"{FUNCTIONS_URL}/generate-insight",
        headers={**HEADERS_REST, "Content-Type": "application/json"},
        json=body,
        timeout=REQUEST_TIMEOUT,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code}: {r.text[:300]}")


def refresh(scope: str, scope_key: str, entity_label: str, kpis: dict, errors: list[str]) -> None:
    try:
        generate(scope, scope_key, entity_label, kpis)
        log.info("  ok    %-14s %s", scope, entity_label)
    except Exception as e:
        log.error("  FAILED %-14s %s: %s", scope, entity_label, e)
        errors.append(f"{scope}:{scope_key}: {e}")
    time.sleep(1)  # be polite to Tavily/Anthropic rate limits


def main() -> None:
    errors: list[str] = []

    # --- Global (always) ---
    log.info("Refreshing global market intelligence...")
    rows = rest_get("mv_global_current", {"select": "*"})
    if rows:
        refresh("global", "global", "the global liner shipping market", rows[0], errors)

    # --- Top ports ---
    log.info("Refreshing top %d ports...", TOP_N)
    ports = rest_get(
        "mv_port_current",
        {
            "select": "port_code,port_name,country_name,coastal_region,active_services,"
                      "lines_calling,service_capacity_teu,annual_capacity_teu,annual_calls_at_port",
            "is_chokepoint": "eq.false",
            "active_services": "gt.0",
            "order": "active_services.desc",
            "limit": str(TOP_N),
        },
    )
    for p in ports:
        refresh("port", p["port_code"], p.get("port_name") or p["port_code"], p, errors)

    # --- Top countries ---
    log.info("Refreshing top %d countries...", TOP_N)
    countries = rest_get(
        "mv_country_current",
        {
            "select": "country_code,country_name,active_services,port_count,"
                      "active_liners,service_capacity_teu,annual_capacity_teu",
            "active_services": "gt.0",
            "order": "active_services.desc",
            "limit": str(TOP_N),
        },
    )
    for c in countries:
        refresh("country", c["country_code"], c.get("country_name") or c["country_code"], c, errors)

    # --- Top liners ---
    log.info("Refreshing top %d liners...", TOP_N)
    liners = rest_get(
        "mv_liner_current",
        {
            "select": "company_code,company_name,active_services,active_versions,"
                      "service_capacity_teu,annual_capacity_teu,vsa_capacity_teu",
            "order": "vsa_capacity_teu.desc.nullslast",
            "limit": str(TOP_N),
        },
    )
    for l in liners:
        refresh("liner", l["company_code"], l.get("company_name") or l["company_code"], l, errors)

    total = 1 + len(ports) + len(countries) + len(liners)
    log.info("Done: %d/%d insights refreshed successfully.", total - len(errors), total)
    if errors:
        log.error("%d failures:\n%s", len(errors), "\n".join(errors))
        # A handful of failed entities (e.g. a transient Tavily/Anthropic error)
        # shouldn't fail the whole scheduled run — log and continue, matching
        # the resilience pattern in load_eesea.py.
        if len(errors) == total:
            sys.exit(1)  # every single call failed — that's a real problem


if __name__ == "__main__":
    main()
