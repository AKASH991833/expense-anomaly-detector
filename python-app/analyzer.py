"""Expense anomaly detection: IsolationForest + deterministic rule flags.

Pure-logic module, no Streamlit imports, so it can be unit tested directly.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

REQUIRED_COLUMNS = {"date", "description", "amount"}


@dataclass
class AnalysisResult:
    frame: pd.DataFrame            # original columns + score, ml_flag, rule_flags, verdict
    summary: dict                  # headline numbers
    by_category: pd.DataFrame      # per-category aggregation
    error: str | None = None


def load_csv(source: str | io.BytesIO | io.StringIO) -> pd.DataFrame:
    """Parse an expense CSV. Accepts flexible column naming."""
    df = pd.read_csv(source)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    aliases = {
        "merchant": "description", "vendor": "description", "payee": "description",
        "memo": "description", "name": "description",
        "value": "amount", "cost": "amount", "debit": "amount", "price": "amount",
        "day": "date", "timestamp": "date", "datetime": "date",
        "type": "category", "tag": "category", "group": "category",
    }
    df = df.rename(columns={c: aliases[c] for c in df.columns if c in aliases})
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required column(s): {', '.join(sorted(missing))}")
    df["date"] = pd.to_datetime(df["date"], errors="coerce", dayfirst=False)
    df["amount"] = pd.to_numeric(
        df["amount"].astype(str).str.replace(r"[^\d.\-]", "", regex=True), errors="coerce"
    )
    df["description"] = df["description"].astype(str).str.strip()
    if "category" not in df.columns:
        df["category"] = "uncategorized"
    df["category"] = df["category"].astype(str).str.strip().str.lower().replace("", "uncategorized")
    df = df.dropna(subset=["date", "amount"]).reset_index(drop=True)
    if df.empty:
        raise ValueError("No valid rows after parsing (check date and amount formats).")
    return df


def _features(df: pd.DataFrame) -> np.ndarray:
    """Feature matrix: log amount, within-category z-score, day of week, category rarity."""
    log_amt = np.log10(df["amount"].clip(lower=0.01))
    cat_mean = df.groupby("category")["amount"].transform("mean")
    cat_std = df.groupby("category")["amount"].transform("std").fillna(0.0)
    z_within = (df["amount"] - cat_mean) / cat_std.replace(0, np.nan)
    z_within = z_within.fillna(0.0).clip(-10, 10)
    dow = df["date"].dt.dayofweek / 6.0
    cat_freq = df["category"].map(df["category"].value_counts(normalize=True))
    return np.column_stack([log_amt, z_within, dow, -cat_freq])


def _rule_flags(df: pd.DataFrame) -> pd.Series:
    """Deterministic red flags, returned as a Series of comma-joined labels."""
    flags: list[pd.Series] = []
    dup_mask = df.duplicated(subset=["description", "amount"], keep=False)
    flags.append(pd.Series(np.where(dup_mask, "duplicate charge", ""), index=df.index))
    round_mask = (df["amount"] >= 1000) & (df["amount"] % 1000 == 0)
    flags.append(pd.Series(np.where(round_mask, "suspiciously round amount", ""), index=df.index))
    p99 = df["amount"].quantile(0.99)
    big_mask = df["amount"] >= max(p99, df["amount"].median() * 20)
    flags.append(pd.Series(np.where(big_mask, "extreme outlier amount", ""), index=df.index))
    weekend_mask = (df["date"].dt.dayofweek >= 5) & (df["amount"] > df["amount"].median() * 5)
    flags.append(pd.Series(np.where(weekend_mask, "large weekend spend", ""), index=df.index))
    out = flags[0]
    for f in flags[1:]:
        out = out.str.cat(f, sep=", ")
    return out.str.replace(r"^(, )+|(, )+$", "", regex=True).str.replace(r"(, ){2,}", ", ", regex=True)


def analyze(df: pd.DataFrame, contamination: float = 0.05, random_state: int = 42) -> AnalysisResult:
    """Run IsolationForest + rules. contamination = expected anomaly share (0.01-0.2)."""
    contamination = float(min(max(contamination, 0.01), 0.2))
    result = df.copy()
    if len(result) >= 8:
        model = IsolationForest(
            n_estimators=200, contamination=contamination, random_state=random_state
        )
        labels = model.fit_predict(_features(result))
        scores = -model.score_samples(_features(result))
        result["score"] = scores
        result["ml_flag"] = labels == -1
    else:
        # Too few rows for a meaningful forest: score by robust z only.
        med, mad = result["amount"].median(), (result["amount"] - result["amount"].median()).abs().median()
        rz = (result["amount"] - med) / (1.4826 * mad) if mad > 0 else pd.Series(0.0, index=result.index)
        result["score"] = rz.clip(lower=0)
        result["ml_flag"] = result["score"] > 3.5
    result["rule_flags"] = _rule_flags(result)
    result["verdict"] = np.where(
        result["ml_flag"] & (result["rule_flags"] != ""), "high",
        np.where(result["ml_flag"] | (result["rule_flags"] != ""), "review", "ok"),
    )
    result = result.sort_values("score", ascending=False).reset_index(drop=True)
    flagged = result[result["verdict"] != "ok"]
    summary = {
        "rows": int(len(result)),
        "flagged": int(len(flagged)),
        "flagged_high": int((result["verdict"] == "high").sum()),
        "total_spend": float(result["amount"].sum()),
        "flagged_spend": float(flagged["amount"].sum()),
        "largest_single": float(result["amount"].max()),
        "date_min": str(result["date"].min().date()),
        "date_max": str(result["date"].max().date()),
    }
    by_cat = (
        result.groupby("category")
        .agg(rows=("amount", "size"), spend=("amount", "sum"),
             flagged=("verdict", lambda s: int((s != "ok").sum())))
        .sort_values("spend", ascending=False)
        .reset_index()
    )
    return AnalysisResult(frame=result, summary=summary, by_category=by_cat)


def sample_frame(n: int = 220, seed: int = 7) -> pd.DataFrame:
    """Synthetic-but-plausible expense history with a few planted anomalies."""
    rng = np.random.default_rng(seed)
    cats = {
        "groceries": (300, 2500), "dining": (150, 1800), "transport": (50, 900),
        "utilities": (400, 3200), "shopping": (500, 8000), "subscriptions": (99, 1499),
    }
    names = {
        "groceries": ["FreshMart", "DailyNeeds", "GreenGrocer"],
        "dining": ["Cafe Aroma", "Spice Route", "Noodle House"],
        "transport": ["Metro Card", "City Cab", "Fuel Stop"],
        "utilities": ["Power Board", "Water Utility", "FiberNet"],
        "shopping": ["StyleHub", "GadgetWorld", "BookNook"],
        "subscriptions": ["StreamBox", "CloudStore", "FitApp"],
    }
    rows = []
    start = pd.Timestamp("2026-04-01")
    for i in range(n):
        cat = rng.choice(list(cats))
        lo, hi = cats[cat]
        amt = float(np.exp(rng.uniform(np.log(lo), np.log(hi))))
        rows.append({
            "date": start + pd.Timedelta(days=int(rng.integers(0, 150)), hours=int(rng.integers(8, 22))),
            "description": rng.choice(names[cat]),
            "amount": round(amt, 2),
            "category": cat,
        })
    planted = [
        {"date": pd.Timestamp("2026-06-14 03:12"), "description": "Cafe Aroma", "amount": 52000.0, "category": "dining"},
        {"date": pd.Timestamp("2026-07-02 11:40"), "description": "GadgetWorld", "amount": 18000.0, "category": "shopping"},
        {"date": pd.Timestamp("2026-07-02 11:41"), "description": "GadgetWorld", "amount": 18000.0, "category": "shopping"},
        {"date": pd.Timestamp("2026-08-23 14:05"), "description": "Unknown Intl", "amount": 9600.0, "category": "shopping"},
    ]
    rows.extend(planted)
    df = pd.DataFrame(rows).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return df


def frame_to_csv(df: pd.DataFrame) -> str:
    return df.to_csv(index=False)
