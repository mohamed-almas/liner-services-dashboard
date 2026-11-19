"""
Refresh the three UNCTAD liner-shipping index tables in the Maritime Shipping
Supabase project from UNCTADstat's user API.

  unctad_lsci_m   US.LSCI_M   Connectivity index, by economy       (monthly)
  unctad_plsci    US.PLSCI    Port connectivity index, by port     (quarterly)
  unctad_lsbci    US.LSBCI    Bilateral connectivity, econ/partner (quarterly)

Usage
  UNCTAD_CLIENT_ID=... UNCTAD_API_KEY=... \
  SUPABASE_URL=https://<ref>.supabase.co/rest/v1 SUPABASE_SERVICE_ROLE_KEY=... \
  python scripts/load_unctad.py [lsci|plsci|lsbci|all] [--full] [--all-codes] [--discover]

By default only periods missing from the table are fetched, plus the latest
period already stored (so a revision to the most recent release is picked up).
--full refetches every period from 2006.

Notes on fidelity, taken from the existing data rather than assumed:

* The index is NOT rounded. UNCTAD's own CSV export carries 5 decimals
  (e.g. 59.70207) and the stored column matches, so the `round(..., 2)` in
  UNCTAD's sample R snippet would silently degrade precision. It is omitted.

* unctad_lsci_m.yoy_growth / period_growth are separate API measures whose
  numeric codes are not publicly documented (the metadata endpoint returns 401
  without credentials). Until those codes are wired in here they are filled by
  the Postgres function refresh_unctad_lsci_growth(), which derives them from
  the index. That is accurate to about 0.01 -- UNCTAD computes growth from
  higher internal precision than it publishes -- so the function only ever
  fills NULLs and never overwrites an API-supplied value.
  Run with --discover once credentials exist to dump the measure list, then
  replace the derivation with the real measures.

* The economy/port universe is read from the codes already in each table. That
  keeps UNCTAD's aggregate rows (world/region totals) out without embedding a
  20KB literal list, at the cost of not auto-adopting newly added countries or
  ports; --all-codes drops the filter so new ones come through.
"""
import csv
import gzip
import io
import os
import sys
import time
import datetime as dt

import requests

API_ROOT = "https://unctadstat-user-api.unctad.org"
REQUIRED_ENV = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
                "UNCTAD_CLIENT_ID", "UNCTAD_API_KEY")


def env(name):
    """Read config lazily so the module imports (and is testable) without secrets."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable {name}")
    return value.rstrip("/") if name == "SUPABASE_URL" else value

BATCH = 2000
FIRST_YEAR = 2006
# LSCI is quarterly (Feb/May/Aug/Nov) until it switches to monthly in 2023.
LSCI_QUARTERLY_MONTHS = ["02", "05", "08", "11"]
LSCI_MONTHLY_FROM = 2023


def log(msg):
    print(f"[{dt.datetime.now(dt.timezone.utc):%H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------- period lists
def lsci_periods():
    today = dt.date.today()
    out = []
    for year in range(FIRST_YEAR, today.year + 1):
        months = (
            [f"{m:02d}" for m in range(1, 13)]
            if year >= LSCI_MONTHLY_FROM
            else LSCI_QUARTERLY_MONTHS
        )
        for mm in months:
            if year == today.year and int(mm) > today.month:
                continue
            out.append(f"{year}M{mm}")
    return out


def quarter_periods():
    today = dt.date.today()
    this_q = (today.month - 1) // 3 + 1
    out = []
    for year in range(FIRST_YEAR, today.year + 1):
        for q in range(1, 5):
            if year == today.year and q > this_q:
                continue
            out.append(f"{year}Q{q:02d}")
    return out


# ------------------------------------------------------------------ datasets
DATASETS = {
    "lsci": {
        "report": "US.LSCI_M",
        "table": "unctad_lsci_m",
        "is_async": False,
        "measure": "M6048",
        "period_dim": "Month",
        "period_col": "month",
        "periods": lsci_periods,
        # (API dimension, code column, label column)
        "dims": [("Month", "month", "month_label"),
                 ("Economy", "economy_code", "economy_label")],
        "code_filter_dim": "Economy",
        "code_filter_col": "economy_code",
        "on_conflict": "month,economy_code",
        "order": "Economy/Order asc ,Month/Order asc",
    },
    "plsci": {
        "report": "US.PLSCI",
        "table": "unctad_plsci",
        "is_async": True,
        "measure": "M6047",
        "period_dim": "Quarter",
        "period_col": "quarter",
        "periods": quarter_periods,
        "dims": [("Quarter", "quarter", "quarter_label"),
                 ("Port", "port_code", "port_label")],
        "code_filter_dim": "Port",
        "code_filter_col": "port_code",
        "on_conflict": "quarter,port_code",
        "order": "Port/Order asc ,Quarter/Order asc",
    },
    "lsbci": {
        "report": "US.LSBCI",
        "table": "unctad_lsbci",
        "is_async": False,
        "measure": "M6700",
        "period_dim": "Quarter",
        "period_col": "quarter",
        "periods": quarter_periods,
        "dims": [("Quarter", "quarter", "quarter_label"),
                 ("Economy", "economy_code", "economy_label"),
                 ("Partner", "partner_code", "partner_label")],
        "code_filter_dim": "Economy",
        "code_filter_col": "economy_code",
        # Bilateral: the partner axis takes the same economy universe.
        "extra_code_dim": "Partner",
        "on_conflict": "quarter,economy_code,partner_code",
        "order": "Economy/Order asc ,Partner/Order asc ,Quarter/Order asc",
    },
}


# ------------------------------------------------------------------- supabase
def sb_headers(extra=None):
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def sb_distinct(table, column):
    """Every distinct non-null value of a column, paged."""
    seen, offset, page = set(), 0, 10000
    while True:
        r = requests.get(
            f"{env('SUPABASE_URL')}/{table}",
            headers=sb_headers({"Range-Unit": "items",
                                "Range": f"{offset}-{offset + page - 1}"}),
            params={"select": column, column: "not.is.null"},
            timeout=120,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        seen.update(row[column] for row in rows)
        if len(rows) < page:
            break
        offset += page
    return sorted(seen)


def sb_max(table, column):
    r = requests.get(
        f"{env('SUPABASE_URL')}/{table}",
        headers=sb_headers(),
        params={"select": column, "order": f"{column}.desc", "limit": 1},
        timeout=60,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0][column] if rows else None


def sb_upsert(table, rows, on_conflict):
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        r = requests.post(
            f"{env('SUPABASE_URL')}/{table}",
            headers=sb_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            params={"on_conflict": on_conflict},
            json=chunk,
            timeout=300,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"upsert {table} failed {r.status_code}: {r.text[:500]}")
        log(f"    upserted {i + len(chunk)}/{len(rows)}")


def sb_rpc(fn):
    r = requests.post(f"{env('SUPABASE_URL')}/rpc/{fn}", headers=sb_headers(),
                      json={}, timeout=600)
    if r.status_code >= 400:
        raise RuntimeError(f"rpc {fn} failed {r.status_code}: {r.text[:300]}")


# ----------------------------------------------------------------- unctad api
def api_headers():
    return {"ClientId": env("UNCTAD_CLIENT_ID"), "ClientSecret": env("UNCTAD_API_KEY")}


def build_form(cfg, periods, codes):
    value_alias = "Index_Value"
    selects = []
    for dim, _code_col, _label_col in cfg["dims"]:
        selects += [f"{dim}/Code", f"{dim}/Label"]
    selects.append(value_alias)

    clauses = [
        "{}/Code in ({})".format(
            cfg["period_dim"], ",".join(f"'{p}'" for p in periods)
        )
    ]
    if codes:
        joined = ",".join(f"'{c}'" for c in codes)
        clauses.append(f"{cfg['code_filter_dim']}/Code in ({joined})")
        if cfg.get("extra_code_dim"):
            clauses.append(f"{cfg['extra_code_dim']}/Code in ({joined})")

    return {
        "$select": " ,".join(selects),
        "$filter": " and ".join(clauses),
        "$orderby": cfg["order"],
        # No round(): the published index carries 5 decimals.
        "$compute": f"{cfg['measure']}/Value as {value_alias}",
        "$format": "csv",
        "compress": "gz",
    }


def fetch_sync(cfg, form):
    url = f"{API_ROOT}/{cfg['report']}/cur/Facts?culture=en"
    r = requests.post(url, headers=api_headers(), data=form, timeout=900)
    if r.status_code != 200:
        raise RuntimeError(f"{cfg['report']} returned {r.status_code}: {r.text[:400]}")
    return r.content


def fetch_async(cfg, form):
    """UNCTAD prepares the file: 202 accepted, then poll until 302 + Location."""
    url = f"{API_ROOT}/async/{cfg['report']}/cur/Facts?culture=en"
    r = requests.post(url, headers=api_headers(), data=form,
                      timeout=300, allow_redirects=False)
    if r.status_code != 202:
        raise RuntimeError(f"async request rejected {r.status_code}: {r.text[:400]}")

    deadline = time.time() + 3600
    while time.time() < deadline:
        location = r.headers.get("location")
        retry_after = r.headers.get("retry-after")
        if r.status_code == 302 and location:
            log("    file ready, downloading")
            d = requests.get(location, timeout=900)
            d.raise_for_status()
            return d.content
        if not (location and retry_after):
            raise RuntimeError(f"unexpected async reply {r.status_code}")
        wait = min(float(retry_after), 60)
        log(f"    not ready, waiting {wait:g}s")
        time.sleep(wait)
        r = requests.get(location, timeout=300, allow_redirects=False)
    raise RuntimeError("async download timed out after 1h")


def parse_csv(blob, cfg):
    """UNCTAD returns gzipped CSV; columns arrive in $select order."""
    try:
        text = gzip.decompress(blob).decode("utf-8-sig")
    except (OSError, EOFError):
        text = blob.decode("utf-8-sig")

    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if header is None:
        return []
    expected = 2 * len(cfg["dims"]) + 1
    if len(header) != expected:
        raise RuntimeError(f"unexpected columns {header}")

    rows = []
    for rec in reader:
        if not rec:
            continue
        row = {}
        for i, (_dim, code_col, label_col) in enumerate(cfg["dims"]):
            row[code_col] = rec[2 * i] or None
            row[label_col] = rec[2 * i + 1] or None
        raw = rec[-1]
        row["index_value"] = float(raw) if raw not in ("", None) else None
        # Key columns must be present or the upsert has nothing to match on.
        if all(row[c] for _d, c, _l in cfg["dims"]):
            rows.append(row)
    return rows


def discover(cfg):
    """Dump the report's measures so the growth codes can be wired in."""
    for path in ("$metadata", "Measures?culture=en", "Dimensions?culture=en"):
        url = f"{API_ROOT}/{cfg['report']}/cur/{path}"
        try:
            r = requests.get(url, headers=api_headers(), timeout=120)
            log(f"  {path} -> {r.status_code}")
            if r.ok:
                print(r.text[:4000])
        except requests.RequestException as exc:
            log(f"  {path} -> {exc}")


# ----------------------------------------------------------------------- main
def run(name, full, all_codes, do_discover):
    cfg = DATASETS[name]
    log(f"{name}: {cfg['report']} -> {cfg['table']}")

    if do_discover:
        discover(cfg)
        return

    periods = cfg["periods"]()
    if not full:
        newest = sb_max(cfg["table"], cfg["period_col"])
        if newest:
            # Include the newest stored period: UNCTAD revises the latest release.
            periods = [p for p in periods if p >= newest]
    if not periods:
        log("  nothing to fetch")
        return

    codes = None if all_codes else sb_distinct(cfg["table"], cfg["code_filter_col"])
    log(f"  {len(periods)} period(s) {periods[0]}..{periods[-1]}"
        f"{'' if codes is None else f', {len(codes)} codes'}")

    form = build_form(cfg, periods, codes)
    blob = fetch_async(cfg, form) if cfg["is_async"] else fetch_sync(cfg, form)
    rows = parse_csv(blob, cfg)
    log(f"  parsed {len(rows)} rows")
    if not rows:
        log("  WARNING: no rows returned, nothing written")
        return

    sb_upsert(cfg["table"], rows, cfg["on_conflict"])

    if name == "lsci":
        log("  filling derived growth columns")
        sb_rpc("refresh_unctad_lsci_growth")
    log(f"  {name} done")


def main():
    args = list(sys.argv[1:])
    full = "--full" in args
    all_codes = "--all-codes" in args
    do_discover = "--discover" in args
    targets = [a for a in args if not a.startswith("--")] or ["all"]
    if targets == ["all"]:
        targets = list(DATASETS)

    bad = [t for t in targets if t not in DATASETS]
    if bad:
        sys.exit(f"unknown dataset(s): {bad}; choose from {list(DATASETS)} or 'all'")

    missing = [n for n in REQUIRED_ENV if not os.environ.get(n)]
    if missing:
        sys.exit(f"missing environment variable(s): {', '.join(missing)}")

    failures = []
    for name in targets:
        try:
            run(name, full, all_codes, do_discover)
        except Exception as exc:  # one dataset failing must not block the rest
            log(f"  FAILED {name}: {exc}")
            failures.append(name)

    if failures:
        sys.exit(f"failed: {', '.join(failures)}")
    log("all done")


if __name__ == "__main__":
    main()
