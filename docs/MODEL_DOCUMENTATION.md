# P1 Energie Contract Analysator — Complete Model Documentation

> **Purpose**: This document comprehensively explains how the P1 Energie Contract Analysator works, including architecture, calculations, assumptions, data handling, and known limitations. For users, start with the website's tooltips and explanations. For developers, read [ENGINEERING_PRACTICES.md](./ENGINEERING_PRACTICES.md). For code review, see [CODE_REVIEW.md](./CODE_REVIEW.md).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Input & Handling](#data-input--handling)
4. [Fiscal Models: 2026 vs 2027](#fiscal-models-2026-vs-2027)
5. [Fixed Contract Calculation](#fixed-contract-calculation)
6. [Dynamic Contract Calculation](#dynamic-contract-calculation)
7. [Hardware Simulations](#hardware-simulations)
8. [EPEX Pricing & Fallbacks](#epex-pricing--fallbacks)
9. [Assumptions](#assumptions)
10. [Known Limitations](#known-limitations)
11. [Data Quality & Validation](#data-quality--validation)
12. [Sources & References](#sources--references)

---

## Overview

The P1 Energie Contract Analysator is a **local web application** that analyzes Dutch residential P1 smart meter data and compares two electricity contracts:

- **Fixed contract (Vaste vergoeding)**: piek/dal tariffs, return-to-grid rate, variable transfer costs (VTK)
- **Dynamic contract (Dynamisch)**: hourly EPEX spot prices + markup + energy tax

The application:
- Imports real consumption profiles from Home Assistant or CSV files
- Calculates both contracts for the same year
- Shows break-even scenarios with optional hardware (EV, battery, heat pump, solar dimming)
- Highlights savings and provides detailed breakdowns

**No data is sent anywhere**—all computation happens locally in the browser.

---

## Architecture

### Technology Stack
- **Pure HTML/CSS/JavaScript**: no frameworks, no external charting libraries
- **ES Modules bundled with esbuild** into a single `app.js` file
- **Vanilla SVG charts** for flexibility and zero dependencies
- **Pub/Sub state management** via `appStore` (domain/store.js)

### Directory Structure
```
src/
├── app.js              — Main controller, UI orchestration, event binding
├── ui/
│   ├── charts.js       — SVG chart rendering (bars, lines, Sankey diagrams)
│   └── dom.js          — Modal windows, tooltips, form helpers
└── domain/
    ├── engine.js       — Core simulation loop (8760 hours)
    ├── energyMath.js   — Hardware models (EV, battery, heat pump, solar)
    ├── parser.js       — HA WebSocket, CSV import, data normalization
    ├── constants.js    — Tariffs, defaults, EPEX profiles
    └── store.js        — State management (append-only mutations)
```

### State Flow
1. **Load data** (HA WebSocket or file upload) → `appStore.setState({ energyData, ... })`
2. **Read configuration** (sliders, toggles) → `readSimConfig()` → returns `cfg` object
3. **Run simulation** → `_simulateCore(cfg, full=true)` → returns breakdown per hour/day/month
4. **Render UI** → `updateUIElements()` + 6 SVG charts from simulation results
5. **Store result** → `activeSimulation` in appStore for re-renders without re-compute

---

## Data Input & Handling

### Data Sources

#### 1. Home Assistant WebSocket (Preferred)
- **Protocol**: WebSocket `recorder/statistics_during_period` query
- **Units**: Import/Export = kWh, Solar = kWh or Wh (auto-detected)
- **Resolution**: Hourly statistics (sum aggregation), supports years of history
- **Advantages**: Live sensor discovery, no manual entity mapping initially, timezone-aware

#### 2. CSV Import
Two formats supported:

**Long format** (entity_id, state, last_changed):
- Auto-detects columns via regex (`*import*`, `*export*`, `*solar*`)
- User maps detected columns to roles (import, export, etc.)
- Default unit: kWh

**Wide format** (timestamp, sensor_1, sensor_2, ...):
- User selects columns and assigns roles
- Supports multiple import/export tariffs (T1/T2 split, optional)
- Converts Wh → kWh automatically

#### 3. Demo Data
- Built-in 8760-hour profile (OPSD Household Data, CC-BY attribution)
- Realistic prosumer profile: ~3200 kWh consumption, ~3600 kWh solar yield
- Loads automatically on first visit for immediate visualization

### Data Normalization (v=79)

**`normalizeToHourly(records, unit="kWh")`** ensures all data is converted to hourly resolution:
- **Sub-hourly** (e.g., 15-minute intervals) → summed per hour (energy conservation)
- **Hourly** → 1-to-1 mapping
- **Daily or coarser** → raises error (insufficient resolution)
- **Gaps & DST**: handled transparently via UTC-hour keys

All imports/exports are thereafter treated as `energyData[hourIndex] = { imp_t1, imp_t2, exp_t1, exp_t2, solar_yield }`

### Data Cleaning (v=29)

**`cleanAndFillEnergyData()`** gatenlos uurreeks over meetperiode `[first, last]`:

1. **Deduplication**: Last entry wins within the same hour
2. **Anomaly removal**: Negative values, > 100 kWh/h, NaN → treated as gaps
3. **Gap filling**:
   - **≤ 6 hours**: Linear interpolation between neighbors
   - **> 6 hours**: Seasonal profile from own data (median day of season + hour)
4. **Output**: `dataQuality` metadata (% completeness, gap types)

**Data Quality Banner** shows when > 2 interpolated hours or > 0 profiled hours.

### Digital Twin (Untangling Hardware) (v=44)

If the user has coupled EV/battery/heat pump sensors to Home Assistant, the P1 meter records **net demand** (house + appliances). To model counterfactuals ("what if I buy a battery?"), the app strips the appliance consumption from the raw P1 data:

**Net-demand-space formula**:
```
baseNet = (rawImport - rawExport) - evLoad - hpLoad - batIn + batOut
baseImport = max(0, baseNet)
baseExport = max(0, -baseNet)
```

Then `solar_yield` remains unchanged. The engine receives the "dumb house" load, and hardware sliders become **replacements** (not additions). This avoids the bruto-EB pitfall of double-counting appliances.

**Caveat**: Sub-hour timing is lost (HA statistics are hourly), so an hour with simultaneous import+export is split at the net boundary.

---

## Fiscal Models: 2026 vs 2027

### Overview (v=77)

Dutch energy law changed Jan 1, 2027:
- **2026**: Saldering (annual netting) for prosumers; lower energy tax
- **2027**: Bruto energy tax on all import; no saldering; higher energy tax (TBD)

The app models both via a selector (`#scenario-year`). The **fiscal year** determines which engine branch executes at the totals stage; the 8760-hour loop is identical.

### 2026 Model — Saldering (Annual Netting)

**Saldering rules**:
- Annual import and export are netted: `net = Σimport − Σexport`
- If `net > 0`: you pay for `net × retailTariff (piek/dal weighted)`
- If `net ≤ 0`: you're a net exporter
  - Within the **saldering limit** (= annual import volume), export is valued at the **retail all-in rate** (incl. BTW + all-in cost recovery)
  - Beyond the limit, overschot gets only the kale EPEX-prijs (`spot/1.21`)
- Energy tax (EB) is applied only to net import (not bruto)
- Return-to-grid rate (VTK) applies to all export (recovery of grid costs)

**Implementation**:
- Annual loop sums `Σimport`, `Σexport`, and per-uur `dynExpRev` (EPEX × all-in valuation within grens)
- Saldering fraction: `salderFrac = min(1, Σimport / Σexport)` pro-rates the all-in-valued export
- Overschot `(1 - salderFrac) × Σexport` is re-valued at spot rate (`Σspot/1.21`)
- Dynamic EB = netto import volume × `liveEnergyTax`

### 2027 Model — Bruto Energy Tax, No Saldering

**Rules**:
- Import and export are **not** netted for billing (each metered separately)
- Energy tax (EB) applies to **all import** (bruto), not net
- Return-to-grid rate applies to all export
- Solargingertarif: prosumers without batteries may receive extra tax breaks (not modeled)

**Implementation**:
- Per hour: accumulate `Σimport` and `Σexport` independently
- Dynamic EB = bruto import × `liveEnergyTax` (no netting)
- Export valued at kale EPEX (`spot/1.21 - exportMarkup`)

---

## Fixed Contract Calculation

### Formula

```
fixedImportCost  = peakImport  × peakRate
                 + dalImport   × dalRate

fixedFeedInCredit = totalExport × feedInRate

fixedVtkCost     = totalExport × feedInFee  (VTK, always ≥ 0)

fixedSubtotal    = fixedImportCost - fixedFeedInCredit + fixedVtkCost
                 + (vastrecht × 12)

fixedTotal       = fixedSubtotal - EB_REBATE_2026 + NETBEHEER_2026
```

### Key Points

1. **Fixed tariffs are all-in** (incl. BTW, EB already baked in by the retailer for 2027)
2. **Peak/Dal split**: defined by retailer (typically 08:00-23:00 peak, rest dal)
3. **VTK (Variable Transfer Costs)**: linearly per kWh exported (no staffel model; see limitations)
4. **Vastrecht**: fixed monthly charge, computed annually (× 12)
5. **EB Rebate (€628,96/year)**: deducted from both contracts (comparison-neutral but realistic)
6. **Grid fees (€480/year)**: added to both (regional operator fee, comparison-neutral)

### Example (Demo Data, 2027)
- Peak import 1,200 kWh @ €0.27 = €324
- Dal import 1,900 kWh @ €0.24 = €456
- Export 800 kWh @ €0.07 = €56 (feed-in credit)
- VTK 800 kWh @ €0.00 = €0
- Vastrecht €7.50 × 12 = €90
- EB rebate −€628,96
- Grid fees +€480
- **Total ≈ €299** per year (actual varies with tariffs/data)

---

## Dynamic Contract Calculation

### Pricing Formula

```
consumerPrice_hr = spot + markup + energyTax

where:
  spot         = EPEX all-in price incl. BTW, excl. EB (€/kWh)
  markup       = supplier surcharge incl. BTW (€/kWh, e.g., 0.024)
  energyTax    = EB incl. BTW (€/kWh, 2027 TBD; default 2026 ≈ 0.11084)
```

All three are **incl. BTW**; no separate 1.21× multiplier.

### Hourly Accumulation

```
for each hour:
  if import > 0:
    dynImpCost += import × (spot + markup)
    dynImpKwh += import  (for EB calculation)
  
  if export > 0:
    dynExpRev += export × max(0, spot/1.21 - exportMarkup)
    (export valued at kale EPEX, not all-in; opslag subtracted)
```

### Annual Totals

```
2027 (Bruto EB):
  dynEB      = dynImpKwh (bruto import) × energyTax
  dynTotal   = (dynImpCost - dynExpRev) + dynEB + vastrecht - ebRebate + gridFees

2026 (Netto EB, Saldering):
  dynEB      = max(0, dynImpKwh - dynExpKwh) × energyTax  (netto)
  (+ saldering logic for export valuation)
```

### Example (Demo Data, 2027)
- Import 3,100 kWh @ avg €0.15 = €465
- Export 800 kWh @ avg €0.05 = €40 (credit)
- EB 3,100 kWh @ €0.11084 = €344
- Vastrecht €6 × 12 = €72
- EB rebate −€628,96
- Grid fees +€480
- **Total ≈ €369** per year

---

## Hardware Simulations

### 1. Battery (Accu) — 3 Modes (v=40)

**Purpose**: Store excess solar or cheap grid electricity; offset expensive hours.

**Modes**:

#### Mode 1: **"Zelf" (Maximaal zelfverbruik)**
- Charge: Only from local solar (no grid)
- Discharge: Only to meet house demand (no grid export)
- **Use case**: Maximize self-consumption ratio, ignore price signals

#### Mode 2: **"Kosten" (Kostenbewust)**
- Charge: From solar + cheapest grid hours (all-in cost ≤ import cost)
- Discharge: To meet house demand, never export
- **Constraint**: Grid charge budgeted to `dayDemand` (no hoarding across days)
- **Use case**: Cost-optimal without export complexity

#### Mode 3: **"Winst" (Maximale winst)**
- Charge: From solar + cheap grid hours
- Discharge: To meet demand + export overschot at profitable prices
- **Gate**: `spot / 1.21 × efficiency > all-in-import-cost` (ensures export revenue > opportunity cost)
- **Reserve**: Export never touches the reserve needed for self-supply
- **Use case**: Full arbitrage

**State-of-charge (SoC) Cap** (v=40):
- `batStoreCap = min(capacity, dayDemand + exportSpace)`
- Prevents hoarding; ensures monotonic benefit (larger capacity never reduces savings)
- **Proven**: `test11_battery_modes.js` validates winst ≥ kosten ≥ zelf

### 2. Electric Vehicle (EV) — Smart Load-Ahead (v=68)

**Profile**: Weekly distance (km) + consumption (kWh/100km)

**Charging strategy** (per-day look-ahead):
1. First, charge from local solar (10h–16h window, depends on season)
2. Then, find cheapest all-in grid hours (incl. all surcharges + EB)
3. **Avoid**: Peak prices, respect overnight availability (commute profile)

**Profiles**:
- **"Home"**: Available all day; can charge anytime
- **"Commuter"**: Away 08:00–17:00 Mon–Fri; charge before/after/weekends

**Solar match**: If > 0%, EV prefers solar hours; if 0%, pure grid-dispatch.

### 3. Heat Pump (Warmtepomp) — Seasonal Load Profile

**Base load** (winter): `#hp-winter-baseload` (kWh on a base 0°C day)

**Seasonal factor** per month:
- Derived from NL HDD (heating degree days, base 18°C, De Bilt normal)
- Winter (Dec–Feb) ≈ 1.0–1.3, summer (Jun–Aug) ≈ 0.15–0.3
- `hpLoad = baseLoad × HDD_factor[month]`

**Consumes solar first** (like EV): `hpFromSolar = min(hpLoad, solar_yield)`, rest from grid.

**Known limitation**: Doesn't align per-day with cold snaps (uses monthly average). Per-day alignment would need KNMI weather data.

### 4. Solar Dimming (Zondimmen) — Price-Responsive

**Trigger**: Negative or low EPEX prices → reduce/stop export.

**Modes**:
- **"Do nothing"**: Ignore price, export all surplus
- **"Dim"**: Omvormer auto-regulates to zero export (but house still gets solar)
- **"Uit"**: Omvormer powered off; house imports all needs from grid

**Reconstruction** (if no solar sensor):
```
houseLoad = import - export + solar  (energy balance)
```

**Cost trade-off**:
- Dimming: Saves grid export fees, but forgoes credit (net zero)
- Off: Buys all from grid (costly), avoids export penalty

**Bruto-EB impact**:
- Dimming/off reduces bruto import → lower EB
- Effect significant when solar is high and prices negative

---

## EPEX Pricing & Fallbacks (3-Tier System)

### Tier 1: Live EPEX Prices
- Sourced from **energyzero.nl** API (yearly history) or **Frank Energie** GraphQL (today)
- All-in price incl. BTW, excl. EB
- Key: ISO hour (YYYY-MM-DDTHH local time, no UTC drift)

### Tier 2: Self-Calibrated Profile (v=24)
- If < 24 hrs of live data: not enough to calibrate
- If ≥ 24 hrs: compute season/hour averages
- Min samples per bucket: 3 (otherwise fall through)
- Fills gaps in measured data

### Tier 3: Seasonal Fallback Profiles
Four profiles (winter, spring, summer, autumn) tuned on NL 2024–25 data:
- Winter avg ≈ €0.12/kWh, summer avg ≈ €0.08/kWh
- Negative ours ~3% (vs 5–10% in high-RES markets)
- Solar capture ratio ≈ 53% (realistic for NL prosumer)

**Data-quality banner** shows which tier is active (green = live, yellow = calibrated, orange = fallback).

---

## Assumptions

### Energy Behavior
1. **Static load profile**: consumption doesn't change across years (no rebound effect, behavior shift)
2. **One year repeats**: data spanning < 365 days is annualized (no multi-year trends modeled)
3. **No demand response** beyond hardware (EV charge timing, solar dimming)
4. **No stochasticity**: deterministic hourly simulation, no Monte Carlo

### Hardware
1. **Battery cycle efficiency**: 90% (round-trip); no degradation modeled in cost, only payback haircut (v=68)
2. **EV consumption**: constant per 100 km (no weather, terrain, driving style variation)
3. **Heat pump COP**: embedded in `baseLoad` assumption (not independently tuned)
4. **Solar dimmer**: 0/1 decision per hour, no ramp-down
5. **No inter-day optimization**: battery discharge decisions ignore next day's weather

### Tariffs
1. **Peak/Dal split**: fixed by retailer, known in advance
2. **Vastrecht (fixed monthly fee)**: linear annual (12× monthly)
3. **Return-to-grid rate**: linearly per kWh (no tiered staffels modeled)
4. **Energy tax 2027**: Unknown; app defaults to 2026 proxy (€0.11084/kWh)
5. **Supplier markups**: Constant per contract, not dynamic

### Grid & Meter
1. **No grid congestion**: all kWh valued at EPEX (no local DSO price caps)
2. **Meter resolution**: 1 hour (DST handled, sub-hour granularity lost)
3. **Frequency**: Assumed 50 Hz; no reactive power penalties

### Data Quality
1. **No sensor drift**: Assumed accurate unless explicitly anomalous (< −1 or > 100 kWh/h)
2. **DST transitions**: Hours added/removed handled transparently
3. **Leap years**: 29 Feb data folded into 28 Feb (no 8760-slot). Measurement data preserved.

---

## Known Limitations

### Modeling

| Issue | Impact | Workaround |
|-------|--------|-----------|
| **VTK linear only** | Doesn't model tiered/staffel fees (Vattenfall, some suppliers) | Choose avg rate; use levelized €/kWh |
| **Per-day breakdown charts show 2027-style valuation** | In 2026 saldering, daily export shown at kale EPEX, not retail all-in | Daily charts are illustrative; annual totals correct |
| **Heat pump doesn't align with real cold snaps** | Uses monthly HDD average; doesn't know if today is hotter/colder | Typical error ±5–10% on monthly HP cost |
| **Battery doesn't optimize across days** | Can't foresee tomorrow's weather/prices; one-pass heuristic | Winst mode is conservative; may leave money on table in extreme spreads |
| **Sub-hour timing lost** | HA data is hourly; sub-hour import+export simultaneously → netted | Typical error < 2% (rare to have sharp minute-level peaks) |
| **Digital Twin assumes hourly sensors exist** | If EV/battery sensors are on different meters (garage, separate property), untangling fails | Requires co-location of meters and sensors |
| **Solar dimming binary (0/1)** | No gradual ramp-down; either full production or zero | Real omvormers can modulate, but model is conservative |

### Data & Inputs

| Issue | Impact | Workaround |
|-------|--------|-----------|
| **EPEX prices unknowable for future** | Can't forecast tomorrow's prices; battery/EV decisions are reactive | Use historical seasonal profile; accept conservatism |
| **Energy tax 2027 not finalized** | Slider defaults to 2026 ≈ €0.11084/kWh; TBD for 2027 | Monitor updates from SBB; manually adjust slider |
| **Retailer tariffs change midyear** | App assumes constant tariff all year | Split data into two runs (pre/post tariff change) |
| **No manual sensor exclusion** | If HA sensor is broken/drifting, must remove from HA before import | Use data-quality badge to spot anomalies; contact HA integration |
| **CSV timezone ambiguous** | If CSV doesn't include TZ info, app assumes local time | Include ISO-formatted timestamps with TZ offset |

### UI/UX

| Issue | Impact | Workaround |
|-------|--------|-----------|
| **Demo data loaded by default** | New users may not realize it's not their data | Banner clearly says "Demo data" and "Upload your own (Stap 1)" |
| **Slider changes don't show results instantly on slow browsers** | Input-event throttled for perf; visual lag possible | Throttle delay is 80 ms; modern browsers handle it |
| **Tooltips can misalign on small screens** | Info icons may appear clipped on mobile | Tooltips reposition; full info always accessible |

---

## Data Quality & Validation

### Completeness Metrics

```javascript
dataQuality = {
  expectedHours,      // 8760 (or less if < 1 year data)
  realHours,          // actually measured (gaps excluded)
  interpHours,        // linearly filled (gap ≤ 6h)
  profileHours,       // seasonally synthesized (gap > 6h)
  completenessPct,    // realHours / expectedHours × 100
  largePeriods: [
    { start, end, hours, fillMethod }  // gaps > 6h
  ]
}
```

**Banner shown if** `profileHours > 0 || interpHours > 2` (1–2 hours of DST/rounding noise is tolerable).

### Anomaly Detection

Flagged and removed (treated as gaps):
- Negative values (meter reset, data error)
- > 100 kWh/h (sensor stuck, multiplied reading)
- NaN (transmission error)

### Validation Tests (npm test)

- **test1_math.js**: Tariff application, BTW handling, EB computation
- **test8_gaps.js**: Gap filling, interpolation vs. profile methods
- **test11_battery_modes.js**: Mode invariants (winst ≥ kosten ≥ zelf), capacity monotonicity
- **test13_logic.js**: Digital Twin untangling, import/export split correctness
- **test19_saldering.js**: 2026 vs 2027 totals, export valuation inside/outside grens
- **test15_snapshot.js**: Golden snapshot (88 assertion points on demo data)

---

## Sources & References

### Data

- **OPSD Household Data** (demo-year.js): Household consumption profile, CC-BY 4.0 attribution
  - Source: https://data.open-power-system-data.org/
  - Normalized to NL prosumer (3200 kWh consumption, 3600 kWh solar)

- **NL Heating Degree Days** (HDD for heat pump): De Bilt normal (KNMI climate station)
  - Monthly factors derived from historical 18°C base

### Energy Markets & Regulations

- **EPEX SPOT NL prices**: Frank Energie GraphQL API + energyzero.nl
- **Saldering 2026 rules**: Jeroen.nl, Vattenfall, Eneco public documentation
- **Energy tax (EB) 2026**: SBB (Sociaal-Economische Raad) rates ≈ €0.1108/kWh incl. BTW
- **VTK (teruglever kosten)**: Leverancier-afhankelijk, typisch €0.00–€0.05/kWh
- **Heffingskorting (EB rebate) 2026**: €628,96/year (SBB, per aansluiting)
- **Netbeheerkosten 2026**: ~€480/year average (Liander, Enexis, Stedin variation)

### Standards & Conventions

- **ISO 8601 week numbering** (isoWeek): Thursday-of-week determines year; used for labels
- **DST handling**: UTC-hour key ensures no ambiguity during spring/autumn transitions
- **BTW (VAT)**: 21% standard rate; incl. in all "all-in" prices cited
- **Energy units**: kWh (kilowatt-hours) for billing; occasionally Wh (watt-hours) from solar sensors

---

## Quick-Start for Analysis

### If you want to understand one scenario:
1. Upload your own P1 data (Stap 1)
2. Set your contract tariffs (Stap 2)
3. Note the green/red savings badge + detailed breakdown table
4. Click the "Hoe werkt het?" buttons for mode-specific explanations

### If you want to validate the math:
1. Read **Fixed Contract Calculation** and **Dynamic Contract Calculation** sections above
2. Run `npm test` to verify against golden snapshot (demo data)
3. Check `_validate/test1_math.js`, `test19_saldering.js` for formulas in code

### If you want to report a bug:
1. Reproduce with demo data (so data is public)
2. Check data-quality banner (data completeness)
3. Verify sliders are at expected values (browser cache can cause stale `app.js`)
4. Open browser console (F12) for errors
5. File issue on GitHub with screenshot + slider values

### If you want to extend the model:
1. Read [ENGINEERING_PRACTICES.md](./ENGINEERING_PRACTICES.md) for development workflow
2. Domain logic is in `src/domain/` (engine.js, energyMath.js, constants.js)
3. UI is in `src/ui/` (charts.js, dom.js)
4. All changes must pass `npm test` (22 tests, incl. golden snapshot)
5. Bump `?v=N` cache-buster on any app.js or style.css change

---

## Glossary

| Term | Definition |
|------|-----------|
| **EPEX** | European Power Exchange; spot market hourly prices for electricity |
| **BTW** | Belasting Toegevoegde Waarde (VAT, 21% standard in NL) |
| **EB** | Energiebelasting (energy tax, per kWh, incl. BTW) |
| **VTK** | Variable Transfer Kosten (per-kWh fee for exporting to grid) |
| **Saldering** | Annual netting of import vs. export (2026 Dutch rule) |
| **Bruto import** | Total import meter reading (incl. all uses) |
| **Netto import** | Bruto import − export (2026 billing basis for EB) |
| **Vastrecht** | Fixed monthly fee (also called "vastrecht" or "connection fee") |
| **Opslag** | Supplier markup on top of EPEX (incl. BTW) |
| **HDD** | Heating Degree Days; proxy for heating need (base 18°C in NL) |
| **DST** | Daylight Saving Time; spring forward = 1h missing, fall back = 1h doubled |
| **Prosumer** | Producer + consumer; household with solar + grid connection |
| **All-in price** | Final consumer price = EPEX + opslag + EB (all incl. BTW) |
| **Kale EPEX** | Raw EPEX price (excl. BTW, EB, opslag) |

---

## Document Version History

- **v=86** (2026-06-10): R3/R4/R6 UI fixes; comprehensive documentation consolidation
- **v=85** (2026-06-10): A11y phase 2 (editable slider badges), touch-friendly tooltips
- **v=79** (2026-06): Saldering 2026 model, import normalization, battery modes
- **v=75** (2026-05): Domain migration to energie.vulpini.nl, path-prefix removal
- Earlier: Battery optimization, heat pump, EV, solar dimming, digital twin, data quality

---

## Contact & Feedback

- **GitHub**: https://github.com/cyleo/P1_dynamisch_vast_vergelijk
- **Live demo**: https://energie.vulpini.nl
- **Issues/Suggestions**: GitHub issue tracker

---

**Last updated**: 2026-06-10 | **Model version**: 86 | **Data retention**: None (local browser only)
