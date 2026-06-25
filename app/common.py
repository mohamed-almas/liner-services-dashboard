import pandas as pd
import streamlit as st
from supabase import create_client

THEME = {
    "bg": "#eef1f5",
    "card": "#ffffff",
    "header": "#0b2545",
    "header2": "#13315c",
    "text": "#1b2733",
    "text_secondary": "#5b6b7c",
    "positive": "#1e8a4c",
    "negative": "#d1473a",
}
CHART_COLORS = ["#1b6ca8", "#ef8a17", "#2a9d8f", "#e76f51", "#8d6fb8", "#4b8b3b", "#c9444d", "#5b6b7c"]


def apply_theme():
    st.markdown(
        f"""
        <style>
        .stApp {{ background-color: {THEME['bg']}; }}
        [data-testid="stSidebar"] {{ background-color: {THEME['header']}; }}
        [data-testid="stSidebar"] * {{ color: #e9f0f9 !important; }}
        h1, h2, h3 {{ color: {THEME['text']}; }}

        .dash-header {{
            background: linear-gradient(120deg, {THEME['header']}, {THEME['header2']});
            color: #ffffff;
            padding: 22px 28px;
            border-radius: 10px;
            margin-bottom: 16px;
        }}
        .dash-header h1 {{ color: #ffffff; font-size: 21px; font-weight: 700; margin: 0; }}
        .dash-header .subtitle {{ font-size: 12.5px; color: #bcd2ec; margin-top: 4px; }}

        .kpi-card {{
            background: {THEME['card']};
            border-radius: 10px;
            padding: 16px 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,.08);
            border-left: 4px solid {CHART_COLORS[0]};
            height: 100%;
        }}
        .kpi-label {{ font-size: 11.5px; color: {THEME['text_secondary']}; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }}
        .kpi-value {{ font-size: 25px; font-weight: 700; color: {THEME['text']}; }}
        .kpi-sub {{ font-size: 11px; color: {THEME['text_secondary']}; margin-top: 2px; }}

        .insight-card {{
            background: #f6f8fb;
            border-radius: 8px;
            padding: 14px 16px;
            border-top: 3px solid {CHART_COLORS[0]};
            margin-bottom: 8px;
            color: {THEME['text']};
            height: 100%;
        }}
        .insight-card b {{ color: {THEME['header']}; }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_header(title: str, subtitle: str):
    st.markdown(
        f"""<div class="dash-header"><h1>{title}</h1><div class="subtitle">{subtitle}</div></div>""",
        unsafe_allow_html=True,
    )


def kpi_card(label: str, value: str, sub: str = "", color_index: int = 0):
    color = CHART_COLORS[color_index % len(CHART_COLORS)]
    st.markdown(
        f"""
        <div class="kpi-card" style="border-left-color:{color};">
            <div class="kpi-label">{label}</div>
            <div class="kpi-value">{value}</div>
            <div class="kpi-sub">{sub}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def human_format(n) -> str:
    if n is None or pd.isna(n):
        return "—"
    n = float(n)
    sign = "-" if n < 0 else ""
    n = abs(n)
    for unit, div in [("Bn", 1e9), ("M", 1e6), ("K", 1e3)]:
        if n >= div:
            return f"{sign}{n / div:,.1f} {unit}"
    return f"{sign}{n:,.0f}"


# ---------------------------------------------------------------------------
# Supabase client + query helpers
# ---------------------------------------------------------------------------
@st.cache_resource
def get_client():
    cfg = st.secrets["supabase"]
    return create_client(cfg["url"], cfg["anon_key"])


_PAGE_SIZE = 1000


@st.cache_data(ttl=300)
def query_table(
    table_name: str,
    select: str = "*",
    filters: dict | None = None,
    in_filters: dict | None = None,
    gte_filters: dict | None = None,
    lte_filters: dict | None = None,
    order: str | None = None,
    desc: bool = False,
    limit: int | None = None,
) -> pd.DataFrame:
    """Fetches all matching rows, paginating past PostgREST's default 1000-row cap.

    Equality/range filters are pushed server-side to keep result sets small — several of
    the eesea_* tables (e.g. port_vessels_per_service) have millions of rows, so use the
    eesea_mv_* materialized views for anything that needs aggregation across the full table.
    """
    client = get_client()
    rows = []
    offset = 0
    while True:
        page_limit = min(_PAGE_SIZE, limit - len(rows)) if limit else _PAGE_SIZE
        q = client.table(table_name).select(select)
        for col, val in (filters or {}).items():
            q = q.eq(col, val)
        for col, val in (in_filters or {}).items():
            q = q.in_(col, val)
        for col, val in (gte_filters or {}).items():
            q = q.gte(col, val)
        for col, val in (lte_filters or {}).items():
            q = q.lte(col, val)
        if order:
            q = q.order(order, desc=desc)
        q = q.range(offset, offset + page_limit - 1)
        page = q.execute().data
        rows.extend(page)
        if len(page) < page_limit or (limit and len(rows) >= limit):
            break
        offset += page_limit
    return pd.DataFrame(rows)


@st.cache_data(ttl=3600)
def get_filter_options():
    trade_lanes = query_table("eesea_mv_service_overview", select="trade_lane_category")
    alliances = query_table("eesea_mv_service_overview", select="alliance_code")
    return (
        sorted(trade_lanes["trade_lane_category"].dropna().unique().tolist()),
        sorted(alliances["alliance_code"].dropna().unique().tolist()),
    )


def render_global_filters():
    trade_lanes, alliances = get_filter_options()
    st.sidebar.header("Filters")
    selected_lanes = st.sidebar.multiselect("Trade lane", options=trade_lanes, default=[])
    selected_alliances = st.sidebar.multiselect("Alliance", options=alliances, default=[])
    st.session_state["trade_lanes"] = selected_lanes
    st.session_state["alliances"] = selected_alliances


def get_service_filters() -> dict:
    in_filters = {}
    if st.session_state.get("trade_lanes"):
        in_filters["trade_lane_category"] = st.session_state["trade_lanes"]
    if st.session_state.get("alliances"):
        in_filters["alliance_code"] = st.session_state["alliances"]
    return in_filters
