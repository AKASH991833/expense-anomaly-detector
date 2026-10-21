"""Unit tests for analyzer.py - run: python3 -m pytest tests/ -q (or python3 tests/test_analyzer.py)."""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from analyzer import analyze, load_csv, sample_frame  # noqa: E402


def test_sample_planted_anomalies_caught():
    df = sample_frame()
    res = analyze(df)
    high = res.frame[res.frame["verdict"] == "high"]
    # The planted 52,000 coffee must be the top hit.
    top = res.frame.iloc[0]
    assert top["description"] == "Cafe Aroma" and top["amount"] == 52000.0
    assert top["verdict"] == "high"
    # Duplicate GadgetWorld charges both flagged with the duplicate rule.
    dups = res.frame[(res.frame["description"] == "GadgetWorld") & (res.frame["amount"] == 18000.0)]
    assert len(dups) == 2 and dups["rule_flags"].str.contains("duplicate charge").all()
    assert len(high) >= 4


def test_clean_data_low_false_positive_rate():
    import numpy as np
    rng = np.random.default_rng(1)
    df = sample_frame(n=300, seed=3)
    df = df[~df["description"].isin(["Unknown Intl"])]
    df = df[~((df["description"] == "GadgetWorld") & (df["amount"] == 18000.0))]
    df = df[~((df["description"] == "Cafe Aroma") & (df["amount"] == 52000.0))]
    res = analyze(df, contamination=0.05)
    rate = (res.frame["verdict"] == "high").mean()
    assert rate <= 0.05, f"false positive rate {rate:.2%} too high"


def test_csv_aliases_and_parsing():
    csv = "Merchant,Value,Day\nCoffee Shop,245.50,2026-05-01\nRent,15000,2026-05-02\n"
    df = load_csv(io.StringIO(csv))
    assert set(["date", "description", "amount"]).issubset(df.columns)
    assert df["amount"].iloc[1] == 15000


def test_missing_column_error():
    try:
        load_csv(io.StringIO("a,b\n1,2\n"))
        assert False, "should raise"
    except ValueError as exc:
        assert "Missing required column" in str(exc)


def test_tiny_file_robust_path():
    df = sample_frame(n=6, seed=2)
    res = analyze(df)
    assert res.summary["rows"] == len(df)  # sample adds 4 planted rows
    assert set(res.frame["verdict"].unique()) <= {"ok", "review", "high"}


def test_rule_flags_content():
    df = sample_frame()
    res = analyze(df)
    flagged = res.frame[res.frame["rule_flags"] != ""]
    assert len(flagged) > 0
    assert flagged["rule_flags"].str.contains("|".join(
        ["duplicate charge", "round amount", "outlier", "weekend"])).any()


if __name__ == "__main__":
    for name, fn in sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items()):
        fn()
        print(f"PASS {name}")
    print("ALL PASS")
