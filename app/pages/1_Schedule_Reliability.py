import pandas as pd
import plotly.express as px
import streamlit as st

from common import apply_theme, render_header, kpi_card, human_format, query_table
from charts import hbar_chart

st.set_page_config(page_title="Schedule Reliability | Liner Services Dashboard", layout="wide")
apply_theme()
render_header("⏱️ Schedule Reliability", "Vessel arrival delays by port and month (eeSea event data)")

monthly = query_table("eesea_mv_reliability_monthly", order="month")
monthly["month"] = pd.to_datetime(monthly["month"])
port_activity = query_table("eesea_mv_port_activity")

st.sidebar.header("Filters")
all_ports = sorted(monthly["port_name"].dropna().unique().tolist())
selected_ports = st.sidebar.multiselect("Port", options=all_ports, default=[])

filtered = monthly[monthly["port_name"].isin(selected_ports)] if selected_ports else monthly

global_avg_delay = (filtered["avg_delay_days"] * filtered["event_count"]).sum() / filtered["event_count"].sum() if len(filtered) else None
global_on_time = (filtered["on_time_rate"] * filtered["event_count"]).sum() / filtered["event_count"].sum() if len(filtered) else None

c1, c2, c3 = st.columns(3)
with c1: kpi_card("Avg Delay", f"{global_avg_delay:.2f} days" if global_avg_delay is not None else "—", "Weighted by event count", 0)
with c2: kpi_card("On-Time Rate", f"{global_on_time * 100:.1f}%" if global_on_time is not None else "—", "Delay ≤ 1 day", 1)
with c3: kpi_card("Tracked Events", human_format(filtered["event_count"].sum()), "Port-vessel events", 2)

st.divider()

trend = filtered.groupby("month", as_index=False).apply(
    lambda g: pd.Series({
        "avg_delay_days": (g["avg_delay_days"] * g["event_count"]).sum() / g["event_count"].sum(),
        "event_count": g["event_count"].sum(),
    }),
    include_groups=False,
).sort_values("month")

col1, col2 = st.columns(2)
with col1:
    fig = px.line(trend, x="month", y="avg_delay_days", markers=True, title="Average Delay Trend (days)")
    st.plotly_chart(fig, width="stretch")
with col2:
    fig2 = px.bar(trend, x="month", y="event_count", title="Tracked Port-Vessel Events per Month")
    st.plotly_chart(fig2, width="stretch")

st.divider()
st.subheader("Reliability by Port")
by_port = filtered.groupby(["port_code", "port_name"], as_index=False).apply(
    lambda g: pd.Series({
        "avg_delay_days": (g["avg_delay_days"] * g["event_count"]).sum() / g["event_count"].sum(),
        "event_count": g["event_count"].sum(),
    }),
    include_groups=False,
).sort_values("event_count", ascending=False)

col3, col4 = st.columns(2)
with col3:
    worst = by_port[by_port["event_count"] >= 50].sort_values("avg_delay_days", ascending=False).head(20)
    st.plotly_chart(hbar_chart(worst, "port_name", "avg_delay_days", "Least Reliable Ports (avg delay, min 50 events)", color="#d1473a"), width="stretch")
with col4:
    best = by_port[by_port["event_count"] >= 50].sort_values("avg_delay_days").head(20)
    st.plotly_chart(hbar_chart(best, "port_name", "avg_delay_days", "Most Reliable Ports (avg delay, min 50 events)", color="#1e8a4c"), width="stretch")

st.divider()
st.dataframe(by_port.rename(columns={"avg_delay_days": "Avg Delay (days)", "event_count": "Events", "port_name": "Port"}), width="stretch", hide_index=True)
