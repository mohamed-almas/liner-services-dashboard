import pandas as pd
import plotly.express as px
import streamlit as st

from common import apply_theme, render_header, kpi_card, human_format, query_table
from charts import hbar_chart, donut_chart

st.set_page_config(page_title="Ports & Terminals | Liner Services Dashboard", layout="wide")
apply_theme()
render_header("⚓ Ports & Terminals", "Port and terminal infrastructure, ownership, and throughput")

ports_raw = query_table("eesea_mv_terminals")
activity = query_table("eesea_mv_port_activity")

st.sidebar.header("Filters")
countries = sorted(ports_raw["port_country_code"].dropna().unique().tolist())
selected_countries = st.sidebar.multiselect("Port country", options=countries, default=[])

filtered_ports = ports_raw[ports_raw["port_country_code"].isin(selected_countries)] if selected_countries else ports_raw

distinct_ports = filtered_ports["port_code"].nunique()
distinct_terminals = filtered_ports["terminal_id"].nunique()
distinct_operators = filtered_ports["company_name"].nunique()
total_capacity = filtered_ports.drop_duplicates("terminal_id")["volume_capacity"].sum()

c1, c2, c3, c4 = st.columns(4)
with c1: kpi_card("Distinct Ports", human_format(distinct_ports), "", 0)
with c2: kpi_card("Distinct Terminals", human_format(distinct_terminals), "", 1)
with c3: kpi_card("Terminal Operators", human_format(distinct_operators), "", 2)
with c4: kpi_card("Total Terminal Capacity", human_format(total_capacity), "TEU (annual)", 3)

st.divider()

col1, col2 = st.columns(2)
with col1:
    top_calls = activity.sort_values("total_calls", ascending=False).head(20)
    st.plotly_chart(hbar_chart(top_calls, "port_name", "total_calls", "Top 20 Ports by Vessel Calls"), width="stretch")
with col2:
    operator_terminals = filtered_ports.drop_duplicates("terminal_id").groupby("company_name", as_index=False).size().rename(columns={"size": "terminals"})
    operator_terminals = operator_terminals[operator_terminals["company_name"].notna()].sort_values("terminals", ascending=False)
    st.plotly_chart(donut_chart(operator_terminals, "company_name", "terminals", "Terminal Operators by Number of Terminals"), width="stretch")

st.divider()
st.subheader("Terminal Locations")
geo = filtered_ports.drop_duplicates("terminal_id").dropna(subset=["terminal_latitude", "terminal_longitude"])
if len(geo):
    fig = px.scatter_geo(
        geo, lat="terminal_latitude", lon="terminal_longitude",
        hover_name="terminal_name", hover_data=["port_name", "company_name"],
        title="Terminal Locations", color_discrete_sequence=["#1b6ca8"],
    )
    st.plotly_chart(fig, width="stretch")
else:
    st.info("No terminal coordinates available for the current filter.")

st.divider()
st.subheader("Port Activity Detail")
detail = activity.sort_values("total_calls", ascending=False)
if selected_countries:
    valid_codes = filtered_ports["port_code"].unique().tolist()
    detail = detail[detail["port_code"].isin(valid_codes)]
st.dataframe(
    detail.rename(columns={
        "port_name": "Port", "total_calls": "Vessel Calls", "distinct_vessels": "Distinct Vessels",
        "distinct_services": "Distinct Services", "avg_delay_days": "Avg Delay (days)",
    }),
    width="stretch", hide_index=True,
)
