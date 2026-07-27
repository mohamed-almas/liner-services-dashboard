"""
Weekly BigQuery → Supabase loader for Eesea liner services data.
Uses Supabase REST API (HTTPS) — no direct DB connection required.
"""
import base64
import logging
import os
import sys
import tempfile
from datetime import datetime, timezone

import requests
from google.cloud import bigquery
from google.oauth2 import service_account

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BQ_PROJECT = "eesea-deep-blue-external"
BQ_DATASET = "ad_ports"
BATCH_SIZE = 2000

TABLES = [
    ("companies_table",           "eesea_companies"),
    ("vessels_table",             "eesea_vessels"),
    ("ports_and_terminals",       "eesea_ports_and_terminals"),
    ("service_versions_table",    "eesea_service_versions"),
    ("port_vessels_per_service",  "eesea_port_vessels_per_service"),
    ("service_proformas_table",   "eesea_service_proformas"),
    ("routes_service_versions",   "eesea_routes_service_versions"),
    ("vsa_table",                 "eesea_vsa"),
]


def bq_client():
    raw = os.environ["BQ_SA_KEY_JSON"].strip()
    if not raw:
        raise ValueError("BQ_SA_KEY_JSON secret is empty")
    log.info("BQ_SA_KEY_JSON length: %d chars", len(raw))
    key_bytes = base64.b64decode(raw) if not raw.startswith("{") else raw.encode()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="wb") as f:
        f.write(key_bytes)
        key_path = f.name
    try:
        creds = service_account.Credentials.from_service_account_file(
            key_path, scopes=["https://www.googleapis.com/auth/bigquery.readonly"]
        )
    finally:
        os.unlink(key_path)
    return bigquery.Client(project=BQ_PROJECT, credentials=creds)


class SupabaseREST:
    def __init__(self, url: str, service_role_key: str):
        self.base = url.rstrip("/")
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def rpc(self, fn: str, params: dict = None):
        r = requests.post(
            f"{self.base}/rpc/{fn}",
            json=params or {},
            headers=self.headers,
            timeout=60,
        )
        if not r.ok:
            raise RuntimeError(f"RPC {fn} failed {r.status_code}: {r.text[:500]}")
        return r

    def insert_batch(self, table: str, rows: list[dict]):
        r = requests.post(
            f"{self.base}/{table}",
            json=rows,
            headers=self.headers,
            timeout=120,
        )
        if not r.ok:
            raise RuntimeError(f"INSERT {table} failed {r.status_code}: {r.text[:500]}")


def bq_rows_to_dicts(result) -> tuple[list[str], list[dict]]:
    columns = [f.name for f in result.schema]
    rows = []
    for row in result:
        d = {}
        for col, val in zip(columns, row.values()):
            if val is None:
                d[col] = None
            elif hasattr(val, "isoformat"):
                d[col] = val.isoformat()
            else:
                d[col] = val
        rows.append(d)
    return columns, rows


def load_table(sb: SupabaseREST, bq: bigquery.Client, bq_table: str, pg_table: str):
    query = f"SELECT * FROM `{BQ_PROJECT}.{BQ_DATASET}.{bq_table}`"
    log.info("Querying BQ: %s", bq_table)
    result = bq.query(query).result(page_size=5000)
    _, rows = bq_rows_to_dicts(result)
    total = len(rows)
    log.info("  fetched %d rows, truncating %s ...", total, pg_table)

    sb.rpc("truncate_eesea_table", {"table_name": pg_table})

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        sb.insert_batch(pg_table, batch)
        if (i // BATCH_SIZE) % 10 == 0:
            log.info("  inserted %d / %d rows", min(i + BATCH_SIZE, total), total)

    log.info("Loaded %s → %s (%d rows)", bq_table, pg_table, total)


def main():
    sb = SupabaseREST(
        url=os.environ["SUPABASE_URL"],
        service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    bq = bq_client()
    errors = []

    for bq_table, pg_table in TABLES:
        try:
            load_table(sb, bq, bq_table, pg_table)
        except Exception as e:
            log.error("Failed %s: %s", bq_table, e)
            errors.append(f"{bq_table}: {e}")

    if not errors:
        try:
            log.info("Refreshing materialized views ...")
            sb.rpc("refresh_eesea_matviews")
            log.info("Matviews refreshed")
        except Exception as e:
            log.error("Matview refresh failed: %s", e)
            errors.append(f"matviews: {e}")

    status = "error" if errors else "ok"
    details = "; ".join(errors) if errors else "All tables and matviews refreshed successfully"
    try:
        sb.rpc("log_eesea_refresh", {"p_status": status, "p_details": details})
    except Exception:
        pass

    if errors:
        log.error("Finished with errors: %s", details)
        sys.exit(1)
    log.info("Done: %s", details)


if __name__ == "__main__":
    main()
