# Expense Anomaly Detector - Python (scikit-learn)

The pro-grade version of the browser demo: real machine learning (IsolationForest) plus deterministic fraud rules, with a Streamlit UI.

## Stack

- **pandas / numpy** - CSV ingestion with flexible column aliases, feature engineering (log amount, within-category z-score, day-of-week, category rarity)
- **scikit-learn IsolationForest** - unsupervised anomaly scoring with adjustable contamination
- **Rule engine** - duplicate charges, suspiciously round amounts, extreme outliers, large weekend spends
- **Streamlit** - upload or sample data, flagged-row table with severity highlighting, score distribution, category breakdown, CSV export

## Run locally

```
pip install -r requirements.txt
streamlit run app.py
```

## Tests

```
python3 tests/test_analyzer.py     # or: python3 -m pytest tests/ -q
```

Covers planted-anomaly recall (a 52,000 coffee, duplicate charges), false-positive rate on clean data, CSV alias parsing, missing-column errors, tiny files, and rule-flag content.

## Honest limits

- IsolationForest flags statistical outliers, not proven fraud; always review flagged rows.
- Small files (under ~50 rows) produce coarse scores.
- The verdict combines ML score and rules; a "high" verdict means both fired.

## Layout

- `analyzer.py` - pure logic (no Streamlit imports), fully unit tested
- `app.py` - Streamlit UI
- `tests/test_analyzer.py` - unit tests
