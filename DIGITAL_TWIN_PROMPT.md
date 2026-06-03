# Implementation Prompt — "Digital Twin" Baseline Untangling

> Paste this whole document into your AI coding agent (Claude Code / Cursor / Antigravity).
> It is self-contained: it includes the exact files, anchors, math rationale, and code.

---

## ROLE & GOAL

You are an expert frontend developer and energy-modeling engineer working on a **client-side, framework-free** JavaScript app (`index.html` + `app.js` + `style.css`). The app fetches historical hourly P1 smart-meter data from Home Assistant over WebSockets and compares a 2027-model **fixed** vs **dynamic** Dutch energy contract via an engine called `_simulateCore`. Today the app treats the historical P1 trace as a "dumb house" and *adds* simulated EV / battery / heat-pump loads on top via UI sliders.

**Upgrade it into a "Digital Twin":** let users who *already own* this hardware map their actual HA device sensors. We then **strip the device usage out of the raw P1 trace** to reconstruct a clean "dumb-house baseline", feed that baseline into the existing `_simulateCore` engine unchanged, and let the sliders model **replacement** hardware (Option b — sliders stay fully free; we only show an informational banner).

### Work on a feature branch
All changes go on the branch `feature/digital-twin-baseline`. Do not commit to `main`.

---

## THE MATH — non-negotiable, this is the crux

**Do NOT untangle in import-space.** A P1 meter only ever shows the *net* of everything behind it: `import = max(0, demand − generation)`. Subtracting a device load directly from `import` produces physically impossible results (negative import) whenever solar was simultaneously feeding that device — the dominant daytime case for prosumers.

**Untangle in net-demand space, then re-split:**

```
raw_import = import_t1 + import_t2          // existing per-hour delta
raw_export = export_t1 + export_t2
net        = raw_import − raw_export        // signed; already embeds solar

base_net   = net − ev_load − hp_load − bat_charge + bat_discharge

base_import = max(base_net, 0)
base_export = max(−base_net, 0)

solar_yield = UNCHANGED                      // PV is independent of EV/HP/battery
```

**Why this is correct:**
- The engine reconstructs house load as `import + max(0, solar − export)` = `net + solar` (see `app.js` ~line 1749-1751). With the formula above, `base_net + solar = base_load` (the true non-hardware load), so `_simulateCore` receives exactly the dumb-house load — **no engine change required**.
- **Round-trip battery loss is handled automatically.** Over a cycle `charge > discharge`; that difference is genuine consumption the dumb house never had, and `− bat_charge + bat_discharge` removes it correctly — *provided both battery sensors are measured at the same electrical boundary* (both grid/AC-side). No efficiency factor.
- **Internal transfers self-cancel.** If the EV charged from the battery, both `ev_load` and `bat_discharge` appear and cancel in `base_net` — no double-counting, no special cases.
- **Removing a solar-fed consumer correctly *increases* export** (because `base_net` goes more negative), which import-space math cannot express.

**Known, acceptable limitation:** hourly resolution loses sub-hour timing, so an hour with both import and export (passing clouds) is split on its net only. This is unavoidable with HA hourly `statistics_during_period` and is far better than import-space. Note it, don't fight it.

**Tariff register is irrelevant to the split:** the engine derives peak/dal from the *timestamp* (`isPeak = dow 1–5 && 7 ≤ h < 23`), not from t1/t2. So write the reconstructed values into `import_t1` / `export_t1` with `t2 = 0`, matching the existing synthesis convention.

---

## TASK 1 — `index.html`: four optional device selects

In `#ha-sensor-picker`, **immediately after the solar `<div class="form-group">…</div>` block** (the one containing `#sel-solar`, ends ~line 456) and **before** the "Periode ophalen" form-group, insert:

```html
<div class="form-group"
  style="margin-bottom:1rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:0.8rem;">
  <label style="font-size:0.78rem; color:var(--accent-cyan); margin-bottom:0.5rem; display:block;">
    ⚙️ Bestaande hardware koppelen (optioneel — Digital Twin)
    <span class="info-icon" tabindex="0">i<span class="info-tooltip">Heb je nu al een EV-lader, warmtepomp
        of thuisbatterij? Koppel hun cumulatieve kWh-sensoren. We <em>strippen</em> dat verbruik uit je P1-historie
        zodat de schuiven hieronder <strong>vervangende</strong> hardware modelleren i.p.v. extra apparaten.
        <br><br><strong>Belangrijk voor de batterij:</strong> kies sensoren die <em>beide</em> aan de
        net-/AC-zijde meten (laden én ontladen op hetzelfde meetpunt), anders klopt het rendementsverlies niet.</span></span>
  </label>

  <label style="font-size:0.74rem; color:var(--text-muted); margin:0.4rem 0 0.2rem; display:block;">🚗 EV-lader (kWh)</label>
  <select id="sel-ev" class="ha-select"><option value="">— Niet koppelen —</option></select>

  <label style="font-size:0.74rem; color:var(--text-muted); margin:0.5rem 0 0.2rem; display:block;">♨️ Warmtepomp (kWh)</label>
  <select id="sel-hp" class="ha-select"><option value="">— Niet koppelen —</option></select>

  <label style="font-size:0.74rem; color:var(--text-muted); margin:0.5rem 0 0.2rem; display:block;">🔋 Batterij — laden / in (kWh)</label>
  <select id="sel-bat-in" class="ha-select"><option value="">— Niet koppelen —</option></select>

  <label style="font-size:0.74rem; color:var(--text-muted); margin:0.5rem 0 0.2rem; display:block;">🔋 Batterij — ontladen / uit (kWh)</label>
  <select id="sel-bat-out" class="ha-select"><option value="">— Niet koppelen —</option></select>
</div>
```

### Digital Twin indicator banner
As the **first child of `<main class="main-dashboard">`** (immediately after that opening tag, ~line 800, above `#intro-explainer`), insert a banner that is hidden by default:

```html
<div id="digital-twin-banner" class="glass-panel"
  style="display:none; margin-bottom:1rem; padding:0.85rem 1.1rem;
         border:1px solid var(--accent-cyan); background:rgba(56,189,248,0.08);">
  <div style="font-family:var(--font-display); font-weight:700; font-size:0.95rem; color:var(--accent-cyan);">
    ⚙️ Digital Twin Mode actief
  </div>
  <div style="font-size:0.82rem; color:var(--text-muted); line-height:1.6; margin-top:0.4rem;">
    Je bestaande <span id="digital-twin-devices">hardware</span> is uit de historische baseline
    <strong>gestript</strong>. De schuiven hieronder modelleren nu <strong>vervangende</strong> hardware,
    geen toevoegingen. Zet een schuif op <strong>nul</strong> om je huis volledig zónder dat apparaat te zien.
  </div>
</div>
```

### Cache-bust
Bump the script tag at the bottom of `index.html`: `app.js?v=33` → **`app.js?v=34`**.

---

## TASK 2 — `app.js`: HA plumbing

### 2a. `handleHAConnect` — populate the four new selects
This function already builds `kwhSensors` and `whSensors` and a `makeOpt(s)` helper for the solar select, plus `allSolarSensors = [...kwhSensors, ...whSensors]` and `window._solarSensorUnitMap`.

- **Rename/generalize the unit map** so device units are available later. Keep `window._solarSensorUnitMap` as-is for backwards compat, but also set:
  ```js
  window._haSensorUnitMap = sensorUnitMap; // same object; covers all kWh + Wh sensors
  ```
- After populating `#sel-solar`, populate the four device selects from `allSolarSensors` (devices may report Wh, e.g. inverters/chargers). Reuse the existing `makeOpt` style with optgroups and `data-unit`. Add a small guess helper and restore saved choices from `localStorage` (`savedSensors` is already parsed):

  ```js
  const guessDev = (sensors, patterns) =>
    (sensors.find(s => patterns.some(p => s.id.toLowerCase().includes(p))) || {}).id || "";

  const fillDeviceSelect = (id, savedVal, patterns) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const selId = savedVal || guessDev(allSolarSensors, patterns);
    const opt = (s) => {
      const label = s.unit === "Wh" ? `${s.id} [Wh → kWh]` : s.id;
      return `<option value="${s.id}" data-unit="${s.unit}"${s.id === selId ? " selected" : ""}>${label}${s.unavailable ? " ⚠ offline" : ""}</option>`;
    };
    sel.innerHTML =
      `<option value="">— Niet koppelen —</option>` +
      (kwhSensors.length ? `<optgroup label="kWh sensoren">` + kwhSensors.map(opt).join("") + `</optgroup>` : "") +
      (whSensors.length ? `<optgroup label="Wh sensoren (omvormers/laders)">` + whSensors.map(opt).join("") + `</optgroup>` : "");
  };

  fillDeviceSelect("sel-ev",      savedSensors.ev,     ["ev", "wallbox", "charger", "laadpaal", "car_charg", "easee", "zaptec", "alfen"]);
  fillDeviceSelect("sel-hp",      savedSensors.hp,     ["heat_pump", "warmtepomp", "heatpump", "hp_", "quatt", "daikin", "wp_"]);
  fillDeviceSelect("sel-bat-in",  savedSensors.batIn,  ["battery_charge", "battery_in", "accu_laden", "bat_charge", "charge_energy"]);
  fillDeviceSelect("sel-bat-out", savedSensors.batOut, ["battery_discharge", "battery_out", "accu_ontladen", "bat_discharge", "discharge_energy"]);
  ```

### 2b. `handleHAImport` — read, persist, fetch, set Twin mode
After the existing `solarSensor` / `solarUnit` block:

```js
const unitOf = (entId) => (window._haSensorUnitMap?.[entId]) ||
  document.querySelector(`#sel-ev option[value="${CSS.escape(entId)}"]`)?.dataset?.unit || "kWh";

const evSensor    = document.getElementById("sel-ev")?.value || "";
const hpSensor    = document.getElementById("sel-hp")?.value || "";
const batInSensor = document.getElementById("sel-bat-in")?.value || "";
const batOutSensor= document.getElementById("sel-bat-out")?.value || "";
```

- Add any non-empty device sensors to the `entities` array (so they are fetched by `fetchHAStatisticsWS`). Deduplicate (a user could map the same entity twice — harmless, but `[...new Set(entities)]` is tidy).
- Extend the `localStorage.setItem("ha_sensors", …)` object with `ev, hp, batIn, batOut` (and optionally their units).
- Extend `roleMap`:
  ```js
  ev: evSensor,       evUnit: unitOf(evSensor),
  hp: hpSensor,       hpUnit: unitOf(hpSensor),
  batIn: batInSensor, batInUnit: unitOf(batInSensor),
  batOut: batOutSensor, batOutUnit: unitOf(batOutSensor),
  ```
- After `energyData = processHAStatistics(stats, roleMap);`, set Digital Twin state and update the banner + battery sanity warning (see Task 4).

### Backwards compat
All four roles are optional. If none are mapped, `processHAStatistics` must produce byte-identical output to today (device loads = 0 → `base_net = net` → `base_import/base_export = raw_import/raw_export`). Verify this.

---

## TASK 3 — `app.js`: net-space untangling in `processHAStatistics`

Inside the `for` loop, the existing `delta(ent, maxVal)` and `deltaSolar` helpers stay. Add a unit-aware device helper and replace the `records.push({…})` so import/export come from the reconstruction. Keep `solar_yield` exactly as computed.

```js
// kWh delta for an arbitrary device sensor, Wh-aware (chargers/inverters report Wh)
const deviceKwh = (ent, unit) => {
  if (!ent) return 0;
  const d = delta(ent, unit === "Wh" ? 20000 : 100);
  return unit === "Wh" ? d / 1000 : d;
};

const evLoad  = deviceKwh(roleMap.ev,     roleMap.evUnit);
const hpLoad  = deviceKwh(roleMap.hp,     roleMap.hpUnit);
const batIn   = deviceKwh(roleMap.batIn,  roleMap.batInUnit);
const batOut  = deviceKwh(roleMap.batOut, roleMap.batOutUnit);

const rawImp = delta(roleMap.imp1) + delta(roleMap.imp2);
const rawExp = delta(roleMap.exp1) + delta(roleMap.exp2);

// Untangle in NET-DEMAND space, then re-split into import/export.
const netDemand = rawImp - rawExp;
const baseNet   = netDemand - evLoad - hpLoad - batIn + batOut;
const baseImport = Math.max(0,  baseNet);
const baseExport = Math.max(0, -baseNet);

// Accumulate for the battery-boundary sanity check (Task 3b)
totBatIn  += batIn;
totBatOut += batOut;
hasDeviceMap = hasDeviceMap || !!(roleMap.ev || roleMap.hp || roleMap.batIn || roleMap.batOut);

records.push({
  timestamp: new Date(curr).toISOString(),
  import_t1: baseImport, import_t2: 0,   // all into t1; engine derives peak/dal from timestamp
  export_t1: baseExport, export_t2: 0,
  solar_yield: solarYieldKwh,
});
```

Declare `let totBatIn = 0, totBatOut = 0, hasDeviceMap = false;` near the top of `processHAStatistics` (before the loop).

### 3b. Battery boundary sanity check
After the loop, attach untangle metadata to the returned array so the caller can warn the user:

```js
records.untangle = {
  active: hasDeviceMap,
  batIn: totBatIn, batOut: totBatOut,
  // A real battery loses energy: discharge must be < charge. If not, sensors are
  // likely swapped or measured on different boundaries (one DC, one AC).
  batterySensorSuspect: (totBatIn > 0 || totBatOut > 0) && totBatOut > totBatIn * 1.05,
  devices: {
    ev: !!roleMap.ev, hp: !!roleMap.hp,
    battery: !!(roleMap.batIn || roleMap.batOut),
  },
};
return records;
```

---

## TASK 4 — `app.js`: Option (b) UI state (sliders stay free)

Sliders are **not** touched — the stripped baseline already removed the real hardware, so the engine *adding* slider hardware on top correctly models a replacement (slider = 0 → house without the device). Only show the banner + any warning.

Add a helper and call it from `handleHAImport` right after `processHAStatistics`:

```js
function updateDigitalTwinBanner(meta) {
  const banner = document.getElementById("digital-twin-banner");
  if (!banner) return;
  window.digitalTwinMode = meta && meta.active ? meta : null;
  if (!meta || !meta.active) { banner.style.display = "none"; return; }

  const names = [];
  if (meta.devices.ev) names.push("elektrische auto");
  if (meta.devices.hp) names.push("warmtepomp");
  if (meta.devices.battery) names.push("thuisbatterij");
  const human = names.length === 1 ? names[0]
    : names.slice(0, -1).join(", ") + " en " + names.slice(-1);
  const el = document.getElementById("digital-twin-devices");
  if (el) el.textContent = human || "hardware";
  banner.style.display = "block";
}
```

In `handleHAImport`, after `energyData = processHAStatistics(stats, roleMap);`:

```js
const untangle = energyData.untangle || { active: false };
updateDigitalTwinBanner(untangle);
if (untangle.batterySensorSuspect) {
  statusEl.innerHTML =
    "⚠ Batterij-sensoren controleren: ontladen > laden over de hele periode is fysiek onmogelijk. " +
    "Kies sensoren die beide aan de net-/AC-zijde meten (of verwissel in/uit).";
  statusEl.style.color = "var(--accent-orange)";
  // continue anyway; the simulation still runs
}
```

> `window.digitalTwinMode` is now available to any other UI code (e.g. to badge the hardware section). Optional nicety, not required.

---

## TASK 5 — Docs & validation

1. **`CLAUDE.md`**: bump "Huidige versie" to `app.js?v=34`; set "Volgende aanpassing" to `v=35`. Add a short subsection documenting Digital Twin baseline untangling (net-space formula, the four `sel-*` IDs, `roleMap` keys `ev/hp/batIn/batOut` + `*Unit`, the `records.untangle` metadata, and the `#digital-twin-banner` / `window.digitalTwinMode` state). Add a "Bekende valkuilen" row: *"Device untangling in import-space gaf negatieve import bij gelijktijdige zon → opgelost door net-demand-space + re-split."*
2. **`_validate/`**: add `test10_untangle.js` (mirror the style of the existing `_validate/test*` harnesses — run logic via `vm` if they do). Assert, on a synthetic hour set:
   - sunny hour `{import:0, export:0, ev:3, solar:4}` → `baseImport 0, baseExport 3`;
   - battery-only hour `{import:0, export:0, batIn:2, batOut:0}` → `baseImport 2, baseExport 0` (charge re-appears as baseline grid draw);
   - night EV `{import:3, export:0, ev:3}` → `baseImport 0`;
   - no devices → identical to raw;
   - `batterySensorSuspect` true when Σout > Σin.

---

## ACCEPTANCE CHECKLIST
- [ ] On branch `feature/digital-twin-baseline`.
- [ ] Four optional selects render in `#ha-sensor-picker`, populate from kWh+Wh sensors, auto-guess, and persist via `localStorage`.
- [ ] Selected device entities are fetched (added to `entities`) and reach `processHAStatistics` via `roleMap`.
- [ ] Wh sensors are divided by 1000 (Wh-aware `maxVal` guard).
- [ ] Untangling is **net-space + re-split**, written to `import_t1`/`export_t1` (t2=0), `solar_yield` untouched.
- [ ] No devices mapped → output identical to current behavior.
- [ ] Battery sanity warning fires when Σdischarge > Σcharge.
- [ ] `#digital-twin-banner` shows the exact copy with a dynamic device list; `window.digitalTwinMode` set.
- [ ] Sliders remain free (Option b); engine unchanged.
- [ ] `app.js?v=34` in `index.html`; `CLAUDE.md` updated; `_validate/test10_untangle.js` passes.

## SMOKE TEST
Serve under the `/energie/` prefix (the app loads assets from there — use a temporary `energie -> .` symlink). Map a P1 set + a battery in/out pair, import, and confirm: the banner appears, baseline import rises in hours the battery had discharged, and totals stay finite/non-negative.
