import pandas as pd
import streamlit as st

from common import apply_theme, render_header, kpi_card, human_format, query_table, render_global_filters, get_service_filters
from charts import donut_chart, hbar_chart, treemap_chart

st.set_page_config(page_title="Overview | Liner Services Dashboard", layout="wide")
apply_theme()
render_header("🚢 Liner Services Dashboard", "Eesea (Xeneta) — Container Liner Schedules & Network Overview")

render_global_filters()
filters = get_service_filters()

services = query_table("eesea_mv_service_overview", in_filters=filters)
companies = query_table("eesea_companies")
vessels = query_table("eesea_vessels")
ports = query_table("eesea_mv_port_activity")

ACTIVE_STATUS = "0 : Currently active version"
active_services = services[services["service_version_validity_status"] == ACTIVE_STATUS] if "service_version_validity_status" in services.columns else services

c1, c2, c3, c4 = st.columns(4)
with c1: kpi_card("Active Services", human_format(len(active_services)), "Service versions", 0)
with c2: kpi_card("Vessels Tracked", human_format(len(vessels)), "Across all services", 1)
with c3: kpi_card("Ports Covered", human_format(len(ports)), "With recorded port calls", 2)
with c4: kpi_card("Shipping Companies", human_format(len(companies)), "Operators, terminals, conglomerates", 3)

st.write("")

avg_capacity = active_services["service_version_average_vessel_capacity_teu"].mean() if len(active_services) else None
avg_frequency = active_services["service_version_frequency_days"].mean() if len(active_services) else None
allied_services = active_services[~active_services["alliance_code"].isin([None, "X - None"])]
top_alliance = (
    allied_services["alliance_code"].value_counts().idxmax()
    if len(allied_services) else "—"
)
top_lane = (
    active_services["trade_lane_category"].value_counts().idxmax()
    if len(active_services) and active_services["trade_lane_category"].notna().any() else "—"
)

c5, c6, c7, c8 = st.columns(4)
with c5: kpi_card("Avg Vessel Capacity", human_format(avg_capacity) + " TEU" if avg_capacity else "—", "Active services", 4)
with c6: kpi_card("Avg Sailing Frequency", f"{avg_frequency:.1f} days" if avg_frequency else "—", "Active services", 5)
with c7: kpi_card("Top Alliance", str(top_alliance), "By number of active services", 6)
with c8: kpi_card("Top Trade Lane", str(top_lane), "By number of active services", 7)

st.divider()

col1, col2 = st.columns(2)
with col1:
    lane_counts = active_services.groupby("trade_lane_category", as_index=False).size().rename(columns={"size": "services"})
    lane_counts = lane_counts[lane_counts["trade_lane_category"].notna()]
    st.plotly_chart(donut_chart(lane_counts, "trade_lane_category", "services", "Active Services by Trade Lane"), width="stretch")
with col2:
    alliance_counts = allied_services.groupby("alliance_code", as_index=False).size().rename(columns={"size": "services"})
    st.plotly_chart(donut_chart(alliance_counts, "alliance_code", "services", "Active Allied Services by Alliance (excl. independents)"), width="stretch")

col3, col4 = st.columns(2)
with col3:
    top_ports_calls = ports.sort_values("total_calls", ascending=False).head(20)
    st.plotly_chart(hbar_chart(top_ports_calls, "port_name", "total_calls", "Top 20 Ports by Vessel Calls"), width="stretch")
with col4:
    top_operators = active_services.groupby("primary_operator_name", as_index=False).size().rename(columns={"size": "services"})
    top_operators = top_operators[top_operators["primary_operator_name"].notna()]
    st.plotly_chart(hbar_chart(top_operators, "primary_operator_name", "services", "Top 20 Operators by Number of Services"), width="stretch")

st.divider()
st.subheader("Trade Lane → Alliance Hierarchy")
tree_df = active_services.groupby(["trade_lane_category", "alliance_code"], as_index=False).size().rename(columns={"size": "services"})
tree_df = tree_df[tree_df["trade_lane_category"].notna()]
tree_df["alliance_code"] = tree_df["alliance_code"].fillna("Independent")
st.plotly_chart(treemap_chart(tree_df, ["trade_lane_category", "alliance_code"], "services", "Active Services — Trade Lane & Alliance"), width="stretch")
