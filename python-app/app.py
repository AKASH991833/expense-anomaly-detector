"""Expense Anomaly Detector - Streamlit UI over analyzer.py."""
import io

import pandas as pd
import streamlit as st

from analyzer import analyze, frame_to_csv, load_csv, sample_frame

st.set_page_config(page_title="Expense Anomaly Detector", page_icon=":mag:", layout="wide")

st.title("Expense Anomaly Detector")
st.caption(
    "IsolationForest machine learning plus deterministic fraud rules, "
    "on your own expense CSV. Nothing leaves this app."
)

with st.sidebar:
    st.header("Data")
    source = st.radio("Source", ["Sample data", "Upload CSV"], index=0)
    contamination = st.slider(
        "Expected anomaly share", 0.01, 0.20, 0.05, 0.01,
        help="IsolationForest contamination parameter - how much of the data to treat as anomalous.",
    )
    st.markdown(
        "**CSV format:** `date, description, amount` (optional `category`). "
        "Flexible column names accepted."
    )

if source == "Upload CSV":
    upload = st.file_uploader("Expense CSV", type=["csv"])
    if upload is None:
        st.info("Upload a CSV to begin, or switch to sample data in the sidebar.")
        st.stop()
    try:
        df = load_csv(io.BytesIO(upload.read()))
    except ValueError as exc:
        st.error(str(exc))
        st.stop()
else:
    df = sample_frame()

result = analyze(df, contamination=contamination)
s = result.summary

c1, c2, c3, c4 = st.columns(4)
c1.metric("Transactions", s["rows"])
c2.metric("Flagged", s["flagged"], delta=f'-{s["flagged_high"]} high risk', delta_color="inverse")
c3.metric("Total spend", f'{s["total_spend"]:,.0f}')
c4.metric("Flagged spend", f'{s["flagged_spend"]:,.0f}')

st.subheader("Flagged transactions")
flag_cols = ["date", "description", "category", "amount", "score", "rule_flags", "verdict"]
flagged = result.frame[result.frame["verdict"] != "ok"][flag_cols]

def highlight(row):
    color = "#f8d7da" if row["verdict"] == "high" else "#fff3cd"
    return [f"background-color: {color}"] * len(row)

if flagged.empty:
    st.success("No anomalies detected at this sensitivity.")
else:
    st.dataframe(
        flagged.style.apply(highlight, axis=1).format(
            {"amount": "{:,.2f}", "score": "{:.3f}", "date": lambda d: d.strftime("%Y-%m-%d %H:%M")}
        ),
        use_container_width=True,
        height=360,
    )
    st.download_button(
        "Download flagged rows (CSV)",
        frame_to_csv(flagged),
        file_name="flagged_expenses.csv",
        mime="text/csv",
    )

left, right = st.columns(2)
with left:
    st.subheader("Anomaly score distribution")
    st.scatter_chart(result.frame, x="date", y="score", color="verdict")
with right:
    st.subheader("Spend by category")
    st.bar_chart(result.by_category.set_index("category")[["spend"]])

with st.expander("All transactions"):
    st.dataframe(
        result.frame[flag_cols].format({"amount": "{:,.2f}", "score": "{:.3f}"}),
        use_container_width=True,
        height=320,
    )

st.caption(
    "Honest limits: IsolationForest flags statistical outliers, not proven fraud - "
    "always review flagged rows before acting. Small files (under ~50 rows) produce coarse scores."
)
