import pandas as pd
import streamlit as st

from common import apply_theme, render_header, kpi_card, human_format, query_table, render_global_filters, get_service_filters

st.set_page_config(page_title="Services Explorer | Liner Services Dashboard", layout="wide")
apply_theme()
render_header("📋 Services Explorer", "Browse and filter individual liner service versions")

render_global_filters()
filters = get_service_filters()

services = query_table("eesea_mv_service_overview", in_filters=filters)

st.sidebar.header("Status")
status_options = sorted(services["service_version_validity_status"].dropna().unique().tolist())
ACTIVE_STATUS = "0 : Currently active version"
selected_status = st.sidebar.multiselect("Validity status", options=status_options, default=[ACTIVE_STATUS] if ACTIVE_STATUS in status_options else [])

filtered = services[services["service_version_validity_status"].isin(selected_status)] if selected_status else services

c1, c2, c3 = st.columns(3)
with c1: kpi_card("Services Matching Filters", human_format(len(filtered)), "", 0)
with c2: kpi_card("Avg Roundtrip", f"{filtered['service_version_roundtrip_days'].mean():.0f} days" if len(filtered) else "—", "", 1)
with c3: kpi_card("Avg Port Calls", f"{filtered['service_version_port_count'].mean():.1f}" if len(filtered) else "—", "", 2)

st.divider()

search = st.text_input("Search by service name")
display = filtered
if search:
    display = display[display["service_master_name"].str.contains(search, case=False, na=False)]

st.dataframe(
    display[[
        "service_master_name", "trade_lane_category", "alliance_code", "primary_operator_name",
        "service_version_average_vessel_capacity_teu", "service_version_call_count",
        "service_version_port_count", "service_version_roundtrip_days", "service_version_frequency_days",
        "service_version_validity_status",
    ]].rename(columns={
        "service_master_name": "Service", "trade_lane_category": "Trade Lane", "alliance_code": "Alliance",
        "primary_operator_name": "Primary Operator", "service_version_average_vessel_capacity_teu": "Avg Capacity (TEU)",
        "service_version_call_count": "Calls", "service_version_port_count": "Ports",
        "service_version_roundtrip_days": "Roundtrip (days)", "service_version_frequency_days": "Frequency (days)",
        "service_version_validity_status": "Status",
    }).sort_values("Avg Capacity (TEU)", ascending=False, na_position="last"),
    width="stretch", hide_index=True, height=600,
)
