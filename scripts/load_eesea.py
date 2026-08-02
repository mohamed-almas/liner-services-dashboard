"""
Weekly BigQuery → Supabase loader for Eesea liner services data.
Uses Supabase REST API (HTTPS) — no direct DB connection required.
"""
import base64
import logging
import os
import sys
import tempfile
from decimal import Decimal

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
            key_path, scopes=["https://www.googleapis.com/auth/bigquery"]
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

    def rpc(self, fn: str, params: dict = None, timeout: int = 60):
        r = requests.post(
            f"{self.base}/rpc/{fn}",
            json=params or {},
            headers=self.headers,
            timeout=timeout,
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


def serialize_val(val):
    if val is None:
        return None
    if isinstance(val, Decimal):
        return float(val)
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return val


def row_to_dict(columns, row):
    return {col: serialize_val(val) for col, val in zip(columns, row.values())}


def load_table(sb: SupabaseREST, bq: bigquery.Client, bq_table: str, pg_table: str):
    query = f"SELECT * FROM `{BQ_PROJECT}.{BQ_DATASET}.{bq_table}`"
    log.info("Querying BQ: %s", bq_table)
    result = bq.query(query).result(page_size=5000)
    columns = [f.name for f in result.schema]

    # Truncate first, then stream-insert in batches
    sb.rpc("truncate_eesea_table", {"table_name": pg_table})
    log.info("  truncated %s, streaming inserts ...", pg_table)

    batch = []
    total = 0
    for row in result:
        batch.append(row_to_dict(columns, row))
        if len(batch) >= BATCH_SIZE:
            sb.insert_batch(pg_table, batch)
            total += len(batch)
            batch = []
            if (total // BATCH_SIZE) % 20 == 0:
                log.info("  inserted %d rows into %s ...", total, pg_table)

    if batch:
        sb.insert_batch(pg_table, batch)
        total += len(batch)

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

    # Always refresh matviews regardless of table load errors so the dashboard
    # reflects the latest successfully-loaded data even on partial failures.
    #
    # The refresh_eesea_matviews() function itself sets statement_timeout = 0,
    # so Postgres never kills it server-side — but the client-side HTTP read
    # timeout still applies. With 30+ views (several now driven by
    # multi-million-row tables: port_vessels_per_service, service_proformas,
    # routes_service_versions) the refresh chain can run well past a minute,
    # so give it a generous ceiling rather than the default 60s used for
    # quick calls like truncate.
    try:
        log.info("Refreshing materialized views ...")
        sb.rpc("refresh_eesea_matviews", timeout=1800)
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
