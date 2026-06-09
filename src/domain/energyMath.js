import { EV_MAX_CHARGE_KW, HEATPUMP_HDD_FACTOR } from "./constants.js";
// NB: de precompute-helpers hieronder roepen getFallbackSpot() aan, dat in engine.js leeft.
// Bewust GEEN `import { getFallbackSpot } from "./engine.js"`: dat introduceert een cirkel-
// import (engine importeert deze module) die esbuild's symbool-resolutie verstoort en
// gelijknamige functies in andere modules (bv. _updateSimHeader in charts.js) laat sneuvelen.
// In de gebundelde IIFE-scope is de gehoiste getFallbackSpot gewoon bereikbaar.

/** Zero-pads a number to 2 digits — used in date key construction. */
const p2 = n => String(n).padStart(2, "0");

/**
 * Lazily computes and caches local datetime metadata for a given row.
 * Essential to avoid repetitive Date parsing in 8760-hour loops.
 */
export function rowMeta(row) {
  if (row._meta) return row._meta;
  const dt = new Date(row.timestamp);
  const mo = dt.getMonth() + 1, da = dt.getDate(), h = dt.getHours();
  const dayKey = `${dt.getFullYear()}-${p2(mo)}-${p2(da)}`;
  const meta = { hour: h, date: da, month: mo, dow: dt.getDay(), dayKey, epexKey: `${dayKey}T${p2(h)}` };
  Object.defineProperty(row, "_meta", { value: meta, enumerable: false, configurable: true });
  return meta;
}

/**
 * Formats a Date object into a reliable ISO-hour string for EPEX lookup.
 */
export function epexKey(dt) {
  return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}T${p2(dt.getHours())}`;
}

/**
 * All-in consumentenprijs (Pad 1): spot en opslag zijn beide incl. BTW.
 * Pure functie — lees markup en tax eenmalig voor de loop en geef ze door.
 * @param {number} spot   - EPEX spot incl. BTW, excl. EB (€/kWh)
 * @param {number} markup - Inkoop-opslag incl. BTW (€/kWh)
 * @param {number} tax    - Energiebelasting (€/kWh)
 */
export function toConsumerPrice(spot, markup, tax) {
  return spot + markup + tax;
}

/**
 * Maps a given month (1-12) to its meteorological season.
 */
export function seasonOf(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/**
 * Pre-computes EV charging schedules per day for both dynamic and fixed contracts.
 * Matches solar excess first, then sorts remaining load into cheapest hours.
 */
export function precomputeEVSchedules(cfg, ctx, dayRows, markupBtw) {
  const { hasEv, evWeeklyDist, evConsumption, evSolarMatch, evProfile, stressMultiplier = 1.0, fixedPeakRate, fixedDalRate } = cfg;
  const { epexHistory, eb } = ctx;
  const evScheduleCacheDyn = {};
  const evScheduleCacheFx = {};

  if (!hasEv) return { evScheduleCacheDyn, evScheduleCacheFx };
  const evDailyKwh = (evWeeklyDist * evConsumption) / 7.0;
  if (evDailyKwh <= 0) return { evScheduleCacheDyn, evScheduleCacheFx };

  Object.keys(dayRows).forEach(dk => {
    const rowsOfDay = dayRows[dk];

    const unavailable = r => {
      if (evProfile !== "commuter") return false;
      const { dow, hour } = rowMeta(r);
      return dow > 0 && dow < 6 && hour >= 8 && hour <= 17;
    };

    const baseSched = () => {
      const s = Array.from({ length: 24 }, () => ({ grid: 0, solar: 0 }));
      let remNeed = evDailyKwh;
      if (evSolarMatch) {
        for (const r of rowsOfDay) {
          if (remNeed <= 0) break;
          if (unavailable(r)) continue;
          const h = rowMeta(r).hour;
          if (h < 10 || h > 16) continue;
          const rawExpH = (r.export_t1 || 0) + (r.export_t2 || 0);
          const charge = Math.min(rawExpH, EV_MAX_CHARGE_KW, remNeed);
          if (charge > 0) { s[h].solar += charge; remNeed -= charge; }
        }
      }
      return { s, remNeed };
    };

    const dynTarget = baseSched();
    if (dynTarget.remNeed > 0) {
      const sortedDyn = rowsOfDay.filter(r => !unavailable(r)).map(r => {
        const { hour, month, epexKey: k } = rowMeta(r);
        let sp = epexHistory.has(k) ? epexHistory.get(k) : getFallbackSpot(month, hour);
        if (sp > 0 && stressMultiplier !== 1.0) sp *= stressMultiplier;
        return { h: hour, cost: sp + markupBtw + eb };
      }).sort((a, b) => a.cost - b.cost);

      for (const { h } of sortedDyn) {
        if (dynTarget.remNeed <= 0) break;
        const room = EV_MAX_CHARGE_KW - (dynTarget.s[h].solar + dynTarget.s[h].grid);
        const charge = Math.min(dynTarget.remNeed, room);
        if (charge > 0) { dynTarget.s[h].grid += charge; dynTarget.remNeed -= charge; }
      }
    }
    evScheduleCacheDyn[dk] = dynTarget.s;

    const fxTarget = baseSched();
    if (fxTarget.remNeed > 0) {
      const sortedFx = rowsOfDay.filter(r => !unavailable(r)).map(r => {
        const { hour, dow } = rowMeta(r);
        const isPeakHour = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
        return { h: hour, cost: isPeakHour ? fixedPeakRate : fixedDalRate };
      }).sort((a, b) => a.cost - b.cost);

      for (const { h } of sortedFx) {
        if (fxTarget.remNeed <= 0) break;
        const room = EV_MAX_CHARGE_KW - (fxTarget.s[h].solar + fxTarget.s[h].grid);
        const charge = Math.min(fxTarget.remNeed, room);
        if (charge > 0) { fxTarget.s[h].grid += charge; fxTarget.remNeed -= charge; }
      }
    }
    evScheduleCacheFx[dk] = fxTarget.s;
  });

  return { evScheduleCacheDyn, evScheduleCacheFx };
}

/**
 * Pre-computes battery boundary values (store capacity, reserve) per day.
 * Determines when to charge from the grid vs discharge based on daily EPEX spreads.
 */
export function precomputeBatterySchedule(cfg, ctx, dayRows, markupBtw, exportMarkup, gridCharge, gridExport) {
  const {
    hasBattery, batCapacity, batPower, batEfficiency, stressMultiplier = 1.0,
    hasHeatPump, hpWinterBaseload, hasEv, evWeeklyDist, evConsumption,
  } = cfg;
  const { epexHistory, eb } = ctx;
  const batChargeHrs = {};
  const batDischargeHrs = {};
  const batDayMinAllin = {};
  const batGridBudget = {};
  const batStoreCap = {};
  const batSelfReserve = {};

  if (!hasBattery || batCapacity <= 0 || batPower <= 0) {
    return { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve };
  }

  const K = Math.max(1, Math.min(10, Math.round(batCapacity / batPower)));
  // EV daily target is a flat per-day figure; computed once outside the loop.
  const evDay = hasEv ? (evWeeklyDist * evConsumption) / 7.0 : 0;

  Object.keys(dayRows).forEach(dk => {
    const dayRowsArr = dayRows[dk];
    const loadDay = dayRowsArr.reduce((s, r) => s + r.import_t1 + r.import_t2, 0);
    const solarDay = dayRowsArr.reduce((s, r) => s + r.export_t1 + r.export_t2, 0);

    // Include HP and EV loads so the battery is allowed to store enough to cover them.
    let hpDay = 0;
    if (hasHeatPump) {
      for (const r of dayRowsArr) {
        const { month, hour } = rowMeta(r);
        hpDay += applyHeatPumpLoad(true, hpWinterBaseload, month, hour);
      }
    }
    const selfNeed = Math.min(batCapacity, loadDay + hpDay + evDay);
    batStoreCap[dk] = selfNeed;
    batSelfReserve[dk] = selfNeed;
    if (!gridCharge) return;

    const priced = dayRowsArr.map(r => {
      const { hour, month, epexKey: k } = rowMeta(r);
      let sp = epexHistory.has(k) ? epexHistory.get(k) : getFallbackSpot(month, hour);
      if (sp > 0 && stressMultiplier !== 1.0) sp *= stressMultiplier;
      return { hour, spot: sp, allin: sp + markupBtw + eb };
    });
    if (priced.length < 3) return;
    const asc = [...priced].sort((a, b) => a.allin - b.allin);
    const cheap = asc.slice(0, K), expensive = asc.slice(-K);
    const hiAllin = expensive[expensive.length - 1].allin;
    const chargeHrs = cheap.filter(c => hiAllin * batEfficiency > c.allin);
    if (chargeHrs.length === 0) return;
    const loAllin = chargeHrs[0].allin;
    batChargeHrs[dk] = new Set(chargeHrs.map(c => c.hour));
    batDayMinAllin[dk] = loAllin;

    const fromSolar = Math.min(solarDay * batEfficiency, selfNeed);
    let drawnBudget = Math.max(0, selfNeed - fromSolar) / batEfficiency;

    if (gridExport) {
      const expHrs = expensive.filter(e => ((e.spot / 1.21) - exportMarkup) * batEfficiency > loAllin);
      const exportRoom = Math.min(expHrs.length * batPower, Math.max(0, batCapacity - selfNeed));
      if (exportRoom > 0) {
        batDischargeHrs[dk] = new Set(expHrs.map(e => e.hour));
        batStoreCap[dk] = selfNeed + exportRoom;
        drawnBudget += exportRoom / batEfficiency;
      } else {
        batDischargeHrs[dk] = new Set();
      }
    } else {
      batDischargeHrs[dk] = new Set();
    }
    batGridBudget[dk] = drawnBudget;
  });

  return { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve };
}

/**
 * Simulates Heat Pump (HP) energy consumption for a specific hour.
 * Calculates baseload based on degree-day (HDD) seasonality.
 */
export function applyHeatPumpLoad(hasHeatPump, hpWinterBaseload, month, hour) {
  if (!hasHeatPump) return 0;
  const sf = HEATPUMP_HDD_FACTOR[month] || 0.15;
  const tf = (hour >= 22 || hour < 7) ? 1.2 : 0.9;
  return hpWinterBaseload * sf * tf;
}

/**
 * Simulates Electric Vehicle (EV) load for a specific hour based on the precomputed schedule.
 */
export function applyEVLoad(hasEv, evScheduleCacheDyn, evScheduleCacheFx, dayKey, hour, impDyn, expDyn, impFx, expFx) {
  let evGridDyn = 0, evSolarDyn = 0, evGridFx = 0, evSolarFx = 0, evVal = 0;
  if (!hasEv) return { impDyn, expDyn, impFx, expFx, evGridDyn, evSolarDyn, evGridFx, evSolarFx, evVal };

  const evD = evScheduleCacheDyn[dayKey]?.[hour];
  if (evD) {
    impDyn += evD.grid;
    const solUsed = Math.min(evD.solar, expDyn);
    expDyn -= solUsed;
    impDyn += evD.solar - solUsed;
    // Attributie op ECHTE bron, niet op het plan: het EV-schema plant zonne-laden op het
    // ruwe export-overschot, maar warmtepomp/accu kunnen datzelfde overschot al hebben
    // opgegeten → het tekort (evD.solar − solUsed) komt dan van het net. Voorheen werd
    // dit als "zon" geteld → overschatte zelfconsumptie in de breakdown (de rekening was
    // al correct, want impDyn/expDyn kloppen). Nu telt alleen het écht gebruikte zon.
    evSolarDyn = solUsed;
    evGridDyn = evD.grid + (evD.solar - solUsed);
    evVal = evD.grid + evD.solar;
  }

  const evF = evScheduleCacheFx[dayKey]?.[hour];
  if (evF) {
    impFx += evF.grid;
    const solUsedFx = Math.min(evF.solar, expFx);
    expFx -= solUsedFx;
    impFx += evF.solar - solUsedFx;
    evSolarFx = solUsedFx;
    evGridFx = evF.grid + (evF.solar - solUsedFx);
  }

  return { impDyn, expDyn, impFx, expFx, evGridDyn, evSolarDyn, evGridFx, evSolarFx, evVal };
}

/**
 * Simulates battery charging/discharging logic for a specific hour.
 * Implements self-consumption, grid charging, and grid exporting constraints.
 *
 * Neemt één context-object (i.p.v. 18 positionele argumenten) om verwisseling van
 * parameters onmogelijk te maken. De velden:
 * @param {Object}  ctx
 * @param {Object}  ctx.cfg            - simulatieconfig (batCapacity/batPower/batEfficiency/hasBattery)
 * @param {number}  ctx.eb             - energiebelasting €/kWh
 * @param {number}  ctx.markupBtw      - inkoop-opslag €/kWh (incl. BTW)
 * @param {number}  ctx.exportMarkup   - teruglever-opslag €/kWh (incl. BTW)
 * @param {boolean} ctx.gridCharge     - mag van het net laden (kosten/winst-modus)
 * @param {boolean} ctx.gridExport     - mag aan het net verkopen (winst-modus)
 * @param {string}  ctx.dayKey         - lokale dagsleutel YYYY-MM-DD
 * @param {number}  ctx.hour           - uur 0–23
 * @param {number}  ctx.spot           - spotprijs dit uur (incl. BTW, excl. EB)
 * @param {Object}  ctx.batChargeHrs   - per dag: Set van laad-uren
 * @param {Object}  ctx.batDischargeHrs- per dag: Set van net-ontlaad-uren (winst)
 * @param {Object}  ctx.batDayMinAllin - per dag: laagste laad-all-in
 * @param {Object}  ctx.batGridBudget  - per dag: max van het net te trekken kWh
 * @param {Object}  ctx.batStoreCap    - per dag: SoC-cap (dag-behoefte [+ export-ruimte])
 * @param {Object}  ctx.batSelfReserve - per dag: voor eigen verbruik gereserveerde SoC
 * @param {number}  ctx.batSoC         - actuele SoC dynamische accu
 * @param {number}  ctx.batSoCFx       - actuele SoC vaste-contract-accu
 * @param {number}  ctx.batGridDrawnVal- reeds van het net getrokken kWh vandaag
 * @param {number}  ctx.impDyn,expDyn,impFx,expFx - uur-volumes vóór accu
 * @returns {Object} bijgewerkte volumes/SoC + per-stroom telmetrieken
 */
export function applyBatteryState(ctx) {
  const {
    cfg, eb, markupBtw, exportMarkup, gridCharge, gridExport,
    dayKey, hour, spot,
    batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve,
    batGridDrawnVal,
  } = ctx;
  // Gemuteerde waarden krijgen lokale let-bindings (SoC + uur-volumes lopen door de logica).
  let { batSoC, batSoCFx, impDyn, expDyn, impFx, expFx } = ctx;

  let batChargeVal = 0, batDischargeVal = 0, batChargeSolarVal = 0, batChargeGridVal = 0;
  let batDischargeToHouseVal = 0, batDischargeToGridVal = 0;
  let batChargeSolarFxVal = 0, batDischargeToHouseFxVal = 0;
  let drawnGrid = 0;

  if (cfg.hasBattery) {
    const isChargeHour = gridCharge && batChargeHrs[dayKey]?.has(hour);
    let currentPowerLimit = cfg.batPower;

    const socCap = Math.min(cfg.batCapacity, batStoreCap[dayKey] ?? cfg.batCapacity);
    const socRoom = Math.max(0, socCap - batSoC) / cfg.batEfficiency;

    if (expDyn > 0 && socRoom > 0) {
      const c = Math.min(expDyn, currentPowerLimit, socRoom);
      batSoC += c * cfg.batEfficiency;
      expDyn = Math.max(0, expDyn - c);
      currentPowerLimit -= c;
      batChargeVal += c;
      batChargeSolarVal += c;
    }

    if (isChargeHour && expDyn === 0 && currentPowerLimit > 0) {
      const drawnRoom = Math.max(0, (batGridBudget[dayKey] || 0) - batGridDrawnVal);
      const room = Math.max(0, socCap - batSoC) / cfg.batEfficiency;
      const c = Math.min(currentPowerLimit, room, drawnRoom);
      if (c > 0) {
        batSoC += c * cfg.batEfficiency;
        impDyn += c;
        currentPowerLimit -= c;
        drawnGrid += c;
        batChargeVal += c;
        batChargeGridVal += c;
      }
    }

    const wantDischarge = !isChargeHour && (impDyn > 0 || (gridExport && batDischargeHrs[dayKey]?.has(hour)));
    if (wantDischarge && batSoC > 0 && expDyn === 0) {
      let d = Math.min(cfg.batPower, batSoC);
      const toHouse = Math.min(impDyn, d);
      impDyn -= toHouse; batSoC -= toHouse; d -= toHouse;
      batDischargeVal += toHouse;
      batDischargeToHouseVal += toHouse;

      const loAllin = batDayMinAllin[dayKey] || (markupBtw + eb);
      const minExportSpot = ((loAllin / cfg.batEfficiency) + exportMarkup) * 1.21;
      const reserve = batSelfReserve[dayKey] ?? 0;
      const exportable = Math.min(d, Math.max(0, batSoC - reserve));
      if (gridExport && exportable > 0 && spot > minExportSpot) {
        expDyn += exportable; batSoC -= exportable;
        batDischargeVal += exportable;
        batDischargeToGridVal += exportable;
      }
    }

    if (expFx > 0 && batSoCFx < cfg.batCapacity) {
      const c = Math.min(expFx, cfg.batPower, (cfg.batCapacity - batSoCFx) / cfg.batEfficiency);
      batSoCFx += c * cfg.batEfficiency; expFx = Math.max(0, expFx - c);
      batChargeSolarFxVal += c;
    }
    if (impFx > 0 && batSoCFx > 0 && expFx === 0) {
      const d = Math.min(impFx, cfg.batPower, batSoCFx);
      batSoCFx -= d; impFx = Math.max(0, impFx - d);
      batDischargeToHouseFxVal += d;
    }
  }

  return {
    impDyn, expDyn, impFx, expFx,
    batSoC, batSoCFx, drawnGrid,
    batChargeVal, batDischargeVal, batChargeSolarVal, batChargeGridVal,
    batDischargeToHouseVal, batDischargeToGridVal, batChargeSolarFxVal, batDischargeToHouseFxVal
  };
}

/**
 * Simulates solar smart dimming (curtailment) when spot prices fall below a certain threshold.
 *
 * "dim" mode      — inverter throttles output to exactly house load (self-consumption
 *                    only, no export). Triggers at spot < 0. Requires a smart inverter with
 *                    dynamic power limiting; not all hardware supports this.
 *
 * "turn_off" mode — inverter shuts off completely (binary). Two separate thresholds:
 *   - Export stops at spot < 0 (any negative spot makes exporting loss-making).
 *   - Self-consumption is only removed (dynImp = currentHouseLoad) when the all-in
 *     grid import cost also goes negative: spot + markupBtw + eb < 0 (≈ −0.135 €/kWh
 *     at default settings). Above that threshold, free solar self-consumption is still
 *     cheaper than grid, so pulling ALL load to the grid would increase the bill (e.g.
 *     because the EV was charging from solar and would have to pay EB on grid import).
 *
 * @param {string} solarDimmingMode - "do_nothing" | "dim" | "turn_off"
 * @param {number} spot       - EPEX spot price incl. VAT excl. EB (€/kWh)
 * @param {number} impDyn     - Dynamic grid import after HP/EV/battery adjustments (kWh)
 * @param {number} expDyn     - Dynamic grid export after HP/EV/battery adjustments (kWh)
 * @param {number} solar_yield - Solar production this hour (kWh), or null if no sensor
 * @param {number} markupBtw  - Dynamic contract markup incl. VAT (€/kWh)
 * @param {number} eb         - Energy tax (€/kWh)
 */
export function applySmartDimming(solarDimmingMode, spot, impDyn, expDyn, solar_yield, markupBtw, eb) {
  let dynImp = impDyn;
  let dynExp = expDyn;
  const dimmingActive = solarDimmingMode && solarDimmingMode !== "do_nothing";

  if (dimmingActive && spot < 0) {
    const solar = solar_yield ?? null;
    if (solar !== null) {
      const localSolarConsumed = Math.max(0, solar - expDyn);
      const currentHouseLoad = impDyn + localSolarConsumed;
      const brutoOverschot = solar - currentHouseLoad;

      if (solarDimmingMode === "dim") {
        // Throttle inverter output to house load: no export, self-consumption intact.
        dynImp = brutoOverschot < 0 ? Math.abs(brutoOverschot) : 0;
        dynExp = 0;
      } else if (solarDimmingMode === "turn_off") {
        // Always stop export when spot < 0 (exporting is loss-making).
        dynExp = 0;
        // Only pull ALL load to grid when grid import is actually cheaper than free solar
        // (all-in cost < 0). At moderately negative prices, EB still makes grid expensive.
        const allInNegative = spot + markupBtw + eb < 0;
        if (allInNegative) dynImp = currentHouseLoad;
      }
    } else {
      // No solar sensor: can only stop export, import is unchanged.
      dynExp = 0;
    }
  }
  return { dynImp, dynExp };
}

/**
 * ISO week number helper (ISO 8601)
 */
export function isoWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const diff = d - startOfWeek1;
  const week = Math.floor(diff / (7 * 86400000)) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}


