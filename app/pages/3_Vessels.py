import datetime as dt

import pandas as pd
import plotly.express as px
import streamlit as st

from common import apply_theme, render_header, kpi_card, human_format, query_table

st.set_page_config(page_title="Vessels | Liner Services Dashboard", layout="wide")
apply_theme()
render_header("🛳️ Vessels", "Fleet capacity, age, and registry detail")

vessels = query_table("eesea_vessels")
vessels["registry_start_date"] = pd.to_datetime(vessels["registry_start_date"], errors="coerce")
today = pd.Timestamp(dt.date.today())
vessels["age_years"] = (today - vessels["registry_start_date"]).dt.days / 365.25

st.sidebar.header("Filters")
brackets = sorted(vessels["vessel_capacity_nominal_bracket"].dropna().unique().tolist())
selected_brackets = st.sidebar.multiselect("Capacity bracket", options=brackets, default=[])

filtered = vessels[vessels["vessel_capacity_nominal_bracket"].isin(selected_brackets)] if selected_brackets else vessels

c1, c2, c3, c4 = st.columns(4)
with c1: kpi_card("Total Vessels", human_format(len(filtered)), "", 0)
with c2: kpi_card("Total Capacity", human_format(filtered["vessel_capacity_nominal"].sum()) + " TEU", "", 1)
with c3: kpi_card("Avg Vessel Age", f"{filtered['age_years'].mean():.1f} yrs" if filtered["age_years"].notna().any() else "—", "", 2)
with c4: kpi_card("Avg Capacity", human_format(filtered["vessel_capacity_nominal"].mean()) + " TEU", "", 3)

st.divider()

col1, col2 = st.columns(2)
with col1:
    bracket_counts = filtered.groupby("vessel_capacity_nominal_bracket", as_index=False).size().rename(columns={"size": "vessels"})
    bracket_counts = bracket_counts[bracket_counts["vessel_capacity_nominal_bracket"].notna()]
    fig = px.bar(bracket_counts.sort_values("vessels", ascending=False), x="vessel_capacity_nominal_bracket", y="vessels", title="Fleet by Capacity Bracket")
    st.plotly_chart(fig, width="stretch")
with col2:
    fig2 = px.histogram(filtered.dropna(subset=["age_years"]), x="age_years", nbins=30, title="Fleet Age Distribution (years)")
    st.plotly_chart(fig2, width="stretch")

col3, col4 = st.columns(2)
with col3:
    country_counts = filtered.groupby("registry_country_code", as_index=False).size().rename(columns={"size": "vessels"})
    country_counts = country_counts[country_counts["registry_country_code"].notna()].sort_values("vessels", ascending=False).head(15)
    fig3 = px.bar(country_counts, x="registry_country_code", y="vessels", title="Top 15 Flag States")
    st.plotly_chart(fig3, width="stretch")
with col4:
    fig4 = px.scatter(
        filtered.dropna(subset=["vessel_capacity_nominal", "vessel_max_speed"]),
        x="vessel_capacity_nominal", y="vessel_max_speed", opacity=0.4,
        title="Capacity vs. Max Speed", labels={"vessel_capacity_nominal": "Capacity (TEU)", "vessel_max_speed": "Max Speed (kn)"},
    )
    st.plotly_chart(fig4, width="stretch")

st.divider()
st.subheader("Vessel Detail")
st.dataframe(
    filtered[[
        "registry_vessel_name", "vessel_imo", "vessel_capacity_nominal", "vessel_capacity_nominal_bracket",
        "registry_country_code", "age_years", "vessel_max_speed",
    ]].rename(columns={
        "registry_vessel_name": "Vessel", "vessel_imo": "IMO", "vessel_capacity_nominal": "Capacity (TEU)",
        "vessel_capacity_nominal_bracket": "Bracket", "registry_country_code": "Flag", "age_years": "Age (yrs)",
        "vessel_max_speed": "Max Speed (kn)",
    }).sort_values("Capacity (TEU)", ascending=False),
    width="stretch", hide_index=True,
)
