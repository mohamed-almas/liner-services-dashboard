"""
Offline checks for load_unctad.py -- no network, no credentials.

  python scripts/test_load_unctad.py
"""
import gzip
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_unctad as m  # noqa: E402


def test_periods():
    months = m.lsci_periods()
    # Quarterly cadence before 2023, monthly from 2023. Getting this wrong makes
    # the loader request periods UNCTAD does not publish.
    assert "2006M02" in months and "2006M05" in months
    assert "2006M03" not in months, "pre-2023 must stay quarterly"
    assert "2023M03" in months, "2023 onward must be monthly"
    assert months == sorted(months)
    assert len(set(months)) == len(months)

    quarters = m.quarter_periods()
    assert quarters[0] == "2006Q01"
    assert "2026Q01" in quarters
    assert all(len(q) == 7 and "Q" in q for q in quarters)
    # Period codes are zero-padded; '2026Q1' would not match UNCTAD's codes.
    assert "2026Q1" not in quarters


def test_filter_and_select():
    cfg = m.DATASETS["lsbci"]
    form = m.build_form(cfg, ["2026Q01"], ["008", "012"])
    # Bilateral needs BOTH axes constrained, else the partner side returns
    # aggregate rows that are not in the table.
    assert "Economy/Code in ('008','012')" in form["$filter"]
    assert "Partner/Code in ('008','012')" in form["$filter"]
    assert "Quarter/Code in ('2026Q01')" in form["$filter"]
    # Index must not be rounded: the stored column carries 5 decimals.
    assert "round" not in form["$compute"]
    assert form["$compute"] == "M6700/Value as Index_Value"
    assert form["$select"].count("/Code") == 3
    assert form["$format"] == "csv"

    # Without a code list only the period is constrained.
    assert "Economy/Code in" not in m.build_form(cfg, ["2026Q01"], None)["$filter"]


def _csv_gz(text):
    return gzip.compress(text.encode("utf-8"))


def test_parse_csv():
    cfg = m.DATASETS["lsci"]
    blob = _csv_gz(
        "Month,Month Label,Economy,Economy Label,Index_Value\r\n"
        "2026M09,Sep. 2026,012,Algeria,59.70207\r\n"
        "2026M09,Sep. 2026,036,Australia,\r\n"
    )
    rows = m.parse_csv(blob, cfg)
    assert len(rows) == 2
    assert rows[0] == {
        "month": "2026M09", "month_label": "Sep. 2026",
        "economy_code": "012", "economy_label": "Algeria",
        "index_value": 59.70207,
    }, rows[0]
    # Full precision preserved, not truncated to 2dp.
    assert str(rows[0]["index_value"]) == "59.70207"
    # A missing index is a real UNCTAD state ("No value reported") -> NULL, kept.
    assert rows[1]["index_value"] is None

    # Plain (uncompressed) CSV must also parse: compress=gz is only a request hint.
    plain = ("Month,Month Label,Economy,Economy Label,Index_Value\n"
             "2026M09,Sep. 2026,012,Algeria,1.5\n").encode("utf-8")
    assert m.parse_csv(plain, cfg)[0]["index_value"] == 1.5

    # Three-dimension shape.
    b = m.DATASETS["lsbci"]
    rows = m.parse_csv(_csv_gz(
        "Quarter,QL,Economy,EL,Partner,PL,Index_Value\n"
        "2026Q01,Q1 2026,008,Albania,012,Algeria,0.123\n"), b)
    assert rows[0]["partner_code"] == "012"
    assert rows[0]["index_value"] == 0.123

    # A row missing a key column cannot be upserted, so it must be dropped.
    rows = m.parse_csv(_csv_gz(
        "Month,Month Label,Economy,Economy Label,Index_Value\n"
        "2026M09,Sep. 2026,,Nowhere,1.0\n"), cfg)
    assert rows == []


def test_column_count_guard():
    cfg = m.DATASETS["lsci"]
    try:
        m.parse_csv(_csv_gz("a,b,c\n1,2,3\n"), cfg)
    except RuntimeError:
        pass
    else:
        raise AssertionError("wrong column count must raise, not silently mis-map")


def test_on_conflict_matches_unique_indexes():
    # These must match the unique indexes in Supabase or upserts duplicate rows.
    assert m.DATASETS["lsci"]["on_conflict"] == "month,economy_code"
    assert m.DATASETS["plsci"]["on_conflict"] == "quarter,port_code"
    assert m.DATASETS["lsbci"]["on_conflict"] == "quarter,economy_code,partner_code"


def test_env_is_lazy():
    # Importing without secrets must work; only use raises.
    try:
        m.env("DEFINITELY_NOT_SET_12345")
    except RuntimeError:
        pass
    else:
        raise AssertionError("missing env var must raise")


def test_period_batches():
    # Bilateral: 191^2 = 36,481 cells per quarter, so each quarter is its own
    # request. Four quarters in one call is 145,924 and UNCTAD returns HTTP 400.
    codes = [f"{i:03d}" for i in range(191)]
    quarters = ["2026Q01", "2026Q02", "2026Q03", "2026Q04"]
    b = m.period_batches(m.DATASETS["lsbci"], quarters, codes)
    assert [len(x) for x in b] == [1, 1, 1, 1], b
    assert [p for x in b for p in x] == quarters, "no period may be dropped"

    # Single-axis datasets fit in one request.
    assert len(m.period_batches(m.DATASETS["lsci"], ["2026M09"] * 3, codes)) == 1
    ports = [f"P{i:04d}" for i in range(1354)]
    b = m.period_batches(m.DATASETS["plsci"], ["2026Q03", "2026Q04"], ports)
    assert len(b) == 1, b

    # Every period survives batching at a larger span.
    many = m.quarter_periods()
    out = [p for x in m.period_batches(m.DATASETS["lsbci"], many, codes) for p in x]
    assert out == many

    # No code filter -> single batch.
    assert m.period_batches(m.DATASETS["lsbci"], quarters, None) == [quarters]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all checks passed")
