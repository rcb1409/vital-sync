# VitalSync Anomaly Detection Design

## Research Summary: What the Industry Uses

### Platform Comparison

| Platform | Primary Method | Baseline Window | Key Metrics | Anomaly Approach |
|----------|---------------|-----------------|-------------|------------------|
| **WHOOP** | Personal baseline comparison | 14-day rolling | HRV (RMSSD), RHR, Sleep, RR | Compare to personal 14-day baseline, proprietary weighting |
| **Oura** | Weighted personal baseline | 14-day (recent weighted) vs 2-month | HRV (mean of 5-min samples), RHR, Temp, Recovery Index | Recent 14-day avg vs 2-month baseline, recent days weighted more |
| **Garmin (Firstbeat)** | ANS state modeling | Individual physiological model | HRV, HR, VO2, EPOC, Respiration | Neural network + decision trees on HRV to detect stress/recovery states |
| **Apple Watch** | Threshold + confirmation cascade | N/A (clinical thresholds) | HRV (SDNN), HR, Tachograms | 5/6 irregular readings in 48hrs triggers alert |
| **Polar** | Personal baseline | Rolling window | HRV, RHR, Sleep | ANS charge score (-10 to +10) |

### Key Findings

1. **All platforms use personal baselines, not population averages**
   - WHOOP: 14-day rolling baseline
   - Oura: 14-day weighted average vs 2-month baseline
   - Garmin: Individual physiological model built from user's data

2. **HRV is the primary signal** (86% of wearables use it)
   - WHOOP: RMSSD during deepest sleep
   - Oura: Mean of 5-minute samples throughout sleep
   - Apple: SDNN from tachograms
   - Garmin: Time-domain + frequency-domain (RMSSD, HFP, LFP)

3. **Statistical methods dominate, not ML**
   - Personal mean ± standard deviation comparisons
   - Rolling windows (14-21 days typical)
   - Recent data weighted more heavily (exponential weighting)
   - Thresholds based on personal variance, not fixed percentages

4. **Multi-metric correlation matters**
   - Low HRV + High RHR + Poor Sleep = stronger signal than any single metric
   - Garmin uses decision trees to combine multiple signals

---

## Recommended Design for VitalSync

### Tier 1: Statistical Anomaly Detection (Primary)

#### Method: Modified Z-Score with Rolling Baseline

```
Z = (current_value - rolling_mean) / rolling_std

Where:
- rolling_mean = EWMA of last 14 days (α = 0.3 for recent weighting)
- rolling_std = rolling standard deviation of last 14 days
```

#### Thresholds (Based on Industry Research)

| Metric | Warning (Yellow) | Alert (Red) | Direction |
|--------|-----------------|-------------|-----------|
| HRV | Z < -1.5 | Z < -2.5 | Lower is worse |
| Resting HR | Z > 1.5 | Z > 2.5 | Higher is worse |
| Sleep Score | Z < -1.5 | Z < -2.5 | Lower is worse |
| Sleep Duration | Z < -1.5 | Z < -2.5 | Lower is worse |
| Steps | Z < -2.0 | Z < -3.0 | Lower is worse (less sensitive) |

#### Why These Thresholds?
- **1.5σ** = ~13% of readings would naturally fall here (moderate concern)
- **2.5σ** = ~1% of readings would naturally fall here (significant concern)
- Oura uses similar logic: RHR contributor drops if 3-5 BPM above average
- WHOOP color zones roughly map to similar statistical boundaries

### Tier 2: Trend Detection (CUSUM)

Detect gradual shifts that don't trigger single-day anomalies.

```
CUSUM = Σ (x_i - target - allowance)

Where:
- target = personal 30-day baseline mean
- allowance = 0.5 * personal_std (to ignore normal noise)
- Alert when CUSUM exceeds 4 * personal_std
```

**Use case**: HRV declining 2ms/day for 2 weeks won't trigger Z-score alert, but CUSUM catches the trend.

### Tier 3: Multi-Metric Correlation (Compound Anomalies)

Based on Garmin/Firstbeat's approach of combining signals:

| Compound Anomaly | Conditions | Severity |
|-----------------|------------|----------|
| **Overtraining Risk** | HRV Z < -1.0 AND RHR Z > 1.0 AND workouts ≥ 5 in 7 days | Alert |
| **Illness Indicator** | RHR Z > 2.0 AND HRV Z < -1.5 AND (temp elevated OR sleep poor) | Alert |
| **Recovery Deficit** | Sleep Z < -1.0 for 3+ consecutive days AND HRV declining | Warning |
| **Burnout Pattern** | HRV trend declining AND sleep efficiency declining AND RHR trend rising | Warning |

### Tier 4: Contextual Adjustments

Based on Oura's approach of weighting recent data more:

```typescript
// Exponentially Weighted Moving Average
ewma_t = α * current_value + (1 - α) * ewma_{t-1}

// α = 0.3 means:
// - Today: 30% weight
// - Yesterday: 21% weight  
// - 2 days ago: 15% weight
// - 7 days ago: 3% weight
```

**Day-of-week adjustment** (optional, advanced):
- Many people have lower HRV on Mondays (weekend recovery)
- Compare to same-day-of-week baseline for more accuracy

---

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW DATA ARRIVES                             │
│              (Sleep, HRV, RHR, Steps, etc.)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              BASELINE CALCULATION SERVICE                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ For each metric:                                         │   │
│  │   1. Fetch last 14-30 days of data                       │   │
│  │   2. Calculate EWMA mean (α = 0.3)                       │   │
│  │   3. Calculate rolling std dev                           │   │
│  │   4. Store in HealthSummary table                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STATISTICAL ANOMALY DETECTOR                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ For each metric:                                         │   │
│  │   1. Calculate Z-score: (value - ewma_mean) / rolling_std│   │
│  │   2. Check against thresholds                            │   │
│  │   3. Generate anomaly if threshold exceeded              │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              COMPOUND ANOMALY DETECTOR                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Check multi-metric patterns:                             │   │
│  │   - Overtraining: HRV↓ + RHR↑ + high training load       │   │
│  │   - Illness: RHR↑↑ + HRV↓ + temp↑                        │   │
│  │   - Recovery deficit: consecutive poor sleep + HRV↓      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              TREND DETECTOR (CUSUM)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ For each metric:                                         │   │
│  │   1. Calculate cumulative deviation from baseline        │   │
│  │   2. Alert if sustained drift detected                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              ANOMALY OUTPUT                                     │
│  {                                                              │
│    type: "hrv_drop",                                            │
│    severity: "warning",                                         │
│    zScore: -2.1,                                                │
│    message: "Your HRV is 2.1σ below your personal average",     │
│    data: { current: 35, baseline: 52, std: 8 }                  │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Requirements

### Minimum Data for Reliable Baselines
- **14 days**: Minimum for basic anomaly detection (per Oura, WHOOP)
- **21 days**: Recommended for stable baselines (per research)
- **30 days**: Ideal for trend detection

### Handling New Users (Cold Start)
1. **Days 1-7**: Use population-based thresholds (conservative)
2. **Days 8-14**: Blend population + personal (50/50)
3. **Days 15+**: Full personal baseline

---

## Why NOT Machine Learning (Yet)

| Factor | Statistical Approach | ML Approach |
|--------|---------------------|-------------|
| Data needed | 14-30 days | 1000+ samples |
| Interpretability | "2.1σ below your average" | "Model says anomaly" |
| Cold start | Works with population fallback | Needs training data |
| Compute | Runs on server in ms | May need GPU |
| Maintenance | No retraining needed | Needs periodic retraining |

**When ML makes sense for VitalSync (future)**:
- Population-level anomaly detection ("unusual compared to similar users")
- Multivariate pattern recognition across 5+ metrics
- Predictive anomalies ("you're likely to get sick in 2 days")
- Labeled data from user feedback ("I was actually sick")

---

## Summary: VitalSync Anomaly Detection Stack

| Layer | Method | Purpose |
|-------|--------|---------|
| **Primary** | Z-Score with EWMA baseline | Single-metric anomalies |
| **Secondary** | Compound rules | Multi-metric patterns |
| **Tertiary** | CUSUM | Gradual trend detection |
| **Future** | Isolation Forest | Multivariate anomalies (when data permits) |

This design mirrors what WHOOP, Oura, and Garmin actually use — statistical methods on personal baselines — while being transparent and interpretable.
