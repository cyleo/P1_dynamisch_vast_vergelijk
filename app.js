(() => {
  // src/domain/store.js
  var Store = class {
    constructor(initialState) {
      this.state = initialState;
      this.listeners = /* @__PURE__ */ new Set();
    }
    /**
     * Retrieves the current immutable state object.
     */
    getState() {
      return this.state;
    }
    /**
     * Partially updates the state and notifies all subscribers.
     * @param {Object} updates - The partial state changes.
     */
    setState(updates) {
      this.state = { ...this.state, ...updates };
      this.notify();
    }
    /**
     * Subscribes a function to state changes.
     * @param {Function} listener - Callback invoked with the new state.
     * @returns {Function} Unsubscribe function.
     */
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    /**
     * Mutates the epexHistory Map in place and notifies subscribers.
     * Routes all EPEX writes through the store so subscribers stay in sync.
     * @param {Iterable<[string, number]>} entries - key/value pairs to set.
     */
    updateEpexHistory(entries) {
      for (const [k, v] of entries) this.state.epexHistory.set(k, v);
      this.notify();
    }
    /**
     * Manually triggers a re-render for all listeners.
     */
    notify() {
      this.listeners.forEach((fn) => fn(this.state));
    }
  };
  var appStore = new Store({
    // Data State
    energyData: [],
    epexHistory: /* @__PURE__ */ new Map(),
    fullYearData: null,
    _lastHAStats: null,
    _lastRoleMap: null,
    isDemoData: true,
    digitalTwinEnabled: true,
    // UI & View State
    overviewMode: "day",
    // "day" | "week" | "month"
    overviewMetric: "energy",
    // "energy" | "cost" | "savings"
    activeViewType: "bars",
    // "bars" | "sankey"
    sankeyInterval: "year",
    // "year" | "month" | "week" | "day"
    sankeyValue: "",
    simMode: "day",
    // "day" | "week"
    simDrillDay: null,
    // Chart Display Toggles
    profileVisibleLines: {
      imp: true,
      exp: true,
      spot: true,
      solar: true,
      ev: true,
      hp: true,
      bat: true
    },
    // Pricing & Taxation State
    liveEnergyTax: 0.11084,
    calibratedProfile: null,
    calibrationMeta: { buckets: 0, samples: 0 },
    // App Cache & Tracking
    fullYearStamp: "",
    yearScale: 1,
    dataMeta: { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 },
    activeSimulation: {},
    untangle: { active: false },
    dataQuality: null,
    // Dismissal Flags
    epexWarnDismissed: false,
    prognosisDismissed: false,
    dataQualityDismissed: false
  });

  // src/domain/constants.js
  var EV_MAX_CHARGE_KW2 = 11;
  var HEATPUMP_HDD_FACTOR = {
    1: 1.38,
    2: 1.21,
    3: 1.1,
    4: 0.77,
    5: 0.44,
    6: 0.17,
    7: 0.15,
    8: 0.15,
    9: 0.29,
    10: 0.66,
    11: 1.02,
    12: 1.31
  };
  var ENERGY_TAX_2026 = 0.11084;
  var EB_REBATE_2026 = 628.96;
  var NETBEHEER_2026 = 480;
  var FISCAL_MODELS = {
    2026: { year: 2026, salderen: true, energyTax: ENERGY_TAX_2026, ebRebate: EB_REBATE_2026, netbeheer: NETBEHEER_2026 },
    2027: { year: 2027, salderen: false, energyTax: ENERGY_TAX_2026, ebRebate: EB_REBATE_2026, netbeheer: NETBEHEER_2026 }
  };
  var DEFAULT_FISCAL_YEAR = 2027;
  var EPEX_PROFILES = {
    // Dec · Jan · Feb — hoge nachten/avonden, koude pieken, weinig zon → zelden negatief
    winter: {
      0: 0.07,
      1: 0.06,
      2: 0.06,
      3: 0.06,
      4: 0.06,
      5: 0.07,
      6: 0.1,
      7: 0.13,
      8: 0.14,
      9: 0.12,
      10: 0.1,
      11: 0.09,
      12: 0.09,
      13: 0.09,
      14: 0.1,
      15: 0.11,
      16: 0.13,
      17: 0.16,
      18: 0.15,
      19: 0.13,
      20: 0.11,
      21: 0.09,
      22: 0.08,
      23: 0.07
    },
    // Mrt · Apr · Mei — zon drukt de middag, ondiep negatief rond zon-noon
    spring: {
      0: 0.05,
      1: 0.04,
      2: 0.04,
      3: 0.04,
      4: 0.04,
      5: 0.05,
      6: 0.07,
      7: 0.09,
      8: 0.09,
      9: 0.07,
      10: 0.06,
      11: 0.05,
      12: 0.01,
      13: -0.01,
      14: 0.04,
      15: 0.07,
      16: 0.08,
      17: 0.1,
      18: 0.12,
      19: 0.13,
      20: 0.11,
      21: 0.09,
      22: 0.07,
      23: 0.06
    },
    // Jun · Jul · Aug — diepste zon-kannibalisatie, goedkope nachten
    summer: {
      0: 0.03,
      1: 0.02,
      2: 0.02,
      3: 0.02,
      4: 0.02,
      5: 0.04,
      6: 0.06,
      7: 0.07,
      8: 0.07,
      9: 0.06,
      10: 0.06,
      11: 0.04,
      12: -0.01,
      13: -0.02,
      14: 0.03,
      15: 0.06,
      16: 0.07,
      17: 0.09,
      18: 0.11,
      19: 0.12,
      20: 0.11,
      21: 0.09,
      22: 0.07,
      23: 0.05
    },
    // Sep · Okt · Nov — mix, loopt op richting winter
    autumn: {
      0: 0.06,
      1: 0.05,
      2: 0.05,
      3: 0.05,
      4: 0.05,
      5: 0.06,
      6: 0.08,
      7: 0.11,
      8: 0.13,
      9: 0.1,
      10: 0.07,
      11: 0.06,
      12: 0.05,
      13: 0.04,
      14: 0.05,
      15: 0.08,
      16: 0.12,
      17: 0.15,
      18: 0.15,
      19: 0.13,
      20: 0.11,
      21: 0.09,
      22: 0.08,
      23: 0.07
    }
  };
  var DEMO_ROLEMAP = {
    imp1: "sensor.p1_meter_energy_import_tariff_1",
    imp2: "sensor.p1_meter_energy_import_tariff_2",
    exp1: "sensor.p1_meter_energy_export_tariff_1",
    exp2: "sensor.p1_meter_energy_export_tariff_2",
    solar: "sensor.solar_inverter_lifetime_energy_production",
    solarUnit: "kWh",
    ev: "sensor.ev_charger_charge_added_session",
    evUnit: "kWh",
    hp: "sensor.heat_pump_energy_consumption",
    hpUnit: "kWh",
    batIn: "sensor.home_battery_ac_aggr_charge",
    batInUnit: "kWh",
    batOut: "sensor.home_battery_ac_aggr_discharge",
    batOutUnit: "kWh"
  };

  // src/domain/energyMath.js
  var p2 = (n) => String(n).padStart(2, "0");
  function rowMeta(row) {
    if (row._meta) return row._meta;
    const dt = new Date(row.timestamp);
    const mo = dt.getMonth() + 1, da = dt.getDate(), h = dt.getHours();
    const dayKey = `${dt.getFullYear()}-${p2(mo)}-${p2(da)}`;
    const meta = { hour: h, date: da, month: mo, dow: dt.getDay(), dayKey, epexKey: `${dayKey}T${p2(h)}` };
    Object.defineProperty(row, "_meta", { value: meta, enumerable: false, configurable: true });
    return meta;
  }
  function epexKey(dt) {
    return `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}T${p2(dt.getHours())}`;
  }
  function toConsumerPrice(spot, markup, tax) {
    return spot + markup + tax;
  }
  function seasonOf(month) {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
  }
  function precomputeEVSchedules(cfg, ctx, dayRows, markupBtw) {
    const { hasEv, evWeeklyDist, evConsumption, evSolarMatch, evProfile, stressMultiplier = 1, fixedPeakRate, fixedDalRate } = cfg;
    const { epexHistory: epexHistory2, eb } = ctx;
    const evScheduleCacheDyn = {};
    const evScheduleCacheFx = {};
    if (!hasEv) return { evScheduleCacheDyn, evScheduleCacheFx };
    const evDailyKwh = evWeeklyDist * evConsumption / 7;
    if (evDailyKwh <= 0) return { evScheduleCacheDyn, evScheduleCacheFx };
    Object.keys(dayRows).forEach((dk) => {
      const rowsOfDay = dayRows[dk];
      const unavailable = (r) => {
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
            const charge = Math.min(rawExpH, EV_MAX_CHARGE_KW2, remNeed);
            if (charge > 0) {
              s[h].solar += charge;
              remNeed -= charge;
            }
          }
        }
        return { s, remNeed };
      };
      const dynTarget = baseSched();
      if (dynTarget.remNeed > 0) {
        const sortedDyn = rowsOfDay.filter((r) => !unavailable(r)).map((r) => {
          const { hour, month, epexKey: k } = rowMeta(r);
          let sp = epexHistory2.has(k) ? epexHistory2.get(k) : getFallbackSpot(month, hour);
          if (sp > 0 && stressMultiplier !== 1) sp *= stressMultiplier;
          return { h: hour, cost: sp + markupBtw + eb };
        }).sort((a, b) => a.cost - b.cost);
        for (const { h } of sortedDyn) {
          if (dynTarget.remNeed <= 0) break;
          const room = EV_MAX_CHARGE_KW2 - (dynTarget.s[h].solar + dynTarget.s[h].grid);
          const charge = Math.min(dynTarget.remNeed, room);
          if (charge > 0) {
            dynTarget.s[h].grid += charge;
            dynTarget.remNeed -= charge;
          }
        }
      }
      evScheduleCacheDyn[dk] = dynTarget.s;
      const fxTarget = baseSched();
      if (fxTarget.remNeed > 0) {
        const sortedFx = rowsOfDay.filter((r) => !unavailable(r)).map((r) => {
          const { hour, dow } = rowMeta(r);
          const isPeakHour = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
          return { h: hour, cost: isPeakHour ? fixedPeakRate : fixedDalRate };
        }).sort((a, b) => a.cost - b.cost);
        for (const { h } of sortedFx) {
          if (fxTarget.remNeed <= 0) break;
          const room = EV_MAX_CHARGE_KW2 - (fxTarget.s[h].solar + fxTarget.s[h].grid);
          const charge = Math.min(fxTarget.remNeed, room);
          if (charge > 0) {
            fxTarget.s[h].grid += charge;
            fxTarget.remNeed -= charge;
          }
        }
      }
      evScheduleCacheFx[dk] = fxTarget.s;
    });
    return { evScheduleCacheDyn, evScheduleCacheFx };
  }
  function precomputeBatterySchedule(cfg, ctx, dayRows, markupBtw, exportMarkup, gridCharge, gridExport, salderen = false) {
    const {
      hasBattery,
      batCapacity,
      batPower,
      batEfficiency,
      stressMultiplier = 1,
      hasHeatPump,
      hpWinterBaseload,
      hasEv,
      evWeeklyDist,
      evConsumption
    } = cfg;
    const { epexHistory: epexHistory2, eb } = ctx;
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
    const evDay = hasEv ? evWeeklyDist * evConsumption / 7 : 0;
    Object.keys(dayRows).forEach((dk) => {
      const dayRowsArr = dayRows[dk];
      const loadDay = dayRowsArr.reduce((s, r) => s + r.import_t1 + r.import_t2, 0);
      const solarDay = dayRowsArr.reduce((s, r) => s + r.export_t1 + r.export_t2, 0);
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
      const priced = dayRowsArr.map((r) => {
        const { hour, month, epexKey: k } = rowMeta(r);
        let sp = epexHistory2.has(k) ? epexHistory2.get(k) : getFallbackSpot(month, hour);
        if (sp > 0 && stressMultiplier !== 1) sp *= stressMultiplier;
        return { hour, spot: sp, allin: sp + markupBtw + eb };
      });
      if (priced.length < 3) return;
      const asc = [...priced].sort((a, b) => a.allin - b.allin);
      const cheap = asc.slice(0, K), expensive = asc.slice(-K);
      const hiAllin = expensive[expensive.length - 1].allin;
      const chargeHrs = cheap.filter((c) => hiAllin * batEfficiency > c.allin);
      if (chargeHrs.length === 0) return;
      const loAllin = chargeHrs[0].allin;
      batChargeHrs[dk] = new Set(chargeHrs.map((c) => c.hour));
      batDayMinAllin[dk] = loAllin;
      const fromSolar = Math.min(solarDay * batEfficiency, selfNeed);
      let drawnBudget = Math.max(0, selfNeed - fromSolar) / batEfficiency;
      if (gridExport) {
        const expValue = (sp) => salderen ? sp + markupBtw : sp / 1.21 - exportMarkup;
        const expHrs = expensive.filter((e) => expValue(e.spot) * batEfficiency > loAllin);
        const exportRoom = Math.min(expHrs.length * batPower, Math.max(0, batCapacity - selfNeed));
        if (exportRoom > 0) {
          batDischargeHrs[dk] = new Set(expHrs.map((e) => e.hour));
          batStoreCap[dk] = selfNeed + exportRoom;
          drawnBudget += exportRoom / batEfficiency;
        } else {
          batDischargeHrs[dk] = /* @__PURE__ */ new Set();
        }
      } else {
        batDischargeHrs[dk] = /* @__PURE__ */ new Set();
      }
      batGridBudget[dk] = drawnBudget;
    });
    return { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve };
  }
  function applyHeatPumpLoad(hasHeatPump, hpWinterBaseload, month, hour) {
    if (!hasHeatPump) return 0;
    const sf = HEATPUMP_HDD_FACTOR[month] || 0.15;
    const tf = hour >= 22 || hour < 7 ? 1.2 : 0.9;
    return hpWinterBaseload * sf * tf;
  }
  function applyEVLoad(hasEv, evScheduleCacheDyn, evScheduleCacheFx, dayKey, hour, impDyn, expDyn, impFx, expFx) {
    let evGridDyn = 0, evSolarDyn = 0, evGridFx = 0, evSolarFx = 0, evVal = 0;
    if (!hasEv) return { impDyn, expDyn, impFx, expFx, evGridDyn, evSolarDyn, evGridFx, evSolarFx, evVal };
    const evD = evScheduleCacheDyn[dayKey]?.[hour];
    if (evD) {
      impDyn += evD.grid;
      const solUsed = Math.min(evD.solar, expDyn);
      expDyn -= solUsed;
      impDyn += evD.solar - solUsed;
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
  function applyBatteryState(ctx) {
    const {
      cfg,
      eb,
      markupBtw,
      exportMarkup,
      gridCharge,
      gridExport,
      salderen = false,
      dayKey,
      hour,
      spot,
      batChargeHrs,
      batDischargeHrs,
      batDayMinAllin,
      batGridBudget,
      batStoreCap,
      batSelfReserve,
      batGridDrawnVal
    } = ctx;
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
      const wantDischarge = !isChargeHour && (impDyn > 0 || gridExport && batDischargeHrs[dayKey]?.has(hour));
      if (wantDischarge && batSoC > 0 && expDyn === 0) {
        let d = Math.min(cfg.batPower, batSoC);
        const toHouse = Math.min(impDyn, d);
        impDyn -= toHouse;
        batSoC -= toHouse;
        d -= toHouse;
        batDischargeVal += toHouse;
        batDischargeToHouseVal += toHouse;
        const loAllin = batDayMinAllin[dayKey] || markupBtw + eb;
        const minExportSpot = salderen ? loAllin / cfg.batEfficiency - markupBtw : (loAllin / cfg.batEfficiency + exportMarkup) * 1.21;
        const reserve = batSelfReserve[dayKey] ?? 0;
        const exportable = Math.min(d, Math.max(0, batSoC - reserve));
        if (gridExport && exportable > 0 && spot > minExportSpot) {
          expDyn += exportable;
          batSoC -= exportable;
          batDischargeVal += exportable;
          batDischargeToGridVal += exportable;
        }
      }
      if (expFx > 0 && batSoCFx < cfg.batCapacity) {
        const c = Math.min(expFx, cfg.batPower, (cfg.batCapacity - batSoCFx) / cfg.batEfficiency);
        batSoCFx += c * cfg.batEfficiency;
        expFx = Math.max(0, expFx - c);
        batChargeSolarFxVal += c;
      }
      if (impFx > 0 && batSoCFx > 0 && expFx === 0) {
        const d = Math.min(impFx, cfg.batPower, batSoCFx);
        batSoCFx -= d;
        impFx = Math.max(0, impFx - d);
        batDischargeToHouseFxVal += d;
      }
    }
    return {
      impDyn,
      expDyn,
      impFx,
      expFx,
      batSoC,
      batSoCFx,
      drawnGrid,
      batChargeVal,
      batDischargeVal,
      batChargeSolarVal,
      batChargeGridVal,
      batDischargeToHouseVal,
      batDischargeToGridVal,
      batChargeSolarFxVal,
      batDischargeToHouseFxVal
    };
  }
  function applySmartDimming(solarDimmingMode, spot, impDyn, expDyn, solar_yield, markupBtw, eb) {
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
          dynImp = brutoOverschot < 0 ? Math.abs(brutoOverschot) : 0;
          dynExp = 0;
        } else if (solarDimmingMode === "turn_off") {
          dynExp = 0;
          const allInNegative = spot + markupBtw + eb < 0;
          if (allInNegative) dynImp = currentHouseLoad;
        }
      } else {
        dynExp = 0;
      }
    }
    return { dynImp, dynExp };
  }
  function isoWeek(dateStr) {
    const d = /* @__PURE__ */ new Date(dateStr + "T12:00:00Z");
    const isoDay = (d.getUTCDay() + 6) % 7;
    const thu = new Date(d);
    thu.setUTCDate(d.getUTCDate() + (3 - isoDay));
    const isoYear = thu.getUTCFullYear();
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() + 6) % 7);
    const diff = thu - startOfWeek1;
    const week = Math.floor(diff / (7 * 864e5)) + 1;
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }

  // src/domain/engine.js
  var _dayRowsCache = null;
  var _dayRowsSrc = null;
  function getDayRows(simData) {
    if (_dayRowsSrc === simData && _dayRowsCache) return _dayRowsCache;
    const dr = {};
    simData.forEach((r) => {
      (dr[rowMeta(r).dayKey] ||= []).push(r);
    });
    _dayRowsSrc = simData;
    _dayRowsCache = dr;
    return dr;
  }
  function getFallbackSpot2(month, hour) {
    const { calibratedProfile: calibratedProfile3 } = appStore.getState();
    const season = seasonOf(month);
    const cal = calibratedProfile3?.[season]?.[hour];
    if (cal != null) return cal;
    const raw = EPEX_PROFILES[season][hour];
    return raw >= 0 ? raw * 1.21 : raw;
  }
  function buildSimContext() {
    const { fullYearData: fullYearData2, energyData: energyData2, epexHistory: epexHistory2, liveEnergyTax: liveEnergyTax3, yearScale: yearScale2 } = appStore.getState();
    return {
      simData: fullYearData2 || energyData2,
      epexHistory: epexHistory2,
      eb: liveEnergyTax3,
      yearScale: yearScale2
    };
  }
  function makeDayTotal() {
    return {
      dynCost: 0,
      fixedCost: 0,
      impKwh: 0,
      expKwh: 0,
      spotSum: 0,
      spotN: 0,
      impCost: 0,
      expRev: 0,
      rawImp: 0,
      rawExp: 0,
      solarYield: 0,
      evKwh: 0,
      evCost: 0,
      evSavings: 0,
      evSolar: 0,
      evGrid: 0,
      hpKwh: 0,
      hpCost: 0,
      hpSavings: 0,
      hpSolar: 0,
      hpGrid: 0,
      batCharge: 0,
      batDischarge: 0,
      batCost: 0,
      batSavings: 0,
      batChargeCost: 0,
      batDischargeValue: 0,
      batChargeGrid: 0,
      batChargeGridCost: 0,
      batChargeSolar: 0,
      batDischargeToHouse: 0,
      batDischargeToGrid: 0,
      baseloadCost: 0,
      baseloadReturn: 0,
      baseloadImportSavings: 0,
      baseloadExportSavings: 0
    };
  }
  function _simulateCore(cfg, full = false, ctx = null) {
    ctx = ctx || buildSimContext();
    const {
      fixedPeakRate,
      fixedDalRate,
      fixedFeedInRate,
      fixedVastrecht,
      fixedFeedInFee,
      dynamicMarkup,
      dynamicExportMarkup = 0,
      dynamicVastrecht,
      stressMultiplier = 1,
      solarDimmingMode,
      hasHeatPump,
      hpWinterBaseload,
      hasEv,
      evWeeklyDist,
      evConsumption,
      evSolarMatch,
      evProfile = "home",
      hasBattery,
      batCapacity,
      batPower,
      batEfficiency,
      batArbitrage,
      batGridExport = false,
      batMode,
      noSolar = false
    } = cfg;
    const mode = batMode || (batGridExport ? "winst" : batArbitrage ? "kosten" : "zelf");
    const gridCharge = mode === "kosten" || mode === "winst";
    const gridExport = mode === "winst";
    const model = FISCAL_MODELS[cfg.fiscalYear] || FISCAL_MODELS[DEFAULT_FISCAL_YEAR];
    const salderen = model.salderen;
    const markupBtw = dynamicMarkup;
    const exportMarkup = dynamicExportMarkup;
    const eb = ctx.eb;
    const epexHistory2 = ctx.epexHistory;
    const simData = ctx.simData;
    const dayRows = getDayRows(simData);
    const { evScheduleCacheDyn, evScheduleCacheFx } = precomputeEVSchedules(cfg, ctx, dayRows, markupBtw);
    const { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve } = precomputeBatterySchedule(cfg, ctx, dayRows, markupBtw, exportMarkup, gridCharge, gridExport, salderen);
    let fxPeakImp = 0, fxDalImp = 0, fxPeakExp = 0, fxDalExp = 0;
    let dynImpCost = 0, dynExpRev = 0, dynImpKwh = 0, dynExpKwh = 0;
    let dynExpRevSalder = 0;
    let batSoC = 0, batSoCFx = 0;
    let epexReal = 0, epexFall = 0;
    const batGridDrawn = {};
    const hourly = full ? Array.from({ length: 24 }, () => ({
      imports: [],
      exports: [],
      spots: [],
      dynCosts: [],
      fixedCosts: [],
      solar: [],
      ev: [],
      hp: [],
      batCharge: [],
      batDischarge: []
    })) : null;
    const weekly = full ? Array.from({ length: 7 }, () => ({ dynCosts: [], fixedCosts: [] })) : null;
    const dayTot = full ? {} : null;
    const dayHour = full ? {} : null;
    const accumulateFull = (h) => {
      const {
        hour,
        dow,
        dayKey,
        isPeak,
        spot,
        dynImp,
        dynExp,
        basePrice,
        rawImp,
        rawExp,
        solarYield,
        hpLoad,
        hpFromSolar,
        hpFromGrid,
        evRes,
        batRes,
        impFx,
        expFx
      } = h;
      hourly[hour].imports.push(dynImp);
      hourly[hour].exports.push(dynExp);
      const allIn = basePrice + eb;
      const returnPrice = spot / 1.21 - exportMarkup;
      const dynHrCost = dynImp * allIn - dynExp * returnPrice;
      const tariff = isPeak ? fixedPeakRate : fixedDalRate;
      const fxHrCost = impFx * tariff - expFx * fixedFeedInRate + expFx * fixedFeedInFee;
      hourly[hour].dynCosts.push(dynHrCost);
      hourly[hour].fixedCosts.push(fxHrCost);
      weekly[dow].dynCosts.push(dynHrCost);
      weekly[dow].fixedCosts.push(fxHrCost);
      hourly[hour].solar.push(solarYield);
      hourly[hour].ev.push(evRes.evVal);
      hourly[hour].hp.push(hasHeatPump ? hpLoad : 0);
      hourly[hour].batCharge.push(batRes.batChargeVal);
      hourly[hour].batDischarge.push(batRes.batDischargeVal);
      const fixedReturnPrice = fixedFeedInRate - fixedFeedInFee;
      const evCostFx = evRes.evGridFx * tariff - evRes.evSolarFx * fixedReturnPrice;
      const evCostDyn = evRes.evGridDyn * allIn - evRes.evSolarDyn * returnPrice;
      const evSavings = evCostFx - evCostDyn;
      const hpCostFx = hpFromGrid * tariff - hpFromSolar * fixedReturnPrice;
      const hpCostDyn = hpFromGrid * allIn - hpFromSolar * returnPrice;
      const hpSavings = hpCostFx - hpCostDyn;
      const batCostFx = batRes.batChargeSolarFxVal * fixedReturnPrice - batRes.batDischargeToHouseFxVal * tariff;
      const batCostDyn = batRes.batChargeGridVal * allIn + batRes.batChargeSolarVal * returnPrice - (batRes.batDischargeToHouseVal * allIn + batRes.batDischargeToGridVal * returnPrice);
      const batSavings = batCostFx - batCostDyn;
      const baseloadImportSavings = rawImp * (tariff - allIn);
      const baseloadExportSavings = rawExp * (returnPrice - fixedReturnPrice);
      const pd = dayTot[dayKey] ||= makeDayTotal();
      pd.dynCost += dynHrCost;
      pd.fixedCost += fxHrCost;
      pd.impKwh += dynImp;
      pd.expKwh += dynExp;
      pd.impCost += dynImp * allIn;
      pd.expRev += dynExp * returnPrice;
      if (dynImp > 0) {
        pd.spotSum += spot * dynImp;
        pd.spotN += dynImp;
      }
      pd.rawImp += rawImp;
      pd.rawExp += rawExp;
      pd.solarYield += solarYield;
      pd.evKwh += evRes.evGridDyn + evRes.evSolarDyn;
      pd.evCost += evCostDyn;
      pd.evSavings += evSavings;
      pd.evSolar += evRes.evSolarDyn;
      pd.evGrid += evRes.evGridDyn;
      pd.hpKwh += hpLoad;
      pd.hpCost += hpCostDyn;
      pd.hpSavings += hpSavings;
      pd.hpSolar += hpFromSolar;
      pd.hpGrid += hpFromGrid;
      pd.batCharge += batRes.batChargeSolarVal + batRes.batChargeGridVal;
      pd.batDischarge += batRes.batDischargeToHouseVal + batRes.batDischargeToGridVal;
      pd.batCost += batCostDyn;
      pd.batSavings += batSavings;
      pd.batChargeCost += batRes.batChargeGridVal * allIn + batRes.batChargeSolarVal * returnPrice;
      pd.batDischargeValue += batRes.batDischargeToHouseVal * allIn + batRes.batDischargeToGridVal * returnPrice;
      pd.batChargeGrid += batRes.batChargeGridVal;
      pd.batChargeGridCost += batRes.batChargeGridVal * allIn;
      pd.batChargeSolar += batRes.batChargeSolarVal;
      pd.batDischargeToHouse += batRes.batDischargeToHouseVal;
      pd.batDischargeToGrid += batRes.batDischargeToGridVal;
      pd.baseloadCost += rawImp * allIn;
      pd.baseloadReturn += rawExp * returnPrice;
      pd.baseloadImportSavings += baseloadImportSavings;
      pd.baseloadExportSavings += baseloadExportSavings;
      if (!dayHour[dayKey]) dayHour[dayKey] = Array.from({ length: 24 }, () => null);
      dayHour[dayKey][hour] = { dynCost: dynHrCost, fixedCost: fxHrCost, spot, impKwh: dynImp, expKwh: dynExp };
    };
    simData.forEach((row) => {
      const { hour, month, dow, dayKey, epexKey: tsKey } = rowMeta(row);
      const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
      const _rawImp0 = row.import_t1 + row.import_t2;
      const _rawExp0 = row.export_t1 + row.export_t2;
      const solarYieldRaw = row.solar_yield || 0;
      const rawImp = noSolar && solarYieldRaw > 0 ? Math.max(0, _rawImp0 - _rawExp0 + solarYieldRaw) : _rawImp0;
      const rawExp = noSolar && solarYieldRaw > 0 ? 0 : _rawExp0;
      const solarYield = noSolar ? 0 : solarYieldRaw;
      let spot = epexHistory2.has(tsKey) ? epexHistory2.get(tsKey) : getFallbackSpot2(month, hour);
      if (epexHistory2.has(tsKey)) epexReal++;
      else epexFall++;
      if (spot > 0 && stressMultiplier !== 1) spot *= stressMultiplier;
      if (full) {
        hourly[hour].spots.push(spot);
      }
      const hpLoad = applyHeatPumpLoad(hasHeatPump, hpWinterBaseload, month, hour);
      const hpFromSolar = Math.min(hpLoad, rawExp);
      const hpFromGrid = hpLoad - hpFromSolar;
      let impDyn = rawImp + hpFromGrid;
      let expDyn = rawExp - hpFromSolar;
      let impFx = rawImp + hpFromGrid;
      let expFx = rawExp - hpFromSolar;
      const evRes = applyEVLoad(hasEv, evScheduleCacheDyn, evScheduleCacheFx, dayKey, hour, impDyn, expDyn, impFx, expFx);
      impDyn = evRes.impDyn;
      expDyn = evRes.expDyn;
      impFx = evRes.impFx;
      expFx = evRes.expFx;
      const batRes = applyBatteryState({
        cfg,
        eb,
        markupBtw,
        exportMarkup,
        gridCharge,
        gridExport,
        salderen,
        dayKey,
        hour,
        spot,
        batChargeHrs,
        batDischargeHrs,
        batDayMinAllin,
        batGridBudget,
        batStoreCap,
        batSelfReserve,
        batSoC,
        batSoCFx,
        batGridDrawnVal: batGridDrawn[dayKey] || 0,
        impDyn,
        expDyn,
        impFx,
        expFx
      });
      impDyn = batRes.impDyn;
      expDyn = batRes.expDyn;
      impFx = batRes.impFx;
      expFx = batRes.expFx;
      batSoC = batRes.batSoC;
      batSoCFx = batRes.batSoCFx;
      if (batRes.drawnGrid > 0) batGridDrawn[dayKey] = (batGridDrawn[dayKey] || 0) + batRes.drawnGrid;
      if (isPeak) {
        fxPeakImp += impFx;
        fxPeakExp += expFx;
      } else {
        fxDalImp += impFx;
        fxDalExp += expFx;
      }
      const dimRes = applySmartDimming(solarDimmingMode, spot, impDyn, expDyn, solarYield, markupBtw, eb);
      const dynImp = dimRes.dynImp;
      const dynExp = dimRes.dynExp;
      const basePrice = spot + markupBtw;
      dynImpCost += dynImp * basePrice;
      dynExpRev += dynExp * (spot / 1.21 - exportMarkup);
      dynExpRevSalder += dynExp * basePrice;
      dynImpKwh += dynImp;
      dynExpKwh += dynExp;
      if (full) accumulateFull({
        hour,
        dow,
        dayKey,
        isPeak,
        spot,
        dynImp,
        dynExp,
        basePrice,
        rawImp,
        rawExp,
        solarYield,
        hpLoad,
        hpFromSolar,
        hpFromGrid,
        evRes,
        batRes,
        impFx,
        expFx
      });
    });
    const ys = ctx.yearScale;
    fxPeakImp *= ys;
    fxDalImp *= ys;
    fxPeakExp *= ys;
    fxDalExp *= ys;
    dynImpCost *= ys;
    dynExpRev *= ys;
    dynExpRevSalder *= ys;
    dynImpKwh *= ys;
    dynExpKwh *= ys;
    const ebRebate = model.ebRebate;
    const gridFees = model.netbeheer;
    const fxSub = fixedVastrecht * 12;
    const dynSub = dynamicVastrecht * 12;
    let fxImpCost, fxFeedCredit, fxFeedPenalt, fixedBill, dynEB, effExpRev, dynTaxableKwh, dynBill;
    const fxImpKwh = fxPeakImp + fxDalImp;
    const fxExpKwh = fxPeakExp + fxDalExp;
    const fxNetImp = Math.max(0, fxImpKwh - fxExpKwh);
    const fxSurplusExp = Math.max(0, fxExpKwh - fxImpKwh);
    const peakShare = fxImpKwh > 0 ? fxPeakImp / fxImpKwh : 0;
    const fxSalderTariff = peakShare * fixedPeakRate + (1 - peakShare) * fixedDalRate;
    if (model.salderen) {
      fxImpCost = fxNetImp * fxSalderTariff;
      fxFeedCredit = fxSurplusExp * fixedFeedInRate;
      fxFeedPenalt = fxExpKwh * fixedFeedInFee;
      dynTaxableKwh = Math.max(0, dynImpKwh - dynExpKwh);
      dynEB = dynTaxableKwh * eb;
      const salderFrac = dynExpKwh > 0 ? Math.min(1, dynImpKwh / dynExpKwh) : 0;
      effExpRev = salderFrac * dynExpRevSalder + (1 - salderFrac) * dynExpRev;
    } else {
      fxImpCost = fxPeakImp * fixedPeakRate + fxDalImp * fixedDalRate;
      fxFeedCredit = (fxPeakExp + fxDalExp) * fixedFeedInRate;
      fxFeedPenalt = (fxPeakExp + fxDalExp) * fixedFeedInFee;
      dynTaxableKwh = dynImpKwh;
      dynEB = dynImpKwh * eb;
      effExpRev = dynExpRev;
    }
    fixedBill = fxImpCost - fxFeedCredit + fxFeedPenalt + fxSub - ebRebate + gridFees;
    dynBill = dynImpCost - effExpRev + dynEB + dynSub - ebRebate + gridFees;
    const out = { fixedBill, dynBill };
    if (full) {
      Object.assign(out, {
        totalImportKwh: dynImpKwh,
        totalExportKwh: dynExpKwh,
        netDynamicKwh: Math.max(0, dynImpKwh - dynExpKwh),
        dynamicRawImportCost: dynImpCost,
        dynamicRawExportRevenue: effExpRev,
        dynamicNetTax: dynEB,
        dynamicTaxableKwh: dynTaxableKwh,
        dynamicSubscription: dynSub,
        dynamicTotalBill: dynBill,
        taxRebate: ebRebate,
        gridFees,
        // Fiscale presentatievelden: de UI tekent de 2026-breakdown (gesaldeerde afname ×
        // gewogen tarief / weggestreept volume / overschot-export) zó dat de detailrijen
        // exact optellen tot de kopregel. In 2027 informatief (UI gebruikt ze dan niet).
        salderen,
        fixedNetImportKwh: fxNetImp,
        fixedSurplusExportKwh: fxSurplusExp,
        fixedSalderedKwh: Math.min(fxImpKwh, fxExpKwh),
        fixedSalderTariff: fxSalderTariff,
        fixedPeakImport: fxPeakImp,
        fixedPeakExport: fxPeakExp,
        fixedDalImport: fxDalImp,
        fixedDalExport: fxDalExp,
        fixedImportCost: fxImpCost,
        fixedFeedInCredit: fxFeedCredit,
        fixedFeedInFee: fxFeedPenalt,
        fixedSubscription: fxSub,
        fixedTotalBill: fixedBill,
        totalSavings: fixedBill - dynBill,
        // Deel door |fixedBill|: door de heffingskorting kan een totaal negatief zijn
        // (zon-huishouden krijgt geld terug) → anders zou het % van teken wisselen.
        savingsPct: fixedBill !== 0 ? (fixedBill - dynBill) / Math.abs(fixedBill) * 100 : 0,
        hourlyProfile: hourly,
        weekdayProfile: weekly,
        perDayTotals: dayTot,
        perDayHourly: dayHour,
        epexPct: epexReal + epexFall > 0 ? Math.round(epexReal / (epexReal + epexFall) * 100) : 0
      });
    }
    return out;
  }

  // src/domain/parser.js
  function parseHAHistoryExportCSV(lines, sep, headers, roleMap, dtEnabled) {
    const entityIdx = 0;
    const stateIdx = 1;
    const tsIdx = 2;
    const hourlyData = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim());
      if (cols.length < 3) continue;
      const entity = cols[entityIdx];
      const val = parseFloat(cols[stateIdx]);
      if (isNaN(val)) continue;
      const ms = new Date(cols[tsIdx]).getTime();
      if (isNaN(ms)) continue;
      const hourMs = Math.floor(ms / (3600 * 1e3)) * (3600 * 1e3);
      if (!hourlyData[entity]) hourlyData[entity] = {};
      if (!hourlyData[entity][hourMs] || hourlyData[entity][hourMs].ms < ms) {
        hourlyData[entity][hourMs] = { ms, val };
      }
    }
    const stats = {};
    for (const [entity, hours] of Object.entries(hourlyData)) {
      stats[entity] = Object.entries(hours).sort((a, b) => Number(a[0]) - Number(b[0])).map(([hourMs, data]) => ({
        start: Number(hourMs),
        sum: data.val
      }));
    }
    return processHAStatistics(stats, roleMap, dtEnabled);
  }
  async function parseHAStatisticsWideCSVAsync(lines, sep, headers, showCsvMapModal2, dtEnabled = true) {
    const timestamps = headers.slice(3).map((h) => new Date(h.trim()));
    if (timestamps.some((d) => isNaN(d.getTime()))) {
      throw new Error("Ongeldige tijdstempels in CSV-header. Controleer het bestand.");
    }
    const sensorMap = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep);
      if (cols.length < 4) continue;
      const entityId = cols[0].trim();
      const unit = cols[2]?.trim() || "kWh";
      const values = cols.slice(3).map((v) => {
        const n = parseFloat(v.trim());
        return isNaN(n) || n < 0 ? 0 : n;
      });
      sensorMap[entityId] = { values, unit };
    }
    const entities = Object.keys(sensorMap);
    if (entities.length === 0) {
      throw new Error("Geen sensoren gevonden in het CSV-bestand.");
    }
    function findSensor(patterns) {
      for (const p of patterns) {
        const key = entities.find((k) => k.toLowerCase().includes(p));
        if (key) return { id: key, values: sensorMap[key].values };
      }
      return null;
    }
    const imp1Match = findSensor(["import_tariff_1", "import_t1", "afname_tarief_1", "delivery_tariff_1"]);
    const imp2Match = findSensor(["import_tariff_2", "import_t2", "afname_tarief_2", "delivery_tariff_2"]);
    const exp1Match = findSensor(["export_tariff_1", "export_t1", "return_tariff_1", "teruglevering_tariff_1"]);
    const exp2Match = findSensor(["export_tariff_2", "export_t2", "return_tariff_2", "teruglevering_tariff_2"]);
    const solarMatch = findSensor(["solar", "sol", "zon", "opwek", "pv", "inverter"]);
    const evMatch = findSensor(["ev", "charger", "laadpaal", "auto", "wallbox"]);
    const hpMatch = findSensor(["hp", "heatpump", "warmtepomp", "nibe", "compressor"]);
    const batInMatch = findSensor(["bat_in", "battery_charge", "batterij_laden", "powerwall_charge"]);
    const batOutMatch = findSensor(["bat_out", "battery_discharge", "batterij_ontladen", "powerwall_discharge"]);
    const selection = await showCsvMapModal2(entities, {
      imp1: imp1Match?.id || "",
      imp2: imp2Match?.id || "",
      exp1: exp1Match?.id || "",
      exp2: exp2Match?.id || "",
      solar: solarMatch?.id || "",
      ev: evMatch?.id || "",
      hp: hpMatch?.id || "",
      batIn: batInMatch?.id || "",
      batOut: batOutMatch?.id || ""
    });
    const getSensorValuesKwh = (entityId) => {
      if (!entityId || !sensorMap[entityId]) return null;
      const { values, unit } = sensorMap[entityId];
      const isWattBased = unit.toLowerCase() === "wh" || unit.toLowerCase() === "w";
      if (isWattBased) {
        return values.map((v) => v / 1e3);
      }
      return values;
    };
    const imp1 = getSensorValuesKwh(selection.imp1);
    const imp2 = getSensorValuesKwh(selection.imp2);
    const exp1 = getSensorValuesKwh(selection.exp1);
    const exp2 = getSensorValuesKwh(selection.exp2);
    const solar = getSensorValuesKwh(selection.solar);
    const ev = getSensorValuesKwh(selection.ev);
    const hp = getSensorValuesKwh(selection.hp);
    const batIn = getSensorValuesKwh(selection.batIn);
    const batOut = getSensorValuesKwh(selection.batOut);
    const raw = [];
    for (let i = 0; i < timestamps.length; i++) {
      const rec = {
        ts: timestamps[i],
        import_t1: imp1 ? imp1[i] || 0 : 0,
        import_t2: imp2 ? imp2[i] || 0 : 0,
        export_t1: exp1 ? exp1[i] || 0 : 0,
        export_t2: exp2 ? exp2[i] || 0 : 0
      };
      if (solar) rec.solar_yield = solar[i] || 0;
      if (ev) rec.ev = ev[i] || 0;
      if (hp) rec.hp = hp[i] || 0;
      if (batIn) rec.batIn = batIn[i] || 0;
      if (batOut) rec.batOut = batOut[i] || 0;
      raw.push(rec);
    }
    const hourly = normalizeToHourly(raw);
    const records = untangleHourlyRecords(hourly, dtEnabled, {
      ev: !!ev,
      hp: !!hp,
      battery: !!(batIn || batOut)
    });
    console.info(
      `HA Statistics CSV: ${records.length} uurrecords, sensors:`,
      {
        imp1: !!imp1,
        imp2: !!imp2,
        exp1: !!exp1,
        exp2: !!exp2,
        solar: !!solar,
        ev: !!ev,
        hp: !!hp,
        bat: !!(batIn || batOut),
        untangle: records.untangle.active
      }
    );
    return records;
  }
  function normHeader(h) {
    return h.toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
  }
  function parseDutchFloat(s) {
    if (!s) return 0;
    return Math.max(0, parseFloat(String(s).trim().replace(",", ".")) || 0);
  }
  function parseFlexDate(datePart, timePart = "") {
    const s = (datePart + (timePart ? " " + timePart : "")).trim();
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      return new Date(
        parseInt(m[3]),
        parseInt(m[2]) - 1,
        parseInt(m[1]),
        parseInt(m[4] || 0),
        parseInt(m[5] || 0),
        parseInt(m[6] || 0)
      );
    }
    return null;
  }
  var OPTIONAL_HOURLY_FIELDS = ["solar_yield", "ev", "hp", "batIn", "batOut"];
  function normalizeToHourly(raw) {
    if (raw.length === 0) return [];
    const HOUR_MS2 = 36e5;
    const optFields = OPTIONAL_HOURLY_FIELDS.filter((f) => raw[0][f] !== void 0 && raw[0][f] !== null);
    const toRec = (ms, src) => {
      const rec = {
        timestamp: new Date(ms).toISOString(),
        import_t1: src.import_t1,
        import_t2: src.import_t2,
        export_t1: src.export_t1,
        export_t2: src.export_t2
      };
      for (const f of optFields) rec[f] = src[f] || 0;
      return rec;
    };
    let minGap = Infinity;
    for (let i = 1; i < raw.length; i++) {
      const g = raw[i].ts - raw[i - 1].ts;
      if (g > 0 && g < minGap) minGap = g;
    }
    if (minGap !== Infinity && minGap > HOUR_MS2) {
      throw new Error(
        "Deze CSV heeft dag-resolutie (of grover) \u2014 voor de simulatie is uur- of kwartierdata nodig. Exporteer per uur (HomeWizard: 'per uur'; netbeheerder: kies uur- of kwartierwaarden)."
      );
    }
    if (minGap === Infinity || minGap >= HOUR_MS2) {
      return raw.map((r) => toRec(r.ts.getTime(), r));
    }
    const buckets = /* @__PURE__ */ new Map();
    for (const r of raw) {
      const key = Math.floor(r.ts.getTime() / HOUR_MS2) * HOUR_MS2;
      let b = buckets.get(key);
      if (!b) {
        b = { import_t1: 0, import_t2: 0, export_t1: 0, export_t2: 0 };
        for (const f of optFields) b[f] = 0;
        buckets.set(key, b);
      }
      b.import_t1 += r.import_t1;
      b.import_t2 += r.import_t2;
      b.export_t1 += r.export_t1;
      b.export_t2 += r.export_t2;
      for (const f of optFields) b[f] += r[f] || 0;
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a - b).map(([ms, v]) => toRec(ms, v));
  }
  function untangleHourlyRecords(records, dtEnabled, devices) {
    const anyDevice = dtEnabled && !!(devices.ev || devices.hp || devices.battery);
    let totBatIn = 0, totBatOut = 0;
    const out = records.map((r) => {
      const ev = r.ev || 0, hp = r.hp || 0, batIn = r.batIn || 0, batOut = r.batOut || 0;
      totBatIn += batIn;
      totBatOut += batOut;
      let rec;
      if (anyDevice) {
        const baseNet = r.import_t1 + r.import_t2 - r.export_t1 - r.export_t2 - ev - hp - batIn + batOut;
        rec = {
          import_t1: Math.max(0, baseNet),
          import_t2: 0,
          export_t1: Math.max(0, -baseNet),
          export_t2: 0
        };
      } else {
        rec = {
          import_t1: r.import_t1,
          import_t2: r.import_t2,
          export_t1: r.export_t1,
          export_t2: r.export_t2
        };
      }
      rec.timestamp = r.timestamp;
      rec.solar_yield = r.solar_yield !== void 0 ? r.solar_yield : null;
      return rec;
    });
    out.untangle = {
      active: anyDevice,
      batIn: totBatIn,
      batOut: totBatOut,
      batterySensorSuspect: (totBatIn > 0 || totBatOut > 0) && totBatOut > totBatIn * 1.05,
      devices: { ev: !!devices.ev, hp: !!devices.hp, battery: !!devices.battery }
    };
    return out;
  }
  var COLUMN_PATTERNS = {
    imp1: [
      "import_t1",
      "afname_t1",
      "verbruik_piek",
      "delivery_t1",
      "verbruik hoog",
      "afname hoog",
      "levering hoog",
      "stroom verbruik t1",
      "afname t1",
      "verbruik t1",
      "import high",
      "import-high",
      "consumption t1",
      "consumption high"
    ],
    imp2: [
      "import_t2",
      "afname_t2",
      "verbruik_dal",
      "delivery_t2",
      "verbruik laag",
      "afname laag",
      "levering laag",
      "stroom verbruik t2",
      "afname t2",
      "verbruik t2",
      "import low",
      "import-low",
      "consumption t2",
      "consumption low"
    ],
    exp1: [
      "export_t1",
      "teruglevering_t1",
      "return_t1",
      "teruglevering hoog",
      "retour hoog",
      "stroom teruglever t1",
      "teruglevering t1",
      "productie t1",
      "export high",
      "export-high",
      "production t1",
      "production high"
    ],
    exp2: [
      "export_t2",
      "teruglevering_t2",
      "return_t2",
      "teruglevering laag",
      "retour laag",
      "stroom teruglever t2",
      "teruglevering t2",
      "productie t2",
      "export low",
      "export-low",
      "production t2",
      "production low"
    ]
  };
  function detectColumnIndices(norm) {
    const find = (names) => {
      for (const n of names) {
        const i = norm.indexOf(n);
        if (i !== -1) return i;
      }
      return -1;
    };
    const tsIdx = find(["timestamp", "datetime", "datum", "date"]);
    if (tsIdx === -1) return null;
    const timeIdx = find(["van", "from", "start", "start time", "starttijd"]);
    const i1Idx = find(COLUMN_PATTERNS.imp1);
    const i2Idx = find(COLUMN_PATTERNS.imp2);
    if (i1Idx === -1 && i2Idx === -1) return null;
    const e1Idx = find(COLUMN_PATTERNS.exp1);
    const e2Idx = find(COLUMN_PATTERNS.exp2);
    return { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx };
  }
  function parseLongCSVCore(lines, sep, { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx }) {
    const pf = (cols, i) => i !== -1 ? parseDutchFloat(cols[i]) : 0;
    const raw = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim());
      if (!cols[tsIdx]) continue;
      const ts = parseFlexDate(cols[tsIdx], timeIdx !== -1 ? cols[timeIdx] || "" : "");
      if (!ts) continue;
      raw.push({
        ts,
        import_t1: pf(cols, i1Idx),
        import_t2: pf(cols, i2Idx),
        export_t1: pf(cols, e1Idx),
        export_t2: pf(cols, e2Idx)
      });
    }
    return normalizeToHourly(raw);
  }
  function guessColumnRoles(headers) {
    const norm = headers.map(normHeader);
    const find = (patterns) => {
      for (const p of patterns) {
        const i = norm.indexOf(p);
        if (i !== -1) return headers[i];
      }
      return "";
    };
    return {
      imp1: find(COLUMN_PATTERNS.imp1),
      imp2: find(COLUMN_PATTERNS.imp2),
      exp1: find(COLUMN_PATTERNS.exp1),
      exp2: find(COLUMN_PATTERNS.exp2),
      solar: find(["solar", "zon", "opwek", "pv", "zonnepanelen"]),
      ev: find(["ev", "charger", "laadpaal"]),
      hp: find(["hp", "heatpump", "warmtepomp"]),
      batIn: find(["bat_in", "battery_charge", "batterij_laden"]),
      batOut: find(["bat_out", "battery_discharge", "batterij_ontladen"])
    };
  }
  function parseLongCSV(lines, sep, headers) {
    const norm = headers.map(normHeader);
    const colIndices = detectColumnIndices(norm);
    if (!colIndices) return null;
    return parseLongCSVCore(lines, sep, colIndices);
  }
  function parseLongCSVWithMapping(lines, sep, headers, mapping) {
    const norm = headers.map(normHeader);
    const findIdx = (name) => {
      if (!name) return -1;
      return norm.indexOf(normHeader(name));
    };
    const tsIdx = norm.findIndex((h) => ["timestamp", "datetime", "datum", "date"].includes(h));
    if (tsIdx === -1) throw new Error("Geen tijdstempelkolom gevonden.");
    const timeIdx = norm.findIndex((h) => ["van", "from", "start", "start time"].includes(h));
    const i1Idx = findIdx(mapping.imp1), i2Idx = findIdx(mapping.imp2);
    const e1Idx = findIdx(mapping.exp1), e2Idx = findIdx(mapping.exp2);
    if (i1Idx === -1 && i2Idx === -1) throw new Error("Geen import-kolom geselecteerd.");
    return parseLongCSVCore(lines, sep, { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx });
  }
  function processHAStatistics(stats, roleMap, dtEnabled = true) {
    const hourlySum = {};
    const hourlyMean = {};
    for (const [entId, rows] of Object.entries(stats)) {
      const sumMap = /* @__PURE__ */ new Map();
      const meanMap = /* @__PURE__ */ new Map();
      for (const row of rows) {
        if (row.sum != null) sumMap.set(row.start, row.sum);
        if (row.mean != null) meanMap.set(row.start, row.mean);
      }
      if (sumMap.size > 0) hourlySum[entId] = sumMap;
      if (meanMap.size > 0) hourlyMean[entId] = meanMap;
    }
    const usedEntities = Object.values(roleMap).filter(Boolean);
    if (usedEntities.every((e) => !hourlySum[e] && !hourlyMean[e])) return [];
    const allTs = /* @__PURE__ */ new Set();
    usedEntities.forEach((e) => {
      if (hourlySum[e]) hourlySum[e].forEach((_, t) => allTs.add(t));
      if (hourlyMean[e]) hourlyMean[e].forEach((_, t) => allTs.add(t));
    });
    const timestamps = Array.from(allTs).sort((a, b) => a - b);
    let totBatIn = 0, totBatOut = 0;
    const anyDevice = dtEnabled && !!(roleMap.ev || roleMap.hp || roleMap.batIn || roleMap.batOut);
    const highWaterMarks = {};
    const records = [];
    for (let i = 1; i < timestamps.length; i++) {
      const prev = timestamps[i - 1];
      const curr = timestamps[i];
      if (curr - prev > 2 * 3600 * 1e3) continue;
      const delta = (ent, maxVal = 100) => {
        if (!ent) return 0;
        if (hourlySum[ent]) {
          let a = highWaterMarks[ent];
          if (a === void 0) {
            a = hourlySum[ent].get(prev) ?? null;
            if (a !== null) highWaterMarks[ent] = a;
          }
          const b = hourlySum[ent].get(curr) ?? null;
          if (a === null || b === null) return 0;
          let d = b - a;
          if (d < 0) {
            if (b >= 0 && b < maxVal * 2) {
              d = b;
              highWaterMarks[ent] = b;
            } else {
              return 0;
            }
          } else {
            highWaterMarks[ent] = b;
          }
          return d >= 0 && d <= maxVal ? d : 0;
        }
        if (hourlyMean[ent]) {
          const val = hourlyMean[ent].get(curr) ?? null;
          if (val === null) return 0;
          return val > 0 && val <= maxVal ? val : 0;
        }
        return 0;
      };
      const deltaSolar = (ent) => {
        const isWattBased = roleMap.solarUnit === "Wh" || roleMap.solarUnit === "W";
        return isWattBased ? delta(ent, 2e4) : delta(ent, 100);
      };
      const rawSolarDelta = roleMap.solar ? deltaSolar(roleMap.solar) : null;
      const solarYieldKwh = rawSolarDelta !== null ? roleMap.solarUnit === "Wh" || roleMap.solarUnit === "W" ? rawSolarDelta / 1e3 : rawSolarDelta : null;
      const deviceKwh = (ent, unit) => {
        if (!ent) return 0;
        const isWattBased = unit === "Wh" || unit === "W";
        const d = delta(ent, isWattBased ? 2e4 : 100);
        return isWattBased ? d / 1e3 : d;
      };
      const evLoad = deviceKwh(roleMap.ev, roleMap.evUnit);
      const hpLoad = deviceKwh(roleMap.hp, roleMap.hpUnit);
      const batIn = deviceKwh(roleMap.batIn, roleMap.batInUnit);
      const batOut = deviceKwh(roleMap.batOut, roleMap.batOutUnit);
      const imp1 = delta(roleMap.imp1), imp2 = delta(roleMap.imp2);
      const exp1 = delta(roleMap.exp1), exp2 = delta(roleMap.exp2);
      totBatIn += batIn;
      totBatOut += batOut;
      let rec;
      if (anyDevice) {
        const baseNet = imp1 + imp2 - exp1 - exp2 - evLoad - hpLoad - batIn + batOut;
        rec = {
          import_t1: Math.max(0, baseNet),
          import_t2: 0,
          export_t1: Math.max(0, -baseNet),
          export_t2: 0
        };
      } else {
        rec = { import_t1: imp1, import_t2: imp2, export_t1: exp1, export_t2: exp2 };
      }
      rec.timestamp = new Date(curr).toISOString();
      rec.solar_yield = solarYieldKwh;
      records.push(rec);
    }
    records.untangle = {
      active: anyDevice,
      batIn: totBatIn,
      batOut: totBatOut,
      batterySensorSuspect: (totBatIn > 0 || totBatOut > 0) && totBatOut > totBatIn * 1.05,
      devices: {
        ev: !!roleMap.ev,
        hp: !!roleMap.hp,
        battery: !!(roleMap.batIn || roleMap.batOut)
      }
    };
    return records;
  }

  // src/ui/charts.js
  var afnameDetailView = "hour";
  function setAfnameView(v) {
    afnameDetailView = v;
    renderAfnameDetail2();
  }
  window.setAfnameView = setAfnameView;
  var _activeTouchTip = null;
  function _bindTouchTip(overlay, show, hide) {
    overlay.setAttribute("data-charttip", "1");
    overlay.addEventListener("touchstart", () => {
      if (_activeTouchTip && _activeTouchTip !== hide) _activeTouchTip();
      show();
      _activeTouchTip = hide;
    }, { passive: true });
  }
  if (typeof document !== "undefined" && !document._chartTipDismissBound) {
    document._chartTipDismissBound = true;
    document.addEventListener("touchstart", (e) => {
      if (!_activeTouchTip) return;
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-charttip") === "1") return;
      _activeTouchTip();
      _activeTouchTip = null;
    }, { passive: true });
  }
  var ICON_CHECK = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  var ICON_WARN = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  var ICON_INFO = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-blue);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  var ICON_BATTERY = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-cyan);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>`;
  var {
    activeViewType,
    overviewMode,
    overviewMetric,
    sankeyInterval,
    sankeyValue,
    simMode,
    simDrillDay,
    profileVisibleLines,
    activeSimulation,
    epexWarnDismissed,
    calibratedProfile,
    calibrationMeta,
    liveEnergyTax
  } = appStore.getState();
  appStore.subscribe((state) => {
    activeViewType = state.activeViewType;
    overviewMode = state.overviewMode;
    overviewMetric = state.overviewMetric;
    sankeyInterval = state.sankeyInterval;
    sankeyValue = state.sankeyValue;
    simMode = state.simMode;
    simDrillDay = state.simDrillDay;
    profileVisibleLines = state.profileVisibleLines;
    activeSimulation = state.activeSimulation;
    epexWarnDismissed = state.epexWarnDismissed;
    calibratedProfile = state.calibratedProfile;
    calibrationMeta = state.calibrationMeta;
    liveEnergyTax = state.liveEnergyTax;
  });
  var __chartsDependencies = {
    activeSimulation: null,
    fullYearData: null,
    energyData: null,
    dataMeta: null,
    document: typeof document !== "undefined" ? document : null
  };
  function setChartsDependencies(deps) {
    __chartsDependencies = { ...__chartsDependencies, ...deps };
  }
  var hwOpenState = { hp: false, ev: false, bat: false, sol: false };
  function renderChart() {
    if (!__chartsDependencies.activeSimulation?.hourlyProfile) return;
    const container = document.getElementById("chart-svg-container");
    const svg = document.getElementById("chart-svg");
    const tooltip = document.getElementById("chart-tooltip");
    const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
    const tax = liveEnergyTax;
    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const profile = __chartsDependencies.activeSimulation.hourlyProfile;
    const paddingLeft = 40;
    const paddingRight = 45;
    const paddingTop = 20;
    const paddingBottom = 30;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const median = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const mean = (arr) => arr.length ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
    const hourMedians = profile.map((h) => ({
      imp: mean(h.imports),
      exp: mean(h.exports),
      spot: median(h.spots),
      solar: mean(h.solar || []),
      ev: mean(h.ev || []),
      hp: mean(h.hp || []),
      batCharge: mean(h.batCharge || []),
      batDischarge: mean(h.batDischarge || [])
    }));
    const isDtActive = __chartsDependencies.activeSimulation?.records?.untangle?.active || window.digitalTwinMode && window.digitalTwinMode.active;
    document.querySelectorAll(".dt-legend").forEach((el) => {
      el.style.display = isDtActive ? "inline-flex" : "none";
    });
    let maxEnergy = 0.1;
    hourMedians.forEach((h) => {
      if (profileVisibleLines.imp && h.imp > maxEnergy) maxEnergy = h.imp;
      if (profileVisibleLines.exp && h.exp > maxEnergy) maxEnergy = h.exp;
      if (isDtActive) {
        if (profileVisibleLines.solar && h.solar > maxEnergy) maxEnergy = h.solar;
        if (profileVisibleLines.ev && h.ev > maxEnergy) maxEnergy = h.ev;
        if (profileVisibleLines.hp && h.hp > maxEnergy) maxEnergy = h.hp;
        if (profileVisibleLines.bat && h.batCharge > maxEnergy) maxEnergy = h.batCharge;
        if (profileVisibleLines.bat && h.batDischarge > maxEnergy) maxEnergy = h.batDischarge;
      }
    });
    maxEnergy *= 1.15;
    let minPrice = 0;
    let maxPrice = 0.4;
    hourMedians.forEach((h) => {
      const p = toConsumerPrice(h.spot, markup, tax);
      if (p > maxPrice) maxPrice = p;
      if (p < minPrice) minPrice = p;
    });
    if (minPrice < 0) {
      minPrice = Math.floor(minPrice * 20) / 20;
    }
    if (maxPrice > 0.4) {
      maxPrice = Math.ceil(maxPrice * 20) / 20;
    }
    const getX = (hour) => paddingLeft + hour / 23 * chartWidth;
    const getYEnergy = (val) => paddingTop + chartHeight - val / maxEnergy * chartHeight;
    const getYPrice = (val) => paddingTop + chartHeight - (val - minPrice) / (maxPrice - minPrice) * chartHeight;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const ratio = i / gridLines;
      const y = paddingTop + chartHeight - ratio * chartHeight;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", paddingLeft);
      line.setAttribute("y1", y);
      line.setAttribute("x2", width - paddingRight);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "rgba(255,255,255,0.04)");
      svg.appendChild(line);
      const labelEnergy = document.createElementNS("http://www.w3.org/2000/svg", "text");
      labelEnergy.setAttribute("x", paddingLeft - 8);
      labelEnergy.setAttribute("y", y + 4);
      labelEnergy.setAttribute("text-anchor", "end");
      labelEnergy.setAttribute("fill", "var(--text-muted)");
      labelEnergy.setAttribute("font-size", "9");
      labelEnergy.textContent = `${(ratio * maxEnergy).toFixed(1)} kW`;
      svg.appendChild(labelEnergy);
      const labelPrice = document.createElementNS("http://www.w3.org/2000/svg", "text");
      labelPrice.setAttribute("x", width - paddingRight + 8);
      labelPrice.setAttribute("y", y + 4);
      labelPrice.setAttribute("text-anchor", "start");
      labelPrice.setAttribute("fill", "var(--accent-yellow)");
      labelPrice.setAttribute("font-size", "9");
      const priceVal = minPrice + ratio * (maxPrice - minPrice);
      labelPrice.textContent = `\u20AC ${priceVal.toFixed(2)}/kWh`;
      svg.appendChild(labelPrice);
    }
    if (minPrice < 0) {
      const zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      zeroLine.setAttribute("x1", paddingLeft);
      zeroLine.setAttribute("y1", getYPrice(0));
      zeroLine.setAttribute("x2", width - paddingRight);
      zeroLine.setAttribute("y2", getYPrice(0));
      zeroLine.setAttribute("stroke", "rgba(234, 179, 8, 0.25)");
      zeroLine.setAttribute("stroke-width", "1");
      zeroLine.setAttribute("stroke-dasharray", "2,2");
      svg.appendChild(zeroLine);
    }
    for (let h = 0; h < 24; h += 4) {
      const x = getX(h);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x);
      text.setAttribute("y", height - 10);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "var(--text-muted)");
      text.setAttribute("font-size", "10");
      text.textContent = `${h.toString().padStart(2, "0")}:00`;
      svg.appendChild(text);
    }
    let importPathPoints = [];
    let exportPathPoints = [];
    let pricePathPoints = [];
    let solarPathPoints = [];
    let evPathPoints = [];
    let hpPathPoints = [];
    let batChgPathPoints = [];
    let batDisPathPoints = [];
    for (let h = 0; h < 24; h++) {
      const hm = hourMedians[h];
      importPathPoints.push(`${getX(h)},${getYEnergy(hm.imp)}`);
      exportPathPoints.push(`${getX(h)},${getYEnergy(hm.exp)}`);
      pricePathPoints.push(`${getX(h)},${getYPrice(toConsumerPrice(hm.spot, markup, tax))}`);
      solarPathPoints.push(`${getX(h)},${getYEnergy(hm.solar)}`);
      evPathPoints.push(`${getX(h)},${getYEnergy(hm.ev)}`);
      hpPathPoints.push(`${getX(h)},${getYEnergy(hm.hp)}`);
      batChgPathPoints.push(`${getX(h)},${getYEnergy(hm.batCharge)}`);
      batDisPathPoints.push(`${getX(h)},${getYEnergy(hm.batDischarge)}`);
    }
    const drawLine = (points, color, width2 = "2", dash = null, isArea = false, gradId = null) => {
      if (isArea && gradId) {
        const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
        area.setAttribute("d", `M ${getX(0)},${getYEnergy(0)} L ${points.join(" L ")} L ${getX(23)},${getYEnergy(0)} Z`);
        area.setAttribute("fill", `url(#${gradId})`);
        svg.appendChild(area);
      }
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${points.join(" L ")}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width2);
      if (dash) path.setAttribute("stroke-dasharray", dash);
      svg.appendChild(path);
    };
    if (profileVisibleLines.imp) {
      drawLine(importPathPoints, "var(--accent-cyan)", "2", null, true, "import-grad");
    }
    if (profileVisibleLines.exp) {
      drawLine(exportPathPoints, "var(--accent-green)", "2", null, true, "export-grad");
    }
    if (isDtActive) {
      if (profileVisibleLines.solar) {
        drawLine(solarPathPoints, "#eab308", "1.5");
      }
      if (profileVisibleLines.ev) {
        drawLine(evPathPoints, "#667eea", "1.5");
      }
      if (profileVisibleLines.hp) {
        drawLine(hpPathPoints, "#ff758c", "1.5");
      }
      if (profileVisibleLines.bat) {
        drawLine(batChgPathPoints, "#4facfe", "1.5", "3,3");
        drawLine(batDisPathPoints, "#00f2fe", "1.5");
      }
    }
    if (profileVisibleLines.spot) {
      drawLine(pricePathPoints, "var(--accent-yellow)", "2", "4,4");
    }
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const impGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    impGrad.setAttribute("id", "import-grad");
    impGrad.setAttribute("x1", "0");
    impGrad.setAttribute("y1", "0");
    impGrad.setAttribute("x2", "0");
    impGrad.setAttribute("y2", "1");
    impGrad.innerHTML = `<stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0.0"/>`;
    defs.appendChild(impGrad);
    const expGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    expGrad.setAttribute("id", "export-grad");
    expGrad.setAttribute("x1", "0");
    expGrad.setAttribute("y1", "0");
    expGrad.setAttribute("x2", "0");
    expGrad.setAttribute("y2", "1");
    expGrad.innerHTML = `<stop offset="0%" stop-color="var(--accent-green)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--accent-green)" stop-opacity="0.0"/>`;
    defs.appendChild(expGrad);
    svg.appendChild(defs);
    const hoverLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hoverLine.setAttribute("y1", paddingTop);
    hoverLine.setAttribute("y2", paddingTop + chartHeight);
    hoverLine.setAttribute("stroke", "rgba(255,255,255,0.2)");
    hoverLine.setAttribute("stroke-width", "1");
    hoverLine.style.display = "none";
    svg.appendChild(hoverLine);
    const dotImp = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dotImp.setAttribute("r", "5");
    dotImp.setAttribute("fill", "var(--accent-cyan)");
    dotImp.style.display = "none";
    svg.appendChild(dotImp);
    const dotExp = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dotExp.setAttribute("r", "5");
    dotExp.setAttribute("fill", "var(--accent-green)");
    dotExp.style.display = "none";
    svg.appendChild(dotExp);
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    overlay.setAttribute("x", paddingLeft);
    overlay.setAttribute("y", paddingTop);
    overlay.setAttribute("width", chartWidth);
    overlay.setAttribute("height", chartHeight);
    overlay.setAttribute("fill", "transparent");
    overlay.style.cursor = "crosshair";
    overlay.style.touchAction = "none";
    svg.appendChild(overlay);
    const moveTo = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const relativeX = (mouseX - paddingLeft) / chartWidth;
      let hour = Math.round(relativeX * 23);
      if (hour < 0) hour = 0;
      if (hour > 23) hour = 23;
      const x = getX(hour);
      const hm = hourMedians[hour];
      const impVal = hm.imp;
      const expVal = hm.exp;
      hoverLine.setAttribute("x1", x);
      hoverLine.setAttribute("x2", x);
      hoverLine.style.display = "block";
      if (profileVisibleLines.imp) {
        dotImp.setAttribute("cx", x);
        dotImp.setAttribute("cy", getYEnergy(impVal));
        dotImp.style.display = "block";
      } else {
        dotImp.style.display = "none";
      }
      if (profileVisibleLines.exp) {
        dotExp.setAttribute("cx", x);
        dotExp.setAttribute("cy", getYEnergy(expVal));
        dotExp.style.display = "block";
      } else {
        dotExp.style.display = "none";
      }
      tooltip.style.display = "block";
      let extraHtml = "";
      if (isDtActive) {
        if (profileVisibleLines.solar) {
          extraHtml += `<div class="tooltip-row"><span>Zonnepanelen:</span><span class="val" style="color:#eab308;">${hm.solar.toFixed(2)} kW</span></div>`;
        }
        if (profileVisibleLines.ev) {
          extraHtml += `<div class="tooltip-row"><span>Auto:</span><span class="val" style="color:#667eea;">${hm.ev.toFixed(2)} kW</span></div>`;
        }
        if (profileVisibleLines.hp) {
          extraHtml += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:#ff758c;">${hm.hp.toFixed(2)} kW</span></div>`;
        }
        if (profileVisibleLines.bat) {
          extraHtml += `<div class="tooltip-row"><span>Accu Laden:</span><span class="val" style="color:#4facfe;">${hm.batCharge.toFixed(2)} kW</span></div>`;
          extraHtml += `<div class="tooltip-row"><span>Accu Ontladen:</span><span class="val" style="color:#00f2fe;">${hm.batDischarge.toFixed(2)} kW</span></div>`;
        }
      }
      const pureSpot = hm.spot;
      const consPrice = toConsumerPrice(pureSpot, markup, tax);
      const rawEpex = (pureSpot / 1.21).toFixed(3);
      tooltip.innerHTML = `
      <h4>${hour.toString().padStart(2, "0")}:00 - ${(hour + 1).toString().padStart(2, "0")}:00 uur</h4>
      <div class="tooltip-row">
        <span>Gem. Afname:</span>
        <span class="val" style="color: var(--accent-cyan);">${impVal.toFixed(2)} kW</span>
      </div>
      <div class="tooltip-row">
        <span>Gem. Teruglevering:</span>
        <span class="val" style="color: var(--accent-green);">${expVal.toFixed(2)} kW</span>
      </div>
      ${extraHtml}
      <div class="tooltip-row">
        <span>Consumentenprijs (all-in):</span>
        <span class="val" style="color: var(--accent-yellow);">\u20AC ${consPrice.toFixed(3)} / kWh</span>
      </div>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.2rem;">
        EPEX markt \u20AC${rawEpex} \xD7 1.21 + opslag \u20AC${markup.toFixed(3)} (incl. BTW) + EB \u20AC${tax.toFixed(3)} = all-in \u20AC${consPrice.toFixed(3)}
      </div>
    `;
      const ttW = tooltip.offsetWidth || 240;
      let tx = x + 15;
      if (tx + ttW > width) tx = x - ttW - 15;
      if (tx < 0) tx = 5;
      tooltip.style.left = `${tx}px`;
      tooltip.style.top = `${getYEnergy(impVal) - 40}px`;
    };
    const hideAll = () => {
      hoverLine.style.display = "none";
      dotImp.style.display = "none";
      dotExp.style.display = "none";
      tooltip.style.display = "none";
    };
    overlay.addEventListener("mousemove", (e) => moveTo(e.clientX));
    overlay.addEventListener("mouseleave", hideAll);
    const touchScrub = (e) => {
      if (e.touches[0]) {
        e.preventDefault();
        moveTo(e.touches[0].clientX);
      }
    };
    overlay.addEventListener("touchstart", touchScrub, { passive: false });
    overlay.addEventListener("touchmove", touchScrub, { passive: false });
    overlay.addEventListener("touchend", hideAll);
  }
  function _updateSimHeader() {
    const modeLabel = document.getElementById("sim-chart-mode-label");
    const subtitle = document.getElementById("sim-chart-subtitle");
    const backBtn = document.getElementById("sim-back-btn");
    const pct = activeSimulation?.epexPct ?? 0;
    const epexNote = pct === 100 ? "" : ` \xB7 ${pct > 0 ? pct + "% echte EPEX" : `${ICON_WARN} gesimuleerde prijzen`}`;
    if (simDrillDay) {
      const d = /* @__PURE__ */ new Date(simDrillDay + "T12:00:00");
      modeLabel.textContent = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      subtitle.innerHTML = `Kosten per uur \xB7 groen = dynamisch goedkoper \xB7 rood = duurder${epexNote}`;
      if (backBtn) backBtn.style.display = "";
    } else {
      modeLabel.textContent = simMode === "week" ? "Week" : "Dag";
      subtitle.innerHTML = simMode === "week" ? `Totale kosten per week \xB7 klik op een balk voor uurdetail${epexNote}` : `Totale kosten per dag \xB7 klik op een dag voor uurdetail${epexNote}`;
      if (backBtn) backBtn.style.display = "none";
    }
  }
  function _renderSimDrill() {
    const dayData = activeSimulation?.perDayHourly?.[simDrillDay];
    if (!dayData) {
      appStore.setState({ simDrillDay: null });
      renderSimChart();
      return;
    }
    const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
    const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;
    const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
    const tax = liveEnergyTax;
    const dynVals = dayData.map((h) => h ? h.dynCost : 0);
    const fixedVals = dayData.map((h) => {
      if (!h) return 0;
      const dt = /* @__PURE__ */ new Date(simDrillDay + "T00:00:00");
      dt.setHours(h ? dayData.indexOf(h) : 0);
      return h.fixedCost;
    });
    const spots = dayData.map((h) => h ? h.spot : null);
    const container = document.getElementById("sim-svg-container");
    const svg = document.getElementById("sim-svg");
    const tooltip = document.getElementById("sim-tooltip");
    const W = container.clientWidth, H = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const PAD_L = 42, PAD_R = 40, PAD_T = 14, PAD_B = 28;
    const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B;
    const N = 24, barSlot = cW / N, barW = Math.max(2, barSlot * 0.38);
    const maxCost = Math.max(...dynVals.map(Math.abs), ...fixedVals.map(Math.abs), 1e-3) * 1.2;
    const zero = PAD_T + cH / 2;
    const mk = (tag, a) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const yOf = (v) => zero - v / maxCost * (cH / 2);
    const xOf = (h) => PAD_L + h * barSlot + barSlot / 2;
    svg.appendChild(mk("line", { x1: PAD_L, y1: zero, x2: W - PAD_R, y2: zero, stroke: "rgba(255,255,255,0.2)", "stroke-width": "1" }));
    [0.5, 1].forEach((r) => [1, -1].forEach((s) => {
      const y = zero - s * r * (cH / 2);
      svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(255,255,255,0.04)" }));
    }));
    ["1", "0", "-1"].forEach((_, i) => {
      const val = (1 - i) * maxCost, y = zero - (1 - i) * (cH / 2);
      const lbl = mk("text", { x: PAD_L - 5, y: y + 4, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
      const fmt = (v) => v >= 0.01 ? `\u20AC${v.toFixed(2)}` : `${(v * 100).toFixed(1)}\xA2`;
      lbl.textContent = fmt(Math.abs(val)) + (val < 0 ? " +" : val > 0 ? " \u2212" : "");
      svg.appendChild(lbl);
    });
    for (let h = 0; h < 24; h++) {
      const dyn = dynVals[h], fx = fixedVals[h], diff = dyn - fx;
      svg.appendChild(mk("rect", { x: PAD_L + h * barSlot, y: PAD_T, width: barSlot, height: cH, fill: diff < 0 ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
      [[dyn, "rgba(0,242,254,0.75)", -barW * 0.55], [fx, "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
        const y1 = yOf(0), y2 = yOf(val), top = Math.min(y1, y2), ht = Math.abs(y2 - y1);
        if (ht < 0.5) return;
        svg.appendChild(mk("rect", { x: xOf(h) + off, y: top, width: barW, height: ht, fill: col, rx: "1" }));
      });
    }
    const validSpots = spots.filter((s) => s != null);
    if (validSpots.length) {
      const pricesList = validSpots.map((s) => toConsumerPrice(s, markup, tax)).concat([fixedPeak, fixedDal]);
      let priceMin = 0;
      let priceMax = 0.1;
      pricesList.forEach((p) => {
        if (p > priceMax) priceMax = p;
        if (p < priceMin) priceMin = p;
      });
      priceMax *= 1.15;
      if (priceMin < 0) {
        priceMin *= 1.15;
      }
      const yP = (v) => PAD_T + cH - (v - priceMin) / (priceMax - priceMin) * cH;
      const pRX = W - PAD_R + 4;
      [0, 0.5, 1].forEach((r) => {
        const val = priceMin + r * (priceMax - priceMin), y = yP(val);
        const lbl = mk("text", { x: W - PAD_R + 6, y: y + 3, "text-anchor": "start", fill: "rgba(255,255,255,0.35)", "font-size": "7" });
        lbl.textContent = `\u20AC ${val.toFixed(2)}`;
        svg.appendChild(lbl);
      });
      if (priceMin < 0) {
        svg.appendChild(mk("line", {
          x1: PAD_L,
          y1: yP(0),
          x2: W - PAD_R,
          y2: yP(0),
          stroke: "rgba(0, 242, 254, 0.25)",
          "stroke-dasharray": "2,2",
          "stroke-width": "1"
        }));
      }
      const axL = mk("text", { x: W - 2, y: PAD_T + cH / 2, "text-anchor": "middle", fill: "rgba(255,255,255,0.25)", "font-size": "7", transform: `rotate(-90,${W - 2},${PAD_T + cH / 2})` });
      axL.textContent = "\u20AC/kWh";
      svg.appendChild(axL);
      [[fixedPeak, "piek", 0.65], [fixedDal, "dal", 0.35]].forEach(([t, lbl2, xf]) => {
        const y = yP(t);
        svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(102,126,234,0.45)", "stroke-width": "1", "stroke-dasharray": "4,3" }));
        const lt = mk("text", { x: PAD_L + cW * xf, y: y - 2, "text-anchor": "middle", fill: "rgba(102,126,234,0.75)", "font-size": "7" });
        lt.textContent = `vast ${lbl2} \u20AC${t.toFixed(2)}`;
        svg.appendChild(lt);
      });
      const pts = [];
      spots.forEach((s, h) => {
        if (s == null) return;
        const x1 = PAD_L + h * barSlot, x2 = x1 + barSlot, y = yP(toConsumerPrice(s, markup, tax));
        pts.push(pts.length === 0 ? `M${x1},${y}` : `L${x1},${y}`);
        pts.push(`L${x2},${y}`);
      });
      if (pts.length) svg.appendChild(mk("path", { d: pts.join(" "), fill: "none", stroke: "rgba(0,242,254,0.8)", "stroke-width": "1.5" }));
    }
    [0, 4, 8, 12, 16, 20, 23].forEach((h) => {
      const lbl = mk("text", { x: xOf(h), y: H - 8, "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "9" });
      lbl.textContent = `${String(h).padStart(2, "0")}:00`;
      svg.appendChild(lbl);
    });
    for (let h = 0; h < 24; h++) {
      const ov = mk("rect", { x: PAD_L + h * barSlot, y: PAD_T, width: barSlot, height: cH, fill: "transparent", cursor: "crosshair" });
      const show = () => {
        const dyn = dynVals[h], fx = fixedVals[h], diff = dyn - fx;
        document.getElementById("sim-tt-hour").textContent = `${String(h).padStart(2, "0")}:00\u2013${String(h + 1).padStart(2, "0")}:00`;
        document.getElementById("sim-tt-dyn").textContent = `\u20AC ${Math.abs(dyn).toFixed(4)}/uur${dyn < 0 ? " (opbrengst)" : ""}`;
        document.getElementById("sim-tt-fixed").textContent = `\u20AC ${Math.abs(fx).toFixed(4)}/uur${fx < 0 ? " (opbrengst)" : ""}`;
        const de = document.getElementById("sim-tt-diff");
        de.textContent = (diff < 0 ? "\u2212" : "+") + ` \u20AC ${Math.abs(diff).toFixed(4)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
        de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
        const s = spots[h];
        document.getElementById("sim-tt-spot").textContent = s != null ? `Consumentenprijs: \u20AC ${toConsumerPrice(s, markup, tax).toFixed(3)}/kWh` : "";
        tooltip.style.display = "block";
        let tx = xOf(h) + 12;
        if (tx + 200 > W) tx = xOf(h) - 210;
        tooltip.style.left = tx + "px";
        tooltip.style.top = PAD_T + 10 + "px";
        ov.setAttribute("fill", "rgba(255,255,255,0.04)");
      };
      const hide = () => {
        tooltip.style.display = "none";
        ov.setAttribute("fill", "transparent");
      };
      ov.addEventListener("mouseenter", show);
      ov.addEventListener("mouseleave", hide);
      _bindTouchTip(ov, show, hide);
      svg.appendChild(ov);
    }
  }
  function renderSimChart() {
    const card = document.getElementById("sim-chart-card");
    if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    _updateSimHeader();
    if (simDrillDay) {
      _renderSimDrill();
      return;
    }
    const isWeekMode = simMode === "week";
    const pdt = __chartsDependencies.activeSimulation.perDayTotals;
    if (!pdt) return;
    const buckets = /* @__PURE__ */ new Map();
    Object.entries(pdt).sort().forEach(([date, v]) => {
      const key = isWeekMode ? isoWeek(date) : date;
      if (!buckets.has(key)) buckets.set(key, { dyn: 0, fixed: 0, firstDate: date });
      const b = buckets.get(key);
      b.dyn += v.dynCost;
      b.fixed += v.fixedCost;
    });
    const keys = [...buckets.keys()];
    const dyns = keys.map((k) => buckets.get(k).dyn);
    const fixeds = keys.map((k) => buckets.get(k).fixed);
    const N = keys.length;
    if (!N) return;
    let minVal = 0;
    let maxVal = 0.01;
    dyns.forEach((v) => {
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    });
    fixeds.forEach((v) => {
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    });
    maxVal *= 1.15;
    if (minVal < 0) {
      minVal *= 1.15;
    }
    const container = document.getElementById("sim-svg-container");
    const svg = document.getElementById("sim-svg");
    const tooltip = document.getElementById("sim-tooltip");
    const W = container.clientWidth, H = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const PAD_L = 42, PAD_R = 12, PAD_T = 14, PAD_B = 28;
    const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B;
    const barSlot = cW / N, barW = Math.max(2, barSlot * 0.35);
    const mk = (tag, a) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const yOf = (v) => PAD_T + cH - (v - minVal) / (maxVal - minVal) * cH;
    const zeroY = yOf(0);
    const xOf = (i) => PAD_L + i * barSlot + barSlot / 2;
    [0, 0.25, 0.5, 0.75, 1].forEach((r) => {
      const y = PAD_T + cH * (1 - r);
      const val = minVal + r * (maxVal - minVal);
      svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(255,255,255,0.04)" }));
      const lbl = mk("text", { x: PAD_L - 5, y: y + 3, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
      lbl.textContent = (val < 0 ? "\u2212" : "") + `\u20AC${Math.abs(val).toFixed(2)}`;
      svg.appendChild(lbl);
    });
    if (minVal < 0) {
      svg.appendChild(mk("line", {
        x1: PAD_L,
        y1: zeroY,
        x2: W - PAD_R,
        y2: zeroY,
        stroke: "rgba(255,255,255,0.2)",
        "stroke-width": "1"
      }));
    } else {
      svg.appendChild(mk("line", { x1: PAD_L, y1: PAD_T + cH, x2: W - PAD_R, y2: PAD_T + cH, stroke: "rgba(255,255,255,0.15)", "stroke-width": "1" }));
    }
    for (let i = 0; i < N; i++) {
      svg.appendChild(mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: dyns[i] < fixeds[i] ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
      [[dyns[i], "rgba(0,242,254,0.75)", -barW * 0.55], [fixeds[i], "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
        const yVal = yOf(val);
        const top = Math.min(zeroY, yVal);
        const ht = Math.abs(yVal - zeroY);
        if (ht < 0.5) return;
        svg.appendChild(mk("rect", { x: xOf(i) + off, y: top, width: barW, height: ht, fill: col, rx: "1" }));
      });
    }
    const every = Math.ceil(N / 12);
    keys.forEach((k, i) => {
      if (i % every !== 0 && i !== N - 1) return;
      const lbl = mk("text", { x: xOf(i), y: H - 8, "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "8" });
      lbl.textContent = isWeekMode ? k.replace(/^\d{4}-/, "") : (() => {
        const d = /* @__PURE__ */ new Date(k + "T12:00:00");
        return `${d.getDate()}/${d.getMonth() + 1}`;
      })();
      svg.appendChild(lbl);
    });
    for (let i = 0; i < N; i++) {
      const ov = mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: "transparent", cursor: "pointer" });
      const show = () => {
        const diff = dyns[i] - fixeds[i];
        const label = isWeekMode ? keys[i] : (() => {
          const d = /* @__PURE__ */ new Date(keys[i] + "T12:00:00");
          return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
        })();
        document.getElementById("sim-tt-hour").textContent = label + (isWeekMode ? "" : " \xB7 klik voor uurdetail");
        document.getElementById("sim-tt-dyn").textContent = (dyns[i] < 0 ? "\u2212 " : "") + `\u20AC ${Math.abs(dyns[i]).toFixed(2)}`;
        document.getElementById("sim-tt-fixed").textContent = (fixeds[i] < 0 ? "\u2212 " : "") + `\u20AC ${Math.abs(fixeds[i]).toFixed(2)}`;
        const de = document.getElementById("sim-tt-diff");
        de.textContent = (diff < 0 ? "\u2212" : "+") + ` \u20AC ${Math.abs(diff).toFixed(2)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
        de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
        document.getElementById("sim-tt-spot").textContent = "";
        tooltip.style.display = "block";
        let tx = xOf(i) + 12;
        if (tx + 200 > W) tx = xOf(i) - 210;
        tooltip.style.left = tx + "px";
        tooltip.style.top = PAD_T + 10 + "px";
        ov.setAttribute("fill", "rgba(255,255,255,0.04)");
      };
      const hide = () => {
        tooltip.style.display = "none";
        ov.setAttribute("fill", "transparent");
      };
      ov.addEventListener("mouseenter", show);
      ov.addEventListener("mouseleave", hide);
      _bindTouchTip(ov, show, hide);
      ov.addEventListener("click", () => {
        if (!isWeekMode) {
          appStore.setState({ simDrillDay: keys[i] });
        } else {
          appStore.setState({ simDrillDay: buckets.get(keys[i]).firstDate });
        }
        tooltip.style.display = "none";
        renderSimChart();
      });
      svg.appendChild(ov);
    }
  }
  function renderAfnameDetail2() {
    const body = document.getElementById("afname-detail-body");
    if (!body) return;
    const viewToggle = `
    <div style="display:flex;gap:0.3rem;padding:0.4rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.07);">
      <button onclick="setAfnameView('hour')" id="afn-btn-hour"
        style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;border:none;cursor:pointer;
          background:${afnameDetailView === "hour" ? "var(--accent-cyan)" : "rgba(255,255,255,0.08)"};
          color:${afnameDetailView === "hour" ? "#000" : "var(--text-muted)"};">Per uur (gem.)</button>
      <button onclick="setAfnameView('day')" id="afn-btn-day"
        style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;border:none;cursor:pointer;
          background:${afnameDetailView === "day" ? "var(--accent-cyan)" : "rgba(255,255,255,0.08)"};
          color:${afnameDetailView === "day" ? "#000" : "var(--text-muted)"};">Per dag</button>
      <span style="font-size:0.68rem;color:var(--text-muted);margin-left:0.5rem;align-self:center;">
        ${__chartsDependencies.activeSimulation.epexPct === 100 ? `${ICON_CHECK} <span>echte EPEX uurprijzen</span>` : __chartsDependencies.activeSimulation.epexPct > 0 ? `${__chartsDependencies.activeSimulation.epexPct}% echt` : `${ICON_WARN} <span>gesimuleerde prijzen (klik Ophalen)</span>`}
      </span>
    </div>`;
    if (afnameDetailView === "hour") {
      renderAfnameDetailHour(body, viewToggle);
    } else {
      renderAfnameDetailDay(body, viewToggle);
    }
  }
  function renderAfnameDetailHour(body, viewToggle) {
    const hp = __chartsDependencies.activeSimulation?.hourlyProfile;
    if (!hp) {
      body.innerHTML = viewToggle + "<p>Geen data.</p>";
      return;
    }
    const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
    const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;
    const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
    const tax = liveEnergyTax;
    const med = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const hours = Array.from({ length: 24 }, (_, h) => {
      const impKwh = med(hp[h].imports);
      const expKwh = med(hp[h].exports);
      const spot = med(hp[h].spots);
      const consPrice = toConsumerPrice(spot, markup, tax);
      const isPeak = h >= 7 && h < 23;
      const fixedRate = isPeak ? fixedPeak : fixedDal;
      const impCostDyn = impKwh * consPrice;
      const impCostFixed = impKwh * fixedRate;
      return { h, impKwh, expKwh, spot, consPrice, impCostDyn, impCostFixed };
    });
    const maxImpCost = Math.max(...hours.map((r) => Math.max(r.impCostDyn, r.impCostFixed)), 0.01);
    body.innerHTML = viewToggle + `
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead>
        <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;background:var(--glass-bg);">
          <th style="padding:0.3rem 0.4rem;text-align:left;font-weight:500;">Uur</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Gem. afname</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;" title="Ruwe beursprijs excl. BTW/EB/opslag \u2014 voor referentie">EPEX markt</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;" title="All-in consumentenprijs = EPEX + opslag + BTW + EB">All-in prijs</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Dyn kosten/uur</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Vast kosten/uur</th>
        </tr>
      </thead>
      <tbody>
        ${hours.map((r) => {
      const dynCheaper = r.impCostDyn <= r.impCostFixed;
      const barDyn = Math.round(r.impCostDyn / maxImpCost * 55);
      const barFixed = Math.round(r.impCostFixed / maxImpCost * 55);
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.03);background:${dynCheaper ? "rgba(56,239,125,0.03)" : "rgba(255,100,100,0.03)"};">
            <td style="padding:0.2rem 0.4rem;font-variant-numeric:tabular-nums;">${String(r.h).padStart(2, "0")}:00\u2013${String(r.h + 1).padStart(2, "0")}:00</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">${r.impKwh.toFixed(3)} kWh</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:${r.spot / 1.21 > 0.2 ? "var(--accent-orange)" : "var(--text-muted)"};">\u20AC ${(r.spot / 1.21).toFixed(3)}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-cyan);">\u20AC ${r.consPrice.toFixed(3)}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${barDyn}px;height:5px;background:rgba(0,242,254,${dynCheaper ? 0.6 : 0.3});border-radius:2px;"></div>
                <span style="color:${dynCheaper ? "var(--accent-green)" : "var(--accent-orange)"};">\u20AC ${r.impCostDyn.toFixed(4)}</span>
              </div>
            </td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${barFixed}px;height:5px;background:rgba(102,126,234,0.4);border-radius:2px;"></div>
                \u20AC ${r.impCostFixed.toFixed(4)}
              </div>
            </td>
          </tr>`;
    }).join("")}
      </tbody>
    </table>
    <p style="font-size:0.68rem;color:var(--text-muted);padding:0.4rem 0.5rem;">
      Mediaan verbruik per uur over alle dagen \xD7 mediaan consumentenprijs. Rode uren = dynamisch duurder dan vast.
      ${__chartsDependencies.activeSimulation.epexPct < 100 ? `<br>${ICON_WARN} <span>Gesimuleerde prijzen \u2014 met echte EPEX-data (Ophalen) worden winterpieken zichtbaar.</span>` : ""}
    </p>`;
  }
  function renderAfnameDetailDay(body, viewToggle) {
    const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
    if (!pdt) {
      body.innerHTML = viewToggle + "<p>Geen data.</p>";
      return;
    }
    const rows = Object.entries(pdt).sort().map(([date, v]) => {
      const avgPrice = v.impKwh > 0 ? v.impCost / v.impKwh : 0;
      const avgSpot = v.spotN > 0 ? v.spotSum / v.spotN : 0;
      const d = /* @__PURE__ */ new Date(date + "T12:00:00");
      return { label: d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }), ...v, avgPrice, avgSpot };
    });
    const maxCost = Math.max(...rows.map((r) => r.impCost), 0.01);
    body.innerHTML = viewToggle + `
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead>
        <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.08);">
          <th style="padding:0.3rem 0.4rem;text-align:left;font-weight:500;">Datum</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Afname kWh</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Gem. cons.prijs</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Afname kosten</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Teruglevering</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
            <td style="padding:0.2rem 0.4rem;">${r.label}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">${r.impKwh.toFixed(2)} kWh</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-cyan);">${r.avgPrice > 0 ? "\u20AC " + r.avgPrice.toFixed(3) + "/kWh" : "\u2014"}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${Math.round(r.impCost / maxCost * 55)}px;height:5px;background:rgba(0,242,254,0.5);border-radius:2px;"></div>
                \u20AC ${r.impCost.toFixed(3)}
              </div>
            </td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-green);">\u2212\u20AC ${r.expRev.toFixed(3)}</td>
          </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr style="border-top:1px solid rgba(255,255,255,0.12);font-weight:600;">
          <td style="padding:0.3rem 0.4rem;">Totaal</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;">${rows.reduce((s, r) => s + r.impKwh, 0).toFixed(1)} kWh</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;color:var(--accent-cyan);">\u20AC ${(rows.reduce((s, r) => s + r.impCost, 0) / rows.reduce((s, r) => s + r.impKwh, 0)).toFixed(3)}/kWh gem.</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;">\u20AC ${rows.reduce((s, r) => s + r.impCost, 0).toFixed(2)}</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;color:var(--accent-green);">\u2212\u20AC ${rows.reduce((s, r) => s + r.expRev, 0).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>`;
  }
  function renderMonthlyChart() {
    const card = document.getElementById("monthly-chart-card");
    const perDay = __chartsDependencies.activeSimulation?.perDayTotals;
    if (!card || !perDay) {
      if (card) card.style.display = "none";
      return;
    }
    const months = Array.from({ length: 12 }, () => ({ fixed: 0, dyn: 0, has: false }));
    for (const [dk, d] of Object.entries(perDay)) {
      const m = parseInt(dk.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      months[m].fixed += d.fixedCost;
      months[m].dyn += d.dynCost;
      months[m].has = true;
    }
    if (!months.some((m) => m.has)) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    const svg = document.getElementById("monthly-svg");
    const container = document.getElementById("monthly-svg-container");
    const W = container.clientWidth, H = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    };
    const padL = 46, padR = 12, padT = 14, padB = 24;
    const cw = W - padL - padR, ch = H - padT - padB;
    const labels = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    let minV = 0;
    let maxV = 1;
    months.forEach((m) => {
      if (m.has) {
        if (m.fixed > maxV) maxV = m.fixed;
        if (m.dyn > maxV) maxV = m.dyn;
        if (m.fixed < minV) minV = m.fixed;
        if (m.dyn < minV) minV = m.dyn;
      }
    });
    maxV = Math.ceil(maxV * 1.15);
    if (minV < 0) {
      minV = Math.floor(minV * 1.15);
    }
    const yOf = (val) => padT + ch - (val - minV) / (maxV - minV) * ch;
    const zeroY = yOf(0);
    for (let i = 0; i <= 4; i++) {
      const ratio = i / 4;
      const val = minV + ratio * (maxV - minV);
      const y = padT + ch - ratio * ch;
      svg.appendChild(mk("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }));
      const lbl = mk("text", { x: padL - 6, y: y + 3, "text-anchor": "end", "font-size": 9, fill: "var(--text-muted)" });
      lbl.textContent = (val < 0 ? "\u2212" : "") + `\u20AC${Math.abs(Math.round(val))}`;
      svg.appendChild(lbl);
    }
    if (minV < 0) {
      svg.appendChild(mk("line", {
        x1: padL,
        y1: zeroY,
        x2: W - padR,
        y2: zeroY,
        stroke: "rgba(255, 255, 255, 0.15)",
        "stroke-width": 1
      }));
    }
    const groupW = cw / 12;
    const barW = Math.min(13, groupW / 2 - 2);
    months.forEach((m, i) => {
      const gx = padL + groupW * i + groupW / 2;
      const bar = (val, offset, color) => {
        const yVal = yOf(val);
        const barTop = Math.min(zeroY, yVal);
        const barHeight = Math.max(0.5, Math.abs(yVal - zeroY));
        const r = mk("rect", {
          x: gx + offset,
          y: barTop,
          width: barW,
          height: barHeight,
          fill: color,
          rx: 2,
          opacity: 0.85
        });
        const t = document.createElementNS(NS, "title");
        t.textContent = `${labels[i]} \u2014 ` + (val < 0 ? "\u2212" : "") + `\u20AC${Math.abs(val).toFixed(0)}`;
        r.appendChild(t);
        svg.appendChild(r);
      };
      if (m.has) {
        bar(m.fixed, -barW - 1, "var(--accent-indigo)");
        bar(m.dyn, 1, "var(--accent-cyan)");
      }
      const lbl = mk("text", { x: gx, y: H - 7, "text-anchor": "middle", "font-size": 9, fill: m.has ? "var(--text-muted)" : "rgba(255,255,255,0.22)" });
      lbl.textContent = labels[i];
      svg.appendChild(lbl);
    });
  }
  function renderHwChart() {
    const card = document.getElementById("hw-chart-card");
    if (!card || !__chartsDependencies.activeSimulation?.hwEffects) {
      if (card) card.style.display = "none";
      return;
    }
    card.style.display = "";
    const fx = __chartsDependencies.activeSimulation.hwEffects;
    const mf = 1;
    const deviceDefs = [
      {
        key: "hp",
        icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-purple);"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`,
        label: "Warmtepomp",
        data: fx.hp,
        explanation: (d) => {
          const bl = d.cfg?.hpWinterBaseload ?? 0;
          return `<strong>Aanname:</strong> Extra baseload van <strong>${bl} kW</strong> voor de warmtepomp.
          <br><br>
          <strong>Seizoensmodel:</strong> Deze simulatie is seizoensbewust. In de wintermaanden draait de warmtepomp op 130% van de baseload, in lente/herfst op 70%, en in de zomer op slechts 15% (alleen voor tapwater). Daarnaast verbruikt hij 's nachts (22\u201307u) extra energie omdat de buitenlucht kouder is.
          <br><br>
          Bij een <strong>dynamisch contract</strong> profiteer je automatisch van lage nacht- en middagtarieven
          wanneer de pomp het zwaarst draait. Bij <strong>vast</strong> betaal je altijd piek- of daltarief.`;
        }
      },
      {
        key: "ev",
        icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-blue);"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
        label: "Auto (EV)",
        data: fx.ev,
        explanation: (d) => {
          const { evDist, evCons, evSolar } = d.cfg ?? {};
          const dailyKwh = ((evDist ?? 0) * (evCons ?? 0) / 7).toFixed(2);
          return `<strong>Aanname:</strong> ${evDist ?? "?"} km/week \xD7 ${((evCons ?? 0) * 100).toFixed(0)} kWh/100km
          = <strong>${dailyKwh} kWh/dag</strong> extra verbruik.
          <br><br>
          ${evSolar ? `<strong>Solar-match strategie:</strong> Overdag (10\u201316u) laadt de auto direct op zonne-overschot. De resterende behoefte wordt 's nachts slim geladen op de allergoedkoopste uren (bij een spotprijs &lt; \u20AC0,05). Als failsafe wordt er anders tussen 02:00 en 05:00 geladen.` : `<strong>Prijsgestuurd laden:</strong> De simulatie zoekt volautomatisch naar de momenten dat de marktprijs extreem laag is (&lt; \u20AC0,05). Als deze uren er niet zijn, laadt hij als failsafe tussen 02:00 en 05:00 's nachts.`}
          <br><br>
          Bij <strong>dynamisch</strong> pak je hierdoor automatisch de negatieve of supergoedkope uren mee.`;
        }
      },
      {
        key: "bat",
        icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-orange);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>`,
        label: "Thuisaccu",
        data: fx.bat,
        explanation: (d) => {
          const { batCapacity, batPower, batEfficiency, batMode } = d.cfg ?? {};
          const modeText = {
            zelf: `<strong>Maximaal zelfverbruik:</strong> de accu slaat all\xE9\xE9n zonne-overschot op en ontlaadt om je eigen import te dekken. Geen handel met het net.`,
            kosten: `<strong>Kostenbewust:</strong> naast zon laadt de accu \xF3\xF3k in de goedkoopste uren van het net bij \u2014 maar alleen zoveel als nodig om je eigen verbruik te dekken (geen teruglevering).`,
            winst: `<strong>Maximale winst:</strong> de accu koopt goedkoop in \xE9n verkoopt bij hoge prijzen terug aan het net (echte arbitrage). Let op: onder bruto-EB (2027) betaal je belasting over elke ingekochte kWh, dus dit loont alleen bij flinke prijsspreads.`
          }[batMode || "zelf"];
          return `<strong>Aanname:</strong> ${batCapacity ?? "?"} kWh accu, ${batPower ?? "?"} kW vermogen,
          ${batEfficiency ?? "?"}% laad-/ontlaadeffici\xEBntie.
          <br><br>
          ${modeText}
          <br><br>
          <strong>Slim ontladen:</strong> zelfconsumptie verdringt de hele all-in prijs (incl. energiebelasting), dus dat is altijd lonend. Van-het-net laden wordt begrensd op wat je die dag werkelijk zelf kunt gebruiken, zodat de accu geen onnodige stroom (en EB) inkoopt.
          <br><br>
          <em>De accu bespaart bij beide contractvormen, maar de effici\xEBntieverliezen (${100 - (batEfficiency ?? 85)}%) vallen zwaarder op een dynamisch contract waar de prijsmarges kleiner zijn.</em>`;
        }
      }
    ];
    if (fx.sol?.enabled) {
      deviceDefs.push({
        key: "sol",
        icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#f59e0b;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
        label: "Zonnepanelen",
        data: fx.sol,
        explanation: (d) => {
          const kWh = d.cfg?.solarKwh ?? 0;
          return `<strong>Opbrengst:</strong> ${kWh.toLocaleString("nl-NL")} kWh/jaar gemeten via de solar-sensor.
          <br><br>
          <strong>Werking (2027-model, geen saldering):</strong> Elk zonne-uur vermindert de bruto import van het net \u2014 en daarmee ook de energiebelasting (EB wordt geheven over elke ge\xEFmporteerde kWh). Zonne-overschot wordt teruggeleverd aan het net.
          <br><br>
          <strong>Vast contract:</strong> exportoverschot levert het vaste teruglevertarief op (minus eventuele VTK).
          <br><br>
          <strong>Dynamisch contract:</strong> exportopbrengst = kale marktprijs (<em>spot/1,21 \u2212 opslag</em>). Op zon-uren kan de spotprijs laag zijn \u2014 maar zelfconsumptie bespaart dan alsnog de volledige all-in prijs inclusief energiebelasting.`;
        }
      });
    }
    const container = document.getElementById("hw-chart-body");
    container.innerHTML = "";
    const epexPct = __chartsDependencies.activeSimulation.epexPct ?? 0;
    if (epexPct < 100 && !epexWarnDismissed) {
      const warn = document.createElement("div");
      warn.id = "epex-warn-box";
      warn.style.cssText = "position:relative;background:rgba(255,165,0,0.12);border:1px solid rgba(255,165,0,0.3);border-radius:6px;padding:0.5rem 1.9rem 0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.75rem;color:var(--accent-orange);";
      const calibrated = calibratedProfile && calibrationMeta.buckets > 0;
      if (epexPct === 0 && !calibrated) {
        warn.innerHTML = `${ICON_WARN} <strong>Let op: geen echte EPEX-uurprijzen.</strong> De simulatie gebruikt generieke
         <em>seizoensprofielen</em> als noodoplossing (geijkt op NL-marktpatronen: zon-export \u2248 50% van het
         jaargemiddelde) \u2014 een redelijke schatting, maar zonder de echte piek- en negatieve dagen.
         Klik <strong>Ophalen</strong> of laad HA-data om actuele historische EPEX-prijzen te gebruiken.`;
      } else if (epexPct === 0 && calibrated) {
        warn.innerHTML = `${ICON_INFO} <span>De jaarprognose is gevuld met een <strong>prijsprofiel uit je eigen EPEX-historie</strong>
         (${calibrationMeta.samples} echte uurprijzen, ${calibrationMeta.buckets} seizoen\xD7uur-buckets) i.p.v. de generieke profielen.</span>`;
      } else {
        warn.innerHTML = `${ICON_WARN} <span>${epexPct}% echte EPEX-prijzen geladen; de overige ${100 - epexPct}% is ` + (calibrated ? `gevuld met je <strong>eigen gekalibreerde prijsprofiel</strong> (${calibrationMeta.samples} echte uurprijzen).` : `geschat via het generieke seizoensprofiel.</span>`);
      }
      const x = document.createElement("button");
      x.type = "button";
      x.className = "dismiss-x";
      x.textContent = "\xD7";
      x.title = "Verberg deze melding";
      x.setAttribute("data-dismiss", "epex-warn-box");
      warn.appendChild(x);
      container.appendChild(warn);
    }
    const maxAbsAll = Math.max(...deviceDefs.map((d) => Math.max(Math.abs(d.data.fixed * mf), Math.abs(d.data.dyn * mf))), 1);
    deviceDefs.forEach(({ key, icon, label, data, explanation }) => {
      const fixedPm = data.fixed * mf;
      const dynPm = data.dyn * mf;
      const isEnabled = data.enabled;
      const wrap = document.createElement("div");
      wrap.style.cssText = "border-bottom:1px solid rgba(255,255,255,0.06);";
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:auto 1fr;gap:0.75rem;padding:0.55rem 0;cursor:pointer;align-items:start;";
      row.title = "Klik voor berekening";
      const left = document.createElement("div");
      left.style.cssText = "display:flex;align-items:center;gap:0.4rem;min-width:110px;";
      left.innerHTML = `<span style="font-size:1rem;">${icon}</span>
      <span style="font-size:0.8rem;color:${isEnabled ? "var(--text-primary)" : "var(--text-muted)"};">${label}</span>
      <span style="font-size:0.65rem;padding:0.1rem 0.3rem;border-radius:3px;background:${isEnabled ? "rgba(56,239,125,0.15)" : "rgba(255,255,255,0.07)"};color:${isEnabled ? "var(--accent-green)" : "var(--text-muted)"};">${isEnabled ? "aan" : "uit"}</span>`;
      const right = document.createElement("div");
      right.style.cssText = "display:flex;flex-direction:column;gap:4px;";
      const toggleIcon = document.createElement("div");
      toggleIcon.style.cssText = "font-size:0.65rem;color:var(--text-muted);text-align:right;transition:transform 0.2s;";
      toggleIcon.id = `hw-toggle-${key}`;
      toggleIcon.textContent = "\u25BC uitleg";
      [
        [`Vast: ${fixedPm >= 0 ? "+" : ""}\u20AC${Math.abs(fixedPm).toFixed(2)}/jaar`, fixedPm, "var(--accent-indigo)"],
        [`Dynamisch: ${dynPm >= 0 ? "+" : ""}\u20AC${Math.abs(dynPm).toFixed(2)}/jaar`, dynPm, "var(--accent-cyan)"]
      ].forEach(([lbl2, val, color]) => {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;align-items:center;gap:0.4rem;";
        const barTrack = document.createElement("div");
        barTrack.style.cssText = "flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;";
        const bar = document.createElement("div");
        const pct = Math.min(100, Math.abs(val) / maxAbsAll * 100);
        const isNeg = val < 0;
        bar.style.cssText = `height:100%;width:${pct}%;background:${isNeg ? "var(--accent-green)" : color};opacity:0.75;border-radius:4px;`;
        barTrack.appendChild(bar);
        const txt = document.createElement("span");
        txt.style.cssText = `font-size:0.7rem;color:${isNeg ? "var(--accent-green)" : color};white-space:nowrap;min-width:110px;`;
        txt.textContent = lbl2;
        line.appendChild(txt);
        line.appendChild(barTrack);
        right.appendChild(line);
      });
      right.appendChild(toggleIcon);
      row.appendChild(left);
      row.appendChild(right);
      wrap.appendChild(row);
      const detail = document.createElement("div");
      detail.id = `hw-detail-${key}`;
      detail.style.cssText = `display:${hwOpenState[key] ? "" : "none"};padding:0.5rem 0 0.75rem 0.5rem;font-size:0.75rem;color:var(--text-muted);line-height:1.6;border-top:1px solid rgba(255,255,255,0.05);`;
      detail.innerHTML = explanation(data);
      wrap.appendChild(detail);
      row.addEventListener("click", () => {
        hwOpenState[key] = !hwOpenState[key];
        detail.style.display = hwOpenState[key] ? "" : "none";
        const ti = document.getElementById(`hw-toggle-${key}`);
        if (ti) {
          ti.textContent = hwOpenState[key] ? "\u25B2 sluiten" : "\u25BC uitleg";
        }
      });
      container.appendChild(wrap);
    });
    const activeDevices = deviceDefs.filter((d) => d.data.enabled);
    if (activeDevices.length > 1) {
      const totalFixed = activeDevices.reduce((s, d) => s + d.data.fixed * mf, 0);
      const totalDyn = activeDevices.reduce((s, d) => s + d.data.dyn * mf, 0);
      const tot = document.createElement("div");
      tot.style.cssText = "display:flex;gap:1.5rem;padding-top:0.6rem;font-size:0.75rem;color:var(--text-muted);flex-wrap:wrap;";
      tot.innerHTML = `
      <span>Totaal effect actieve apparaten \u2014 vast: <strong style="color:${totalFixed < 0 ? "var(--accent-green)" : "var(--accent-indigo)"};">${totalFixed >= 0 ? "+" : ""}\u20AC${totalFixed.toFixed(2)}/jaar</strong></span>
      <span>dynamisch: <strong style="color:${totalDyn < 0 ? "var(--accent-green)" : "var(--accent-cyan)"};">${totalDyn >= 0 ? "+" : ""}\u20AC${totalDyn.toFixed(2)}/jaar</strong></span>`;
      container.appendChild(tot);
    }
  }
  function renderOverviewChart() {
    if (activeViewType === "sankey") {
      renderSankeyDiagram();
      return;
    }
    const card = document.getElementById("overview-chart-card");
    if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
    const bucketMap = /* @__PURE__ */ new Map();
    if (pdt && Object.keys(pdt).length > 0) {
      for (const [dayKey, v] of Object.entries(pdt)) {
        const key = overviewMode === "week" ? isoWeek(dayKey) : overviewMode === "month" ? dayKey.slice(0, 7) : dayKey;
        if (!bucketMap.has(key)) {
          bucketMap.set(key, {
            rawImp: 0,
            rawExp: 0,
            evKwh: 0,
            evCost: 0,
            evSavings: 0,
            hpKwh: 0,
            hpCost: 0,
            hpSavings: 0,
            batCharge: 0,
            batDischarge: 0,
            batCost: 0,
            batSavings: 0,
            batChargeCost: 0,
            batDischargeValue: 0,
            baseloadCost: 0,
            baseloadReturn: 0,
            baseloadImportSavings: 0,
            baseloadExportSavings: 0,
            dynCost: 0,
            fixedCost: 0,
            impKwh: 0,
            expKwh: 0
          });
        }
        const e = bucketMap.get(key);
        e.rawImp += v.rawImp || 0;
        e.rawExp += v.rawExp || 0;
        e.evKwh += v.evKwh || 0;
        e.evCost += v.evCost || 0;
        e.evSavings += v.evSavings || 0;
        e.hpKwh += v.hpKwh || 0;
        e.hpCost += v.hpCost || 0;
        e.hpSavings += v.hpSavings || 0;
        e.batCharge += v.batCharge || 0;
        e.batDischarge += v.batDischarge || 0;
        e.batCost += v.batCost || 0;
        e.batSavings += v.batSavings || 0;
        e.batChargeCost += v.batChargeCost || 0;
        e.batDischargeValue += v.batDischargeValue || 0;
        e.baseloadCost += v.baseloadCost || 0;
        e.baseloadReturn += v.baseloadReturn || 0;
        e.baseloadImportSavings += v.baseloadImportSavings || 0;
        e.baseloadExportSavings += v.baseloadExportSavings || 0;
        e.dynCost += v.dynCost || 0;
        e.fixedCost += v.fixedCost || 0;
        e.impKwh += v.impKwh || 0;
        e.expKwh += v.expKwh || 0;
      }
    } else {
      __chartsDependencies.energyData.forEach((row) => {
        const dayKey = row.timestamp.slice(0, 10);
        const key = overviewMode === "week" ? isoWeek(dayKey) : overviewMode === "month" ? dayKey.slice(0, 7) : dayKey;
        if (!bucketMap.has(key)) {
          bucketMap.set(key, {
            rawImp: 0,
            rawExp: 0,
            evKwh: 0,
            evCost: 0,
            evSavings: 0,
            hpKwh: 0,
            hpCost: 0,
            hpSavings: 0,
            batCharge: 0,
            batDischarge: 0,
            batCost: 0,
            batSavings: 0,
            batChargeCost: 0,
            batDischargeValue: 0,
            baseloadCost: 0,
            baseloadReturn: 0,
            baseloadImportSavings: 0,
            baseloadExportSavings: 0,
            dynCost: 0,
            fixedCost: 0,
            impKwh: 0,
            expKwh: 0
          });
        }
        const e = bucketMap.get(key);
        const imp = (row.import_t1 || 0) + (row.import_t2 || 0);
        const exp = (row.export_t1 || 0) + (row.export_t2 || 0);
        e.rawImp += imp;
        e.rawExp += exp;
        e.baseloadCost += imp * 0.25;
        e.baseloadReturn += exp * 0.08;
        e.impKwh += imp;
        e.expKwh += exp;
      });
    }
    const days = Array.from(bucketMap.keys()).sort();
    const values = days.map((d) => bucketMap.get(d));
    const hasEv = !!__chartsDependencies.activeSimulation?.hwEffects?.ev?.enabled;
    const hasHp = !!__chartsDependencies.activeSimulation?.hwEffects?.hp?.enabled;
    const hasBat = !!__chartsDependencies.activeSimulation?.hwEffects?.bat?.enabled;
    const colors = {
      import: "var(--accent-cyan)",
      return: "var(--accent-green)",
      ev: "var(--accent-blue)",
      hp: "var(--accent-purple)",
      bat_charge: "var(--accent-yellow)",
      bat_discharge: "var(--accent-orange)",
      bat: "var(--accent-orange)"
    };
    const legendContainer = document.getElementById("overview-legends");
    legendContainer.innerHTML = "";
    const activeCats = [];
    if (overviewMetric === "energy") {
      activeCats.push({ label: "Overige Afname", color: colors.import });
      if (hasEv) activeCats.push({ label: "EV Lader", color: colors.ev });
      if (hasHp) activeCats.push({ label: "Warmtepomp", color: colors.hp });
      if (hasBat) activeCats.push({ label: "Thuisaccu (Laden)", color: colors.bat_charge });
      activeCats.push({ label: "Overige Teruglevering", color: colors.return });
      if (hasBat) activeCats.push({ label: "Thuisaccu (Ontladen)", color: colors.bat_discharge });
    } else if (overviewMetric === "cost") {
      activeCats.push({ label: "Overige Kosten", color: colors.import });
      if (hasEv) activeCats.push({ label: "EV Lader", color: colors.ev });
      if (hasHp) activeCats.push({ label: "Warmtepomp", color: colors.hp });
      if (hasBat) activeCats.push({ label: "Thuisaccu (Laden)", color: colors.bat_charge });
      activeCats.push({ label: "Overige Teruglevering (Opbrengst)", color: colors.return });
      if (hasBat) activeCats.push({ label: "Thuisaccu (Ontladen)", color: colors.bat_discharge });
    } else {
      activeCats.push({ label: "Besparing Overige Afname", color: colors.import });
      activeCats.push({ label: "Besparing Overige Terug", color: colors.return });
      if (hasEv) activeCats.push({ label: "EV Lader Besparing", color: colors.ev });
      if (hasHp) activeCats.push({ label: "Warmtepomp Besparing", color: colors.hp });
      if (hasBat) activeCats.push({ label: "Thuisaccu Besparing", color: colors.bat });
    }
    activeCats.forEach((c) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-color" style="background:${c.color}; width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:4px;"></span> ${c.label}`;
      legendContainer.appendChild(item);
    });
    let maxAbs = 0;
    days.forEach((d) => {
      const e = bucketMap.get(d);
      if (overviewMetric === "energy") {
        const posSum = e.rawImp + (hasEv ? e.evKwh : 0) + (hasHp ? e.hpKwh : 0) + (hasBat ? e.batCharge : 0);
        const negSum = e.rawExp + (hasBat ? e.batDischarge : 0);
        maxAbs = Math.max(maxAbs, posSum, negSum);
      } else if (overviewMetric === "cost") {
        const posSum = e.baseloadCost + (hasEv ? e.evCost : 0) + (hasHp ? e.hpCost : 0) + (hasBat ? e.batChargeCost : 0);
        const negSum = e.baseloadReturn + (hasBat ? e.batDischargeValue : 0);
        maxAbs = Math.max(maxAbs, posSum, negSum);
      } else {
        let posSum = 0, negSum = 0;
        const cats = [
          e.baseloadImportSavings,
          e.baseloadExportSavings,
          hasEv ? e.evSavings : 0,
          hasHp ? e.hpSavings : 0,
          hasBat ? e.batSavings : 0
        ];
        cats.forEach((c) => {
          if (c > 0) posSum += c;
          else negSum += Math.abs(c);
        });
        maxAbs = Math.max(maxAbs, posSum, negSum);
      }
    });
    if (maxAbs <= 0) maxAbs = 1;
    const maxVal = maxAbs * 1.15;
    const container = document.getElementById("overview-svg-container");
    const svg = document.getElementById("overview-svg");
    const tooltip = document.getElementById("overview-tooltip");
    const W = container.clientWidth;
    const H = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const PAD_L = 52, PAD_R = 12, PAD_T = 16, PAD_B = 28;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const n = days.length;
    const barW = Math.max(1.5, chartW / n - 2);
    const xOf = (i) => PAD_L + i * (chartW / n) + 1;
    const yOfZero = PAD_T + chartH / 2;
    const yOfVal = (val) => yOfZero - val / maxVal * (chartH / 2);
    const mk = (tag, attrs) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    for (let t = -2; t <= 2; t++) {
      const ratio = t / 2;
      const y = yOfZero - ratio * (chartH / 2);
      const val = ratio * maxVal;
      svg.appendChild(mk("line", {
        x1: PAD_L,
        y1: y,
        x2: W - PAD_R,
        y2: y,
        stroke: t === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.04)",
        "stroke-dasharray": t === 0 ? "none" : "2,2"
      }));
      const lbl = mk("text", {
        x: PAD_L - 6,
        y: y + 3,
        "text-anchor": "end",
        fill: "var(--text-muted)",
        "font-size": 9
      });
      let labelText = "";
      if (overviewMetric === "energy") {
        labelText = (val >= 0 ? "+" : "") + val.toFixed(0) + " kWh";
      } else {
        labelText = (val >= 0 ? "+" : "-") + "\u20AC" + Math.abs(val).toFixed(0);
      }
      lbl.textContent = labelText;
      svg.appendChild(lbl);
    }
    const drawSegment = (x, yStart, yEnd, color, rx = 0) => {
      const y = Math.min(yStart, yEnd);
      const height = Math.abs(yStart - yEnd);
      if (height < 0.5) return null;
      const rect = mk("rect", {
        x,
        y,
        width: barW,
        height,
        fill: color,
        rx
      });
      svg.appendChild(rect);
      return rect;
    };
    days.forEach((d, i) => {
      const x = xOf(i);
      const e = bucketMap.get(d);
      if (overviewMetric === "energy") {
        let currentPosVal = 0;
        let nextPosVal = currentPosVal + e.rawImp;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.import, 1);
        currentPosVal = nextPosVal;
        if (hasEv && e.evKwh > 0) {
          nextPosVal = currentPosVal + e.evKwh;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.ev, 0);
          currentPosVal = nextPosVal;
        }
        if (hasHp && e.hpKwh > 0) {
          nextPosVal = currentPosVal + e.hpKwh;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.hp, 0);
          currentPosVal = nextPosVal;
        }
        if (hasBat && e.batCharge > 0) {
          nextPosVal = currentPosVal + e.batCharge;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.bat_charge, 1);
          currentPosVal = nextPosVal;
        }
        let currentNegVal = 0;
        let nextNegVal = currentNegVal - e.rawExp;
        drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.return, 1);
        currentNegVal = nextNegVal;
        if (hasBat && e.batDischarge > 0) {
          nextNegVal = currentNegVal - e.batDischarge;
          drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.bat_discharge, 1);
          currentNegVal = nextNegVal;
        }
        const net = e.rawImp + (hasEv ? e.evKwh : 0) + (hasHp ? e.hpKwh : 0) + (hasBat ? e.batCharge : 0) - (e.rawExp + (hasBat ? e.batDischarge : 0));
        const yNet = yOfVal(net);
        svg.appendChild(mk("line", {
          x1: x - 1,
          y1: yNet,
          x2: x + barW + 1,
          y2: yNet,
          stroke: "#ffffff",
          "stroke-width": 1.5,
          "stroke-linecap": "round"
        }));
      } else if (overviewMetric === "cost") {
        let currentPosVal = 0;
        let nextPosVal = currentPosVal + e.baseloadCost;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.import, 1);
        currentPosVal = nextPosVal;
        if (hasEv && e.evCost > 0) {
          nextPosVal = currentPosVal + e.evCost;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.ev, 0);
          currentPosVal = nextPosVal;
        }
        if (hasHp && e.hpCost > 0) {
          nextPosVal = currentPosVal + e.hpCost;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.hp, 0);
          currentPosVal = nextPosVal;
        }
        if (hasBat && e.batChargeCost > 0) {
          nextPosVal = currentPosVal + e.batChargeCost;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.bat_charge, 1);
          currentPosVal = nextPosVal;
        }
        let currentNegVal = 0;
        let nextNegVal = currentNegVal - e.baseloadReturn;
        drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.return, 1);
        currentNegVal = nextNegVal;
        if (hasBat && e.batDischargeValue > 0) {
          nextNegVal = currentNegVal - e.batDischargeValue;
          drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.bat_discharge, 1);
          currentNegVal = nextNegVal;
        }
        const net = e.baseloadCost + (hasEv ? e.evCost : 0) + (hasHp ? e.hpCost : 0) + (hasBat ? e.batChargeCost : 0) - (e.baseloadReturn + (hasBat ? e.batDischargeValue : 0));
        const yNet = yOfVal(net);
        svg.appendChild(mk("line", {
          x1: x - 1,
          y1: yNet,
          x2: x + barW + 1,
          y2: yNet,
          stroke: "#ffffff",
          "stroke-width": 1.5,
          "stroke-linecap": "round"
        }));
      } else {
        let currentPosVal = 0;
        let currentNegVal = 0;
        const segments = [
          { val: e.baseloadImportSavings, color: colors.import },
          { val: e.baseloadExportSavings, color: colors.return },
          { val: hasEv ? e.evSavings : 0, color: colors.ev },
          { val: hasHp ? e.hpSavings : 0, color: colors.hp },
          { val: hasBat ? e.batSavings : 0, color: colors.bat }
        ];
        segments.forEach((seg) => {
          if (seg.val > 0) {
            const nextPos = currentPosVal + seg.val;
            drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPos), seg.color, 1);
            currentPosVal = nextPos;
          } else if (seg.val < 0) {
            const nextNeg = currentNegVal + seg.val;
            drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNeg), seg.color, 1);
            currentNegVal = nextNeg;
          }
        });
        const net = e.baseloadImportSavings + e.baseloadExportSavings + (hasEv ? e.evSavings : 0) + (hasHp ? e.hpSavings : 0) + (hasBat ? e.batSavings : 0);
        const yNet = yOfVal(net);
        svg.appendChild(mk("line", {
          x1: x - 1,
          y1: yNet,
          x2: x + barW + 1,
          y2: yNet,
          stroke: "#ffffff",
          "stroke-width": 1.5,
          "stroke-linecap": "round"
        }));
      }
    });
    const step = Math.max(1, Math.floor(n / 8));
    days.forEach((d, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const lbl = mk("text", {
        x: xOf(i) + barW / 2,
        y: H - 8,
        "text-anchor": "middle",
        fill: "var(--text-muted)",
        "font-size": 9
      });
      const labelText = overviewMode === "week" ? d.replace(/(\d{4})-W(\d+)/, (_, y, w) => `W${w} '${y.slice(2)}`) : overviewMode === "month" ? (/* @__PURE__ */ new Date(d + "-02T12:00:00Z")).toLocaleDateString("nl-NL", { month: "short", year: "2-digit" }) : (/* @__PURE__ */ new Date(d + "T12:00:00Z")).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
      lbl.textContent = labelText;
      svg.appendChild(lbl);
    });
    values.forEach((v, i) => {
      const x = xOf(i);
      const overlay = mk("rect", {
        x: x - 0.5,
        y: PAD_T,
        width: barW + 1,
        height: chartH,
        fill: "transparent",
        cursor: "crosshair"
      });
      const show = () => {
        const key = days[i];
        const val = bucketMap.get(key);
        let dateStr = "";
        if (overviewMode === "week") {
          dateStr = key.replace(/(\d{4})-W(\d+)/, (_, y, w) => `Week ${w}, ${y}`);
        } else if (overviewMode === "month") {
          const date = /* @__PURE__ */ new Date(key + "-02T12:00:00Z");
          dateStr = date.toLocaleDateString("nl-NL", { year: "numeric", month: "long" });
        } else {
          dateStr = (/* @__PURE__ */ new Date(key + "T12:00:00Z")).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
        }
        let html = `<h4 style="font-family:var(--font-display); border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.2rem; margin-bottom:0.4rem; color:var(--accent-cyan); font-size:0.85rem;">${dateStr}</h4>`;
        if (overviewMetric === "energy") {
          html += `<div class="tooltip-row"><span>Overige Afname:</span><span class="val" style="color:${colors.import}">${val.rawImp.toFixed(1)} kWh</span></div>`;
          if (hasEv) html += `<div class="tooltip-row"><span>EV Lader:</span><span class="val" style="color:${colors.ev}">${val.evKwh.toFixed(1)} kWh</span></div>`;
          if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:${colors.hp}">${val.hpKwh.toFixed(1)} kWh</span></div>`;
          if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Laden):</span><span class="val" style="color:${colors.bat_charge}">${val.batCharge.toFixed(1)} kWh</span></div>`;
          html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px dashed rgba(255,255,255,0.08); padding-top:0.3rem;"><span>Overige Teruglevering:</span><span class="val" style="color:${colors.return}">${val.rawExp.toFixed(1)} kWh</span></div>`;
          if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Ontladen):</span><span class="val" style="color:${colors.bat_discharge}">${val.batDischarge.toFixed(1)} kWh</span></div>`;
          const net = val.rawImp + (hasEv ? val.evKwh : 0) + (hasHp ? val.hpKwh : 0) + (hasBat ? val.batCharge : 0) - (val.rawExp + (hasBat ? val.batDischarge : 0));
          html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Netto Netbalans:</span><span class="val" style="color:${net >= 0 ? "var(--accent-orange)" : "var(--accent-green)"}">${net >= 0 ? "+" : ""}${net.toFixed(1)} kWh</span></div>`;
        } else if (overviewMetric === "cost") {
          html += `<div class="tooltip-row"><span>Overige Kosten:</span><span class="val" style="color:${colors.import}">\u20AC ${val.baseloadCost.toFixed(2)}</span></div>`;
          if (hasEv) html += `<div class="tooltip-row"><span>EV Lader:</span><span class="val" style="color:${colors.ev}">\u20AC ${val.evCost.toFixed(2)}</span></div>`;
          if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:${colors.hp}">\u20AC ${val.hpCost.toFixed(2)}</span></div>`;
          if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Laden):</span><span class="val" style="color:${colors.bat_charge}">\u20AC ${val.batChargeCost.toFixed(2)}</span></div>`;
          html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px dashed rgba(255,255,255,0.08); padding-top:0.3rem;"><span>Overige Teruglevering:</span><span class="val" style="color:${colors.return}">\u20AC ${val.baseloadReturn.toFixed(2)}</span></div>`;
          if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Ontladen):</span><span class="val" style="color:${colors.bat_discharge}">\u20AC ${val.batDischargeValue.toFixed(2)}</span></div>`;
          const net = val.baseloadCost + (hasEv ? val.evCost : 0) + (hasHp ? val.hpCost : 0) + (hasBat ? val.batChargeCost : 0) - (val.baseloadReturn + (hasBat ? val.batDischargeValue : 0));
          html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Netto Variabele Kosten:</span><span class="val" style="color:${net >= 0 ? "var(--accent-orange)" : "var(--accent-green)"}">\u20AC ${net.toFixed(2)}</span></div>`;
        } else {
          html += `<div class="tooltip-row"><span>Besparing Overige Afname:</span><span class="val" style="color:${colors.import}">\u20AC ${val.baseloadImportSavings.toFixed(2)}</span></div>`;
          html += `<div class="tooltip-row"><span>Besparing Overige Terug:</span><span class="val" style="color:${colors.return}">\u20AC ${val.baseloadExportSavings.toFixed(2)}</span></div>`;
          if (hasEv) html += `<div class="tooltip-row"><span>EV Lader Besparing:</span><span class="val" style="color:${colors.ev}">\u20AC ${val.evSavings.toFixed(2)}</span></div>`;
          if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp Besparing:</span><span class="val" style="color:${colors.hp}">\u20AC ${val.hpSavings.toFixed(2)}</span></div>`;
          if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu Besparing:</span><span class="val" style="color:${colors.bat}">\u20AC ${val.batSavings.toFixed(2)}</span></div>`;
          const net = val.baseloadImportSavings + val.baseloadExportSavings + (hasEv ? val.evSavings : 0) + (hasHp ? val.hpSavings : 0) + (hasBat ? val.batSavings : 0);
          html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Totale Besparing:</span><span class="val" style="color:${net >= 0 ? "var(--accent-green)" : "var(--accent-orange)"}">\u20AC ${net.toFixed(2)}</span></div>`;
        }
        tooltip.innerHTML = html;
        tooltip.style.display = "block";
        let tx = x + barW + 8;
        if (tx + 220 > W) tx = x - 228;
        tooltip.style.left = tx + "px";
        let yRef = yOfZero;
        if (overviewMetric === "energy") {
          const posSum = val.rawImp + (hasEv ? val.evKwh : 0) + (hasHp ? val.hpKwh : 0) + (hasBat ? val.batCharge : 0);
          const negSum = val.rawExp + (hasBat ? val.batDischarge : 0);
          yRef = yOfVal(Math.max(posSum, negSum));
        } else if (overviewMetric === "cost") {
          const posSum = val.baseloadCost + (hasEv ? val.evCost : 0) + (hasHp ? val.hpCost : 0) + (hasBat ? val.batChargeCost : 0);
          const negSum = val.baseloadReturn + (hasBat ? val.batDischargeValue : 0);
          yRef = yOfVal(Math.max(posSum, negSum));
        } else {
          let posSum = 0;
          const cats = [
            val.baseloadImportSavings,
            val.baseloadExportSavings,
            hasEv ? val.evSavings : 0,
            hasHp ? val.hpSavings : 0,
            hasBat ? val.batSavings : 0
          ];
          cats.forEach((c) => {
            if (c > 0) posSum += c;
          });
          yRef = yOfVal(posSum);
        }
        tooltip.style.top = Math.max(0, yRef - 20) + "px";
        overlay.setAttribute("fill", "rgba(255,255,255,0.06)");
      };
      const hide = () => {
        tooltip.style.display = "none";
        overlay.setAttribute("fill", "transparent");
      };
      overlay.addEventListener("mouseenter", show);
      overlay.addEventListener("mouseleave", hide);
      _bindTouchTip(overlay, show, hide);
      svg.appendChild(overlay);
    });
  }
  function renderSankeyDiagram() {
    const card = document.getElementById("overview-chart-card");
    if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
    const container = document.getElementById("overview-svg-container");
    const svg = document.getElementById("overview-svg");
    const tooltip = document.getElementById("overview-tooltip");
    const W = container.clientWidth;
    const H = container.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    if (!pdt || Object.keys(pdt).length === 0) return;
    const hasEv = !!__chartsDependencies.activeSimulation?.hwEffects?.ev?.enabled;
    const hasHp = !!__chartsDependencies.activeSimulation?.hwEffects?.hp?.enabled;
    const hasBat = !!__chartsDependencies.activeSimulation?.hwEffects?.bat?.enabled;
    let solarYield = 0;
    let rawExp = 0;
    let evSolar = 0;
    let evGrid = 0;
    let hpSolar = 0;
    let hpGrid = 0;
    let batChargeSolar = 0;
    let batChargeGrid = 0;
    let batChargeGridCost = 0;
    let rawImp = 0;
    let batDischargeToHouse = 0;
    let batDischargeToGrid = 0;
    for (const [dayKey, v] of Object.entries(pdt)) {
      let match = false;
      if (sankeyInterval === "year") match = true;
      else if (sankeyInterval === "month") match = dayKey.slice(0, 7) === sankeyValue;
      else if (sankeyInterval === "week") match = isoWeek(dayKey) === sankeyValue;
      else if (sankeyInterval === "day") match = dayKey === sankeyValue;
      if (match) {
        solarYield += v.solarYield || 0;
        rawExp += v.rawExp || 0;
        evSolar += v.evSolar || 0;
        evGrid += v.evGrid || 0;
        hpSolar += v.hpSolar || 0;
        hpGrid += v.hpGrid || 0;
        batChargeSolar += v.batChargeSolar || 0;
        batChargeGrid += v.batChargeGrid || 0;
        batChargeGridCost += v.batChargeGridCost || 0;
        rawImp += v.rawImp || 0;
        batDischargeToHouse += v.batDischargeToHouse || 0;
        batDischargeToGrid += v.batDischargeToGrid || 0;
      }
    }
    const solarDirectHouse = Math.max(0, solarYield - rawExp);
    const baseloadExport = Math.max(0, rawExp - hpSolar - evSolar - batChargeSolar);
    const baseloadImport = Math.max(0, rawImp - batDischargeToHouse);
    const netImportVal = baseloadImport + evGrid + hpGrid + batChargeGrid;
    const batInflow = batChargeSolar + batChargeGrid;
    const batOutflow = batDischargeToHouse + batDischargeToGrid;
    const batSoCDraw = hasBat && batOutflow > batInflow ? batOutflow - batInflow : 0;
    const batLoss = hasBat && batInflow > batOutflow ? batInflow - batOutflow : 0;
    const houseVal = solarDirectHouse + baseloadImport + batDischargeToHouse;
    const evVal = evSolar + evGrid;
    const hpVal = hpSolar + hpGrid;
    const netExportVal = baseloadExport + batDischargeToGrid;
    const highlightEl = document.getElementById("sk-battery-price-highlight");
    if (highlightEl) {
      if (hasBat && batChargeGrid > 0) {
        const avgPrice = batChargeGridCost / batChargeGrid;
        highlightEl.innerHTML = `${ICON_BATTERY} <span>Gekocht: <span style="color:#ffffff;">${batChargeGrid.toFixed(1)} kWh</span> voor gem. <span style="color:var(--accent-yellow);">\u20AC ${avgPrice.toFixed(3)}/kWh</span></span>`;
      } else if (hasBat) {
        highlightEl.innerHTML = `${ICON_BATTERY} <span>Geen net-laadstroom ingekocht in deze periode.</span>`;
      } else {
        highlightEl.innerHTML = "";
      }
    }
    const PAD_L = 80, PAD_R = 110, PAD_T = 24, PAD_B = 24;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const nodeW = 16;
    const col0Val = solarYield + netImportVal + batSoCDraw;
    const totalFlow = Math.max(col0Val, 1);
    const availableH = chartH - 40;
    const scale = availableH / totalFlow;
    const nodes = {};
    const defineNode = (id, label, column, value, color) => {
      if (value <= 0) return;
      const h = Math.max(8, value * scale);
      if (!nodes[column]) nodes[column] = [];
      nodes[column].push({ id, label, value, h, color });
    };
    defineNode("solar", "Zon", 0, solarYield, "var(--accent-green)");
    defineNode("net_imp", "Net (Afname)", 0, netImportVal, "var(--accent-cyan)");
    if (hasBat && batSoCDraw > 0) {
      defineNode("bat_buf", "Accu Ontlading", 0, batSoCDraw, "var(--accent-orange)");
    }
    const batNodeVal = Math.max(batInflow, batOutflow);
    if (hasBat && batNodeVal > 0) {
      defineNode("battery", "Thuisaccu", 1, batNodeVal, "var(--accent-yellow)");
    }
    defineNode("house", "Woning (Overig)", 2, houseVal, "var(--accent-cyan)");
    if (hasEv && evVal > 0) {
      defineNode("ev", "EV Lader", 2, evVal, "var(--accent-blue)");
    }
    if (hasHp && hpVal > 0) {
      defineNode("hp", "Warmtepomp", 2, hpVal, "var(--accent-purple)");
    }
    defineNode("net_exp", "Net (Teruglevering)", 2, netExportVal, "var(--accent-green)");
    if (hasBat && batLoss > 0) {
      defineNode("loss", "Rendementsverlies", 2, batLoss, "var(--accent-orange)");
    }
    const xCoords = [
      PAD_L,
      PAD_L + chartW / 2 - nodeW / 2,
      PAD_L + chartW - nodeW
    ];
    const allNodesList = [];
    [0, 1, 2].forEach((col) => {
      const colNodes = nodes[col] || [];
      if (colNodes.length === 0) return;
      const totalH = colNodes.reduce((sum, n) => sum + n.h, 0);
      const gap = colNodes.length > 1 ? (chartH - totalH) / (colNodes.length - 1) : 0;
      let currentY = PAD_T;
      if (colNodes.length === 1) {
        currentY = PAD_T + (chartH - totalH) / 2;
      }
      colNodes.forEach((node) => {
        node.x = xCoords[col];
        node.y = currentY;
        node.w = nodeW;
        node.sourceY = node.y;
        node.targetY = node.y;
        currentY += node.h + gap;
        allNodesList.push(node);
      });
    });
    const mk = (tag, attrs) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const drawLink = (sourceId, targetId, value, color) => {
      if (value <= 0) return;
      let srcNode = null, tgtNode = null;
      allNodesList.forEach((n) => {
        if (n.id === sourceId) srcNode = n;
        if (n.id === targetId) tgtNode = n;
      });
      if (!srcNode || !tgtNode) return;
      const flowH = value * scale;
      const sy = srcNode.sourceY + flowH / 2;
      const ty = tgtNode.targetY + flowH / 2;
      srcNode.sourceY += flowH;
      tgtNode.targetY += flowH;
      const x1 = srcNode.x + srcNode.w;
      const x2 = tgtNode.x;
      const dx = x2 - x1;
      const c1 = x1 + dx * 0.45;
      const c2 = x2 - dx * 0.45;
      const d = `M ${x1} ${sy} C ${c1} ${sy}, ${c2} ${ty}, ${x2} ${ty}`;
      const path = mk("path", {
        d,
        fill: "none",
        stroke: color,
        "stroke-width": Math.max(0.5, flowH),
        "stroke-opacity": 0.22,
        cursor: "pointer"
      });
      path.addEventListener("mouseenter", () => {
        path.setAttribute("stroke-opacity", 0.65);
        tooltip.innerHTML = `<div style="font-size:0.78rem;"><strong style="color:${color};">${srcNode.label} \u2794 ${tgtNode.label}</strong><br/>Volume: <span style="font-family:var(--font-display); font-weight:700; color:#ffffff;">${value.toFixed(1)} kWh</span></div>`;
        tooltip.style.display = "block";
        const tx = (x1 + x2) / 2 - 60;
        const ty_coord = (sy + ty) / 2 - 20;
        tooltip.style.left = Math.max(5, Math.min(W - 150, tx)) + "px";
        tooltip.style.top = Math.max(5, Math.min(H - 60, ty_coord)) + "px";
      });
      path.addEventListener("mouseleave", () => {
        path.setAttribute("stroke-opacity", 0.22);
        tooltip.style.display = "none";
      });
      svg.appendChild(path);
    };
    drawLink("solar", "house", solarDirectHouse, "var(--accent-green)");
    if (hasEv) drawLink("solar", "ev", evSolar, "var(--accent-green)");
    if (hasHp) drawLink("solar", "hp", hpSolar, "var(--accent-green)");
    if (hasBat) drawLink("solar", "battery", batChargeSolar, "var(--accent-green)");
    drawLink("solar", "net_exp", baseloadExport, "var(--accent-green)");
    drawLink("net_imp", "house", baseloadImport, "var(--accent-cyan)");
    if (hasEv) drawLink("net_imp", "ev", evGrid, "var(--accent-cyan)");
    if (hasHp) drawLink("net_imp", "hp", hpGrid, "var(--accent-cyan)");
    if (hasBat) drawLink("net_imp", "battery", batChargeGrid, "var(--accent-cyan)");
    if (hasBat && batSoCDraw > 0) {
      drawLink("bat_buf", "battery", batSoCDraw, "var(--accent-orange)");
    }
    if (hasBat) {
      drawLink("battery", "house", batDischargeToHouse, "var(--accent-yellow)");
      drawLink("battery", "net_exp", batDischargeToGrid, "var(--accent-yellow)");
      if (batLoss > 0) {
        drawLink("battery", "loss", batLoss, "var(--accent-orange)");
      }
    }
    allNodesList.forEach((node) => {
      const rect = mk("rect", {
        x: node.x,
        y: node.y,
        width: node.w,
        height: node.h,
        fill: node.color,
        rx: 3,
        "fill-opacity": 0.85,
        stroke: "rgba(255,255,255,0.15)",
        "stroke-width": 1.2
      });
      svg.appendChild(rect);
      const isCol0 = node.x < W / 3;
      const isCol2 = node.x > 2 * W / 3;
      const textAnchor = isCol0 ? "end" : isCol2 ? "start" : "middle";
      const textX = isCol0 ? node.x - 8 : isCol2 ? node.x + node.w + 8 : node.x + node.w / 2;
      const lbl = mk("text", {
        x: textX,
        y: node.y + node.h / 2 - 2,
        "text-anchor": textAnchor,
        fill: "#ffffff",
        "font-size": 9.5,
        "font-weight": 600,
        "font-family": "var(--font-display)"
      });
      lbl.textContent = node.label;
      svg.appendChild(lbl);
      const valLbl = mk("text", {
        x: textX,
        y: node.y + node.h / 2 + 8,
        "text-anchor": textAnchor,
        fill: "var(--text-muted)",
        "font-size": 8,
        "font-family": "var(--font-body)"
      });
      valLbl.textContent = `${node.value.toFixed(1)} kWh`;
      svg.appendChild(valLbl);
    });
  }

  // src/ui/dom.js
  function showSetupModal(tab) {
    const isFile = window.location.protocol === "file:";
    const origin = isFile ? "http://localhost:8080" : window.location.origin;
    document.getElementById("modal-cors-snippet").textContent = `http:
  cors_allowed_origins:
    - ${origin}`;
    const mixedWarning = document.getElementById("ha-mixed-content-warning");
    if (mixedWarning) {
      if (window.location.protocol === "https:") {
        mixedWarning.style.display = "block";
        const siteUrlEl = mixedWarning.querySelector(".site-url");
        if (siteUrlEl) siteUrlEl.textContent = window.location.origin;
      } else {
        mixedWarning.style.display = "none";
      }
    }
    document.getElementById("modal-backdrop").style.display = "flex";
    const targetTab = tab === "cors" ? "manual" : tab || "direct";
    if (typeof showModalTab === "function") showModalTab(targetTab);
  }
  function closeSetupModal() {
    document.getElementById("modal-backdrop").style.display = "none";
  }
  function showHardwareExplainer(kind) {
    const { title, body } = hardwareExplainerContent(kind);
    document.getElementById("explain-title").innerHTML = title;
    document.getElementById("explain-body").innerHTML = body;
    document.getElementById("explain-backdrop").style.display = "flex";
  }
  function closeHardwareExplainer() {
    document.getElementById("explain-backdrop").style.display = "none";
  }
  function hardwareExplainerContent(kind) {
    const watervalBlock = `
    <div class="explain-block" style="border-left-color: var(--accent-yellow);">
      <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><path d="M2 6c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path><path d="M2 12c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path><path d="M2 18c.6.5 1.2 1 2.5 1s2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1 1.2 1 2.5 1 2-.5 2.5-1 1.2-1 2.5-1 2 .5 2.5 1"></path></svg> De Zonne-waterval (Volgorde van stroomverdeling)</h4>
      <p style="margin-top:0.4rem;">Opgewekte zonnestroom stroomt in deze vaste prioriteitsvolgorde door je woning:</p>
      <ol style="margin-left: 1.2rem; padding: 0; line-height: 1.6;">
        <li><strong>Huisverbruik:</strong> Eerst worden je actieve apparaten in huis gevoed.</li>
        <li><strong>Warmtepomp:</strong> Het resterende zonne-overschot dekt als eerste de warmtepomplast (indien actief).</li>
        <li><strong>Elektrische auto (EV):</strong> Wat daarna over is gaat naar de EV (indien zonne-laden actief is en de auto is gekoppeld).</li>
        <li><strong>Thuisaccu:</strong> Wat daarna nog overblijft laadt de thuisaccu op.</li>
        <li><strong>Elektriciteitsnet:</strong> Pas als alles verzadigd is, gaat het restant naar het net (en wordt op dat moment eventueel gedimd bij negatieve prijzen).</li>
      </ol>
    </div>
  `;
    if (kind === "battery") {
      const activeMode = document.getElementById("bat-mode")?.value || "zelf";
      const tag = (m) => activeMode === m ? ` <span style="color:var(--accent-green);font-size:0.75rem;">(nu actief)</span>` : "";
      return {
        title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-cyan);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg> Hoe werkt het thuisbatterij-model?`,
        body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De accu wordt <strong>per uur</strong> doorgerekend, en apart voor het dynamische en het vaste
          contract (twee gescheiden laadtoestanden). Belangrijk: <strong>de accu hoeft nooit vol</strong> \u2014
          hij laadt all\xE9\xE9n zoveel als economisch zin heeft. Op een rustige dag blijft hij deels leeg.
          Bij opslaan en ontladen gaat een deel verloren (round-trip-rendement, bv. 90% \u2192 10% verlies).
        </p>
        ${watervalBlock}
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg> Maximaal zelfverbruik (standaard)${tag("zelf")}</h4>
          <ul>
            <li><strong>Opslaan:</strong> zonne-overschot dat je anders zou exporteren gaat in de accu \u2014
              maar niet m\xE9\xE9r dan je die dag zelf nog kunt verbruiken. De rest wordt gewoon ge\xEBxporteerd
              (geen onnodig opslaan dat toch niet ontladen wordt).</li>
            <li><strong>Ontladen:</strong> zodra je stroom van het net zou halen. Dat bespaart altijd de
              volle all-in prijs (inclusief energiebelasting), dus zelfverbruik is altijd lonend.</li>
            <li>Geen handel met het net.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">laden:   alleen zon, tot opslag = min(accu_capaciteit, dag-import)
ontladen: dekt eigen import (bespaart all-in)</code>
        </div>
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg> Kostenbewust${tag("kosten")}</h4>
          <ul>
            <li>Als zelfverbruik, plus: in de <strong>goedkoopste uren van de dag</strong> laadt de accu
              bij van het net \u2014 maar <strong>all\xE9\xE9n het stukje dat de zon niet dekt</strong> en dat je
              later zelf verbruikt.</li>
            <li>Zo voorkom je dat je stroom inkoopt die de zon toch levert: over \xE9lke ingekochte kWh
              betaal je namelijk energiebelasting, die je alleen terugverdient als die kWh later
              net-import verdringt.</li>
            <li>Laden gebeurt alleen als de dure uren (\xD7 rendement) duurder zijn dan de goedkope laaduren.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ net-laden als: dure_all_in_prijs \xD7 rendements_factor > goedkope_all_in_prijs
  laad_budget = max(0, maximale_eigen_behoefte \u2212 zonne_overschot \xD7 rendements_factor) / rendements_factor</code>
        </div>
        <div class="explain-block">
          <h4><svg class="icon icon-inline" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg> Maximale winst${tag("winst")}</h4>
          <ul>
            <li>Als kostenbewust, plus: in de duurste uren <strong>verkoopt de accu het overschot terug aan het net</strong>.</li>
            <li>Dit gebeurt alleen als de opbrengst \u2014 de <strong>kale spotprijs</strong> (z\xF3nder BTW en
              z\xF3nder energiebelasting) \u2014 na rendementsverlies hoger is dan wat het laden kostte, \xE9n all\xE9\xE9n
              voor energie b\xF3ven je eigen-verbruik-voorraad.</li>
            <li>Onder het 2027-model betaal je energiebelasting over \xE9lke ingekochte kWh, maar krijg je die
              n\xED\xE9t terug bij verkoop. <strong>Daardoor komt deze modus op normale prijzen vrijwel altijd
              gelijk uit met "Kostenbewust"</strong> \u2014 zelfverbruik (bespaart all-in incl. EB) is bijna
              altijd waardevoller dan teruglevering (kale spot). Echt voordeel ontstaat pas bij flinke
              prijspieken \xE9n vrije accu-capaciteit.</li>
            <li>In het <strong>2026-scenario (saldering)</strong> ligt dit anders: teruglevering binnen je
              jaarverbruik is dan de all-in import-prijs waard (BTW en inkoopvergoeding krijg je via de
              jaarverrekening terug) \u2014 de verkoop-drempel rekent in dat scenario met die hogere waarde en
              de accu exporteert dus vaker.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ verkoop als: beursprijs / 1.21 \u2212 teruglever_opslag > goedkope_all_in_prijs / rendements_factor
  export = max(0, opgeslagen_stroom \u2212 maximale_eigen_behoefte)</code>
        </div>
        <p class="explain-note">
          <svg class="icon icon-inline" viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke-width: 2.5;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> De knop "Bereken Ideale Accu Formaat" veegt verschillende groottes door met de gekozen modus en
          toont de terugverdientijd (bij \u20AC450/kWh) \u2014 zo zie je dat een grotere accu niet automatisch beter is.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>1. Rendement bij laden en ontladen:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Bij het opslaan van stroom treedt energieverlies op. Bij een rendement van bijvoorbeeld 90% (rendementsfactor 0.90) wordt 10% omgezet in warmte:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nieuwe_opgeslagen_stroom = oude_opgeslagen_stroom + (ingeladen_stroom \xD7 rendements_factor)
geleverde_stroom = ontladen_stroom  (ontladen gaat zonder extra verlies)</code>

            <p><strong>2. Slimme opslaglimiet (voorkomt onnodig hamsteren):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De accu laadt per dag nooit meer op dan je die dag daadwerkelijk zelf nodig hebt. Dit voorkomt dat een hele grote accu onnodig stroom vasthoudt die je toch niet verbruikt:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">maximale_eigen_behoefte = de kleinste waarde van (accu_capaciteit OF totale_dag_import)
opslag_limiet = maximale_eigen_behoefte  (plus eventueel verkoopruimte in de winst-modus)</code>

            <p><strong>3. Consumentenprijs (all-in importprijs):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De all-in prijs die je betaalt per kWh stroom van het net. Beursprijs \xE9n opslag voer je incl. btw in, dus je telt ze rechtstreeks bij de energiebelasting op. Dit is wat je bespaart door stroom uit de accu te gebruiken:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">all-in prijs = beursprijs (incl. btw) + inkoop-opslag (incl. btw) + energiebelasting</code>

            <p><strong>4. Laden vanaf het net (wanneer loont dit?):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Laden vanaf het net in goedkope uren is alleen rendabel als de all-in prijs tijdens de dure uren (vermenigvuldigd met het rendement) hoger is dan de all-in prijs tijdens de goedkope uren:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">dure_all_in_prijs \xD7 rendements_factor  >  goedkope_all_in_prijs</code>

            <p><strong>5. Hoeveel laden vanaf het net (Net-laad-budget):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              We berekenen precies hoeveel stroom er van het net geladen moet worden, rekening houdend met de verwachte zonne-energie van die dag (om te voorkomen dat we belasting betalen over stroom die we ook gratis van de zon hadden kunnen krijgen):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">net_laad_budget = maximale_waarde van (0 OF maximale_eigen_behoefte \u2212 zonne_overschot \xD7 rendements_factor) / rendements_factor</code>

            <p><strong>6. Teruglevering loont (alleen in de winst-modus):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Terugleveren loont alleen als de ontvangen vergoeding hoger is dan de inkoopkosten per geleverde kWh:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">terugleververgoeding per kWh  =  beursprijs / 1.21 \u2212 teruglever_opslag
laadkosten per geleverde kWh  =  goedkope_all_in_prijs / rendements_factor
verkopen loont als:  terugleververgoeding > laadkosten
export_stroom = maximale_waarde van (0 OF opgeslagen_stroom \u2212 maximale_eigen_behoefte)</code>
          </div>
        </details>`
      };
    }
    if (kind === "heatpump") {
      return {
        title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-purple);"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg> Hoe werkt het warmtepomp-model?`,
        body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De warmtepomp voegt een <strong>elektrische stooklast</strong> toe (de schuif = gemiddeld
          wintervermogen in kW). Die last wordt per uur opgeteld bij je import (of trekt eerst van je
          zon-overschot af) en telt mee in <strong>beide</strong> contracten.
        </p>
        <div class="explain-block">
          <h4>Seizoensvorm via graaddagen</h4>
          <ul>
            <li>De jaarverdeling volgt het Nederlandse klimaat (graaddagen, basis 18&deg;C, De Bilt-normaal):
              piek in dec/jan, geleidelijk aflopend naar het voorjaar, met een kleine zomer-vloer voor
              warmtapwater.</li>
            <li>Per uur: <em>last = winter-stooklast \xD7 maandfactor \xD7 dag/nacht-factor</em>.</li>
            <li>Dag/nacht: 's nachts ~1,2\xD7 (kouder + opwarmen na de nachtverlaging), overdag ~0,9\xD7.</li>
          </ul>
        </div>
        <p class="explain-note">
          \u24D8 Beperking: de maandfactor is vlak per maand \u2014 hij lijnt nog niet per dag uit met echte
          koudegolven/EPEX-prijspieken. In een strenge koudegolf is warmtepomp-op-dynamisch dus iets
          optimistisch ingeschat.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>Stooklast per uur:</strong></p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">stooklast = winter_stooklast \xD7 maandfactor_verwarmingsbehoefte \xD7 dag_nacht_factor</code>
            
            <p><strong>Dag/nacht factor:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              In de nacht staat de warmtepomp vaak iets harder te werken (door lagere buitentemperatuur of opstarten in de vroege ochtend):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nacht (tussen 22:00 en 07:00 uur) = 1.2
overdag (tussen 07:00 en 22:00 uur) = 0.9</code>
            
            <p><strong>Maandfactoren voor de verwarmingsbehoefte (op basis van graaddagen):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Deze factoren bepalen hoe de warmtevraag over het jaar is verdeeld (hoog in de winter, laag in de zomer):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jan: 1.38  \xB7  feb: 1.21  \xB7  mrt: 1.10  \xB7  apr: 0.77
mei: 0.44  \xB7  jun: 0.17  \xB7  jul: 0.15  \xB7  aug: 0.15
sep: 0.29  \xB7  okt: 0.66  \xB7  nov: 1.02  \xB7  dec: 1.31</code>
          </div>
        </details>`
      };
    }
    return {
      title: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="font-size: 1.2rem; color: var(--accent-blue);"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg> Hoe werkt het EV-model?`,
      body: `
      <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
        Uit <strong>wekelijkse afstand \xD7 verbruik per 100 km</strong> volgt de jaarlijkse laadvraag.
        Die wordt slim over de uren verdeeld \u2014 apart gepland voor het dynamische en het vaste contract.
      </p>
      ${watervalBlock}
      <div class="explain-block">
        <h4>Slim laden (look-ahead per dag)</h4>
        <ul>
          <li>Eerst <strong>gratis zonne-overschot</strong> (overdag, ~10\u201316u), als zonne-laden aanstaat.</li>
          <li>Daarna het restant in de <strong>goedkoopste resterende uren</strong> (dynamisch) resp. de
            <strong>daluren</strong> (vast contract).</li>
        </ul>
      </div>
      <div class="explain-block">
        <h4>Wanneer staat de auto ingeplugd?</h4>
        <ul>
          <li><strong>Altijd thuis:</strong> laden mag overdag \xE9n 's nachts.</li>
          <li><strong>Kantoortijden:</strong> ma\u2013vr 08:00\u201317:00 is de auto weg \u2014 dan vervalt zonne-laden op
            werkdagen en wordt vooral 's avonds/nachts geladen.</li>
          <li>Zonne-laden uit = de hele laadvraag komt volgens het schema van het net.</li>
        </ul>
      </div>
      <details class="explain-formula">
        <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
        <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
          <p><strong>Benodigde laadstroom:</strong></p>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jaarlijkse_laadvraag = (wekelijkse_afstand \xD7 verbruik_per_100km / 100) \xD7 52 weken
gemiddelde_dagvraag  = (wekelijkse_afstand \xD7 verbruik_per_100km / 100) / 7 dagen</code>
          
          <p><strong>Verdeling van de laadstroom per dag (begrensd op ${EV_MAX_CHARGE_KW} kW per uur):</strong></p>
          <ol style="margin-left: 1.2rem; padding: 0; color: var(--text-muted); line-height: 1.6;">
            <li>Eerst vullen met het gratis <strong>zonne-overschot</strong> (meestal tussen 10:00 en 16:00 uur).</li>
            <li>Als er nog meer stroom nodig is: de rest inplannen tijdens de <strong>goedkoopste uren van de dag</strong> (dynamisch contract) of tijdens de <strong>daluren</strong> (vast contract).</li>
          </ol>
          <p style="margin-top: 0.5rem; color: var(--text-muted);">
            Bij de instelling "Kantoortijden" kan de auto op werkdagen (maandag t/m vrijdag) tussen 08:00 en 17:00 uur niet laden omdat de auto dan weg is.
          </p>
        </div>
      </details>`
    };
  }
  function toggleTableDetail(headerId, subRowClass) {
    const header = document.getElementById(headerId);
    if (!header) return;
    const chevron = header.querySelector(".toggle-chevron");
    const subRows = document.querySelectorAll("." + subRowClass);
    if (!subRows.length) return;
    const isHidden = subRows[0].style.display === "none";
    subRows.forEach((row) => {
      if (row.id === "tbl-dyn-afname-detail") {
        row.style.display = "none";
        const subChevron = document.getElementById("afname-toggle-icon");
        if (subChevron) subChevron.style.transform = "rotate(0deg)";
      } else {
        row.style.display = isHidden ? "" : "none";
      }
    });
    if (chevron) {
      chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
    }
  }
  function toggleCard(titleEl) {
    const card = titleEl.closest(".glass-panel");
    if (card) card.classList.toggle("collapsed");
  }
  function toggleProfileLine(key) {
    const current = appStore.getState().profileVisibleLines;
    const nextLines = { ...current, [key]: !current[key] };
    appStore.setState({ profileVisibleLines: nextLines });
    const legendEl = document.getElementById(`legend-${key}`);
    if (legendEl) {
      legendEl.style.opacity = nextLines[key] ? "1" : "0.35";
      legendEl.style.textDecoration = nextLines[key] ? "none" : "line-through";
    }
    renderChart();
  }
  function showCsvMapModal(entities, guesses) {
    return new Promise((resolve, reject) => {
      const backdrop = document.getElementById("csv-map-backdrop");
      const selectIds = [
        "csv-sel-imp1",
        "csv-sel-imp2",
        "csv-sel-exp1",
        "csv-sel-exp2",
        "csv-sel-solar",
        "csv-sel-ev",
        "csv-sel-hp",
        "csv-sel-batIn",
        "csv-sel-batOut"
      ];
      selectIds.forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = "";
        const role = id.replace("csv-sel-", "");
        const isOptional = ["solar", "ev", "hp", "batIn", "batOut"].includes(role);
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = isOptional ? "\u2014 Niet koppelen (optioneel) \u2014" : "\u2014 Selecteer sensor (vereist) \u2014";
        select.appendChild(emptyOpt);
        entities.forEach((ent) => {
          const opt = document.createElement("option");
          opt.value = ent;
          opt.textContent = ent;
          select.appendChild(opt);
        });
        if (guesses[role] && entities.includes(guesses[role])) {
          select.value = guesses[role];
        } else {
          select.value = "";
        }
      });
      backdrop.style.display = "flex";
      const cleanup = () => {
        backdrop.style.display = "none";
        document.getElementById("csv-map-confirm").removeEventListener("click", onConfirm);
        document.getElementById("csv-map-cancel").removeEventListener("click", onCancel);
      };
      function onConfirm() {
        const selection = {
          imp1: document.getElementById("csv-sel-imp1").value,
          imp2: document.getElementById("csv-sel-imp2").value,
          exp1: document.getElementById("csv-sel-exp1").value,
          exp2: document.getElementById("csv-sel-exp2").value,
          solar: document.getElementById("csv-sel-solar").value,
          ev: document.getElementById("csv-sel-ev").value,
          hp: document.getElementById("csv-sel-hp").value,
          batIn: document.getElementById("csv-sel-batIn").value,
          batOut: document.getElementById("csv-sel-batOut").value
        };
        if (!selection.imp1 && !selection.imp2) {
          alert("Selecteer minimaal \xE9\xE9n afname-sensor.");
          return;
        }
        cleanup();
        resolve(selection);
      }
      function onCancel() {
        cleanup();
        reject(new Error("CSV-import geannuleerd door gebruiker."));
      }
      document.getElementById("csv-map-confirm").addEventListener("click", onConfirm);
      document.getElementById("csv-map-cancel").addEventListener("click", onCancel);
    });
  }
  function showUploadError(msg) {
    document.getElementById("data-status").textContent = "Upload mislukt";
    let errEl = document.getElementById("upload-error");
    if (!errEl) {
      errEl = document.createElement("p");
      errEl.id = "upload-error";
      errEl.style.cssText = "color:var(--accent-orange);font-size:0.8rem;margin-top:0.6rem;";
      document.getElementById("dropzone").after(errEl);
    }
    errEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> ` + msg;
    setTimeout(() => {
      errEl.innerHTML = "";
    }, 8e3);
  }
  function toggleAfnameDetail() {
    afnameDetailOpen = !afnameDetailOpen;
    document.getElementById("tbl-dyn-afname-detail").style.display = afnameDetailOpen ? "" : "none";
    document.getElementById("afname-toggle-icon").style.transform = afnameDetailOpen ? "rotate(180deg)" : "";
    if (afnameDetailOpen) renderAfnameDetail();
  }
  function updateDigitalTwinBanner(meta) {
    const banner = document.getElementById("digital-twin-banner");
    if (!banner) return;
    const hasDevices = meta && (meta.active || meta.devices && (meta.devices.ev || meta.devices.hp || meta.devices.battery));
    window.digitalTwinMode = meta && meta.active ? meta : null;
    if (!hasDevices) {
      banner.style.display = "none";
      return;
    }
    const names = [];
    if (meta.devices?.ev) names.push("elektrische auto");
    if (meta.devices?.hp) names.push("warmtepomp");
    if (meta.devices?.battery) names.push("thuisbatterij");
    const human = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " en " + names.slice(-1);
    const devEl = document.getElementById("digital-twin-devices");
    if (devEl) devEl.textContent = human || "hardware";
    const { digitalTwinEnabled: digitalTwinEnabled2 } = appStore.getState();
    const on = digitalTwinEnabled2;
    banner.style.border = `1px solid ${on ? "var(--accent-cyan)" : "var(--accent-orange)"}`;
    banner.style.background = on ? "rgba(56,189,248,0.08)" : "rgba(251,146,60,0.08)";
    const statusEl = document.getElementById("dt-status-label");
    if (statusEl) statusEl.textContent = on ? "actief" : "uitgeschakeld";
    statusEl && (statusEl.style.color = on ? "var(--accent-cyan)" : "var(--accent-orange)");
    const btn = document.getElementById("dt-toggle-btn");
    if (btn) {
      btn.textContent = on ? "Uitschakelen" : "Inschakelen";
      btn.style.borderColor = on ? "var(--accent-cyan)" : "var(--accent-orange)";
      btn.style.background = on ? "rgba(56,189,248,0.15)" : "rgba(251,146,60,0.15)";
      btn.style.color = on ? "var(--accent-cyan)" : "var(--accent-orange)";
    }
    const bodyEl = document.getElementById("dt-banner-body");
    if (bodyEl) {
      bodyEl.innerHTML = on ? `Je bestaande <span id="digital-twin-devices">${human || "hardware"}</span> is uit de historische baseline <strong>gestript</strong>. De schuiven hieronder modelleren nu <strong>vervangende</strong> hardware, geen toevoegingen.` : `Digital Twin is uitgeschakeld \u2014 ruwe meterstanden worden 1-op-1 gebruikt. De hardware-schuiven modelleren <strong>toevoegingen</strong> bovenop je bestaande situatie.`;
    }
    banner.style.display = "block";
  }

  // src/app.js
  var ICON_CHECK2 = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  var ICON_WARN2 = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  var ICON_STAR = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-yellow);fill:var(--accent-yellow);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
  var ICON_LIGHTBULB = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-yellow);"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>`;
  var {
    energyData,
    sankeyInterval: sankeyInterval2,
    sankeyValue: sankeyValue2,
    activeSimulation: activeSimulation2,
    epexHistory,
    liveEnergyTax: liveEnergyTax2,
    _lastHAStats,
    _lastRoleMap,
    digitalTwinEnabled,
    isDemoData,
    fullYearData,
    fullYearStamp,
    yearScale,
    dataMeta,
    prognosisDismissed,
    dataQualityDismissed,
    calibratedProfile: calibratedProfile2,
    calibrationMeta: calibrationMeta2,
    untangle,
    dataQuality
  } = appStore.getState();
  appStore.subscribe((state) => {
    energyData = state.energyData;
    sankeyInterval2 = state.sankeyInterval;
    sankeyValue2 = state.sankeyValue;
    activeSimulation2 = state.activeSimulation;
    epexHistory = state.epexHistory;
    liveEnergyTax2 = state.liveEnergyTax;
    _lastHAStats = state._lastHAStats;
    _lastRoleMap = state._lastRoleMap;
    digitalTwinEnabled = state.digitalTwinEnabled;
    isDemoData = state.isDemoData;
    fullYearData = state.fullYearData;
    fullYearStamp = state.fullYearStamp;
    yearScale = state.yearScale;
    dataMeta = state.dataMeta;
    prognosisDismissed = state.prognosisDismissed;
    dataQualityDismissed = state.dataQualityDismissed;
    calibratedProfile2 = state.calibratedProfile;
    calibrationMeta2 = state.calibrationMeta;
    untangle = state.untangle;
    dataQuality = state.dataQuality;
  });
  window.toggleProfileLine = toggleProfileLine;
  var CALIB_MIN_SAMPLES = 3;
  function buildCalibratedProfile() {
    appStore.setState({ calibratedProfile: null, calibrationMeta: { buckets: 0, samples: 0 } });
    if (epexHistory.size < 24) return;
    const acc = {};
    for (const [key, price] of epexHistory.entries()) {
      const m = parseInt(key.slice(5, 7), 10);
      const h = parseInt(key.slice(11, 13), 10);
      if (!Number.isFinite(m) || !Number.isFinite(h)) continue;
      const s = seasonOf(m);
      acc[s] ||= {};
      acc[s][h] ||= { sum: 0, n: 0 };
      acc[s][h].sum += price;
      acc[s][h].n++;
    }
    const prof = {};
    let buckets = 0;
    for (const s of Object.keys(acc)) {
      for (const h of Object.keys(acc[s])) {
        const b = acc[s][h];
        if (b.n >= CALIB_MIN_SAMPLES) {
          (prof[s] ||= {})[h] = b.sum / b.n;
          buckets++;
        }
      }
    }
    if (buckets > 0) {
      appStore.setState({ calibratedProfile: prof, calibrationMeta: { buckets, samples: epexHistory.size } });
    }
  }
  var SUPPLIER_PRESETS = {
    vattenfall: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.045, "dynamic-markup": 0.025, "dynamic-export-markup": 0.025 },
    eneco: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.04, "fixed-feedin-fee": 0.03, "dynamic-markup": 0.025, "dynamic-export-markup": 0.025 },
    greenchoice: { "fixed-peak": 0.29, "fixed-dal": 0.26, "fixed-feedin-rate": 0.04, "fixed-feedin-fee": 0.01, "dynamic-markup": 0.02, "dynamic-export-markup": 0.02 },
    budgetthuis: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.02, "dynamic-markup": 0.02, "dynamic-export-markup": 0.02 },
    anwb: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.05, "fixed-feedin-fee": 0, "dynamic-markup": 0.02, "dynamic-export-markup": 0.02 },
    zonneplan: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.05, "fixed-feedin-fee": 0, "dynamic-markup": 0.015, "dynamic-export-markup": 0.015 }
  };
  function applySupplierPreset(key) {
    const preset = SUPPLIER_PRESETS[key];
    if (!preset) return;
    for (const [id, val] of Object.entries(preset)) setSlider(id, val);
    runSimulation();
  }
  window.toggleTableDetail = toggleTableDetail;
  function setViewMode(mode) {
    const body = document.body;
    const btnSimple = document.getElementById("btn-view-simple");
    const btnAdvanced = document.getElementById("btn-view-advanced");
    if (mode === "simple") {
      if (body && body.classList) {
        body.classList.add("mode-simple");
        body.classList.remove("mode-advanced");
      }
      if (btnSimple) btnSimple.classList.add("active");
      if (btnAdvanced) btnAdvanced.classList.remove("active");
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("view_mode", "simple");
      }
    } else {
      if (body && body.classList) {
        body.classList.add("mode-advanced");
        body.classList.remove("mode-simple");
      }
      if (btnSimple) btnSimple.classList.remove("active");
      if (btnAdvanced) btnAdvanced.classList.add("active");
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("view_mode", "advanced");
      }
    }
    if (typeof energyData !== "undefined" && energyData.length > 0) {
      runSimulation();
      setOverviewViewType(mode === "simple" ? "bars" : "sankey");
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    restoreDismissedElements();
    restoreHACredentials();
    if (typeof window !== "undefined" && window.innerWidth <= 800) {
      document.getElementById("intro-explainer")?.removeAttribute("open");
    }
    const savedMode = typeof localStorage !== "undefined" && localStorage.getItem("view_mode") || "simple";
    setViewMode(savedMode);
    loadDemoData().then(() => {
      if (typeof energyData !== "undefined" && energyData.length > 0) {
        setOverviewViewType(savedMode === "simple" ? "bars" : "sankey");
      }
    });
  });
  var SIM_MIN_INTERVAL_MS = 80;
  var _simRaf = 0;
  var _simTrailing = 0;
  var _simLastRun = 0;
  var _optDebounce = 0;
  function scheduleOptimize() {
    clearTimeout(_optDebounce);
    _optDebounce = setTimeout(() => optimizeBatterySize(true), 300);
  }
  var _resizeRaf = 0;
  function scheduleResize() {
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(() => {
      _resizeRaf = 0;
      renderChart();
      renderOverviewChart();
      renderMonthlyChart();
      renderSimChart();
      renderHwChart();
    });
  }
  function scheduleSim() {
    const since = Date.now() - _simLastRun;
    const fire = () => {
      if (_simRaf) return;
      _simRaf = requestAnimationFrame(() => {
        _simRaf = 0;
        _simLastRun = Date.now();
        runSimulation();
      });
    };
    if (since >= SIM_MIN_INTERVAL_MS) {
      fire();
    } else if (!_simTrailing) {
      _simTrailing = setTimeout(() => {
        _simTrailing = 0;
        fire();
      }, SIM_MIN_INTERVAL_MS - since);
    }
  }
  function initActionHandlers() {
    document.addEventListener("click", (e) => {
      const el = e.target?.closest?.("[data-action]");
      if (!el) return;
      e.preventDefault();
      const action = el.getAttribute("data-action");
      if (action === "show-setup-manual") showSetupModal("manual");
      else if (action === "show-setup-direct") showSetupModal("direct");
      else if (action === "expand-upload") {
        const p = document.getElementById("upload-panel");
        if (p) {
          p.classList.remove("collapsed");
          p.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else if (action === "expand-tariffs") {
        const p = document.getElementById("tariffs-config");
        if (p) {
          p.classList.remove("collapsed");
          p.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    });
  }
  function initDismissHandlers() {
    const DISMISS_FLAG = {
      "epex-warn-box": "epexWarnDismissed",
      "prognosis-badge": "prognosisDismissed",
      "data-quality-banner": "dataQualityDismissed"
    };
    document.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-dismiss]");
      if (!btn) return;
      const targetId = btn.getAttribute("data-dismiss");
      const el = document.getElementById(targetId);
      if (el) el.style.display = "none";
      const flag = DISMISS_FLAG[targetId];
      if (flag) appStore.setState({ [flag]: true });
      if (btn.hasAttribute("data-persist")) {
        localStorage.setItem(`dismissed_${targetId}`, "true");
      }
    });
  }
  function restoreDismissedElements() {
    document.querySelectorAll("[data-persist]").forEach((btn) => {
      const targetId = btn.getAttribute("data-dismiss");
      if (targetId && localStorage.getItem(`dismissed_${targetId}`) === "true") {
        const el = document.getElementById(targetId);
        if (el) el.style.display = "none";
      }
    });
  }
  function setupEventListeners() {
    const sliders = document.querySelectorAll('input[type="range"]');
    sliders.forEach((slider) => {
      const initBadge = document.getElementById(`${slider.id}-val`);
      if (initBadge) {
        initBadgeUnit(slider, initBadge);
        initBadge.textContent = formatBadgeValue(slider, initBadge);
        slider.setAttribute("aria-valuetext", initBadge.textContent.trim());
        makeBadgeEditable(slider, initBadge);
      }
      slider.addEventListener("input", (e) => {
        const badge = document.getElementById(`${e.target.id}-val`);
        if (badge && !badge.querySelector("input")) {
          badge.textContent = formatBadgeValue(e.target, badge);
          e.target.setAttribute("aria-valuetext", badge.textContent.trim());
        }
        scheduleSim();
      });
    });
    const toggles = ["has-ev", "has-battery", "has-heatpump"];
    toggles.forEach((toggleId) => {
      const el = document.getElementById(toggleId);
      el.addEventListener("change", (e) => {
        const panel = document.getElementById(`${toggleId}-panel`);
        if (panel) {
          if (e.target.checked) {
            panel.classList.add("open");
          } else {
            panel.classList.remove("open");
          }
        }
        runSimulation();
      });
    });
    document.getElementById("ev-solar-match").addEventListener("change", runSimulation);
    document.getElementById("ev-profile")?.addEventListener("change", runSimulation);
    document.getElementById("bat-mode")?.addEventListener("change", runSimulation);
    document.getElementById("bat-mode")?.addEventListener("change", updateBatModeHint);
    updateBatModeHint();
    document.getElementById("scenario-year")?.addEventListener("change", () => {
      updateScenarioYearTag();
      updateBatModeHint();
      runSimulation();
    });
    updateScenarioYearTag();
    const solarModeEl = document.getElementById("solar-dimming-mode");
    if (solarModeEl) {
      const updateDimmingExplain = () => {
        const v = solarModeEl.value;
        const el = document.getElementById("solar-dimming-explain");
        if (!el) return;
        const hasSensor = (document.getElementById("sel-solar")?.value || "") !== "";
        const sensorNote = hasSensor ? `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg> Omvormer-sensor gekoppeld \u2014 nauwkeurige berekening.` : `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Geen omvormer-sensor \u2014 schatting op basis van P1-meterdata.`;
        if (v === "do_nothing") {
          el.style.display = "none";
          return;
        }
        el.style.display = "block";
        if (v === "dim") {
          el.innerHTML = `<strong>Dimmen</strong>: de omvormer regelt automatisch af tot het momentele huisverbruik. Zonne-energie voedt nog steeds het huis \u2014 alleen het <em>overschot</em> dat naar het net zou gaan, wordt onderdrukt.<br>Effect op dynamisch: <strong>export = 0, import \u2248 0</strong> wanneer zonneopwek \u2265 huisverbruik.<br><em>${sensorNote}</em>`;
        } else {
          el.innerHTML = `<strong>Uitschakelen</strong>: omvormer compleet uit. Het huis trekt in die uren <em>alles</em> van het net, inclusief wat de panelen normaal zelf opwekten.<br>Effect op dynamisch: <strong>export = 0, import = volledig huisverbruik</strong> van het net.<br>${hasSensor ? `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg> Met sensor kan echt huisverbruik berekend worden.` : `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Zonder omvormer-sensor is de berekening minder nauwkeurig (zelf-verbruik van zonne is onbekend).`}`;
        }
      };
      solarModeEl.addEventListener("change", updateDimmingExplain);
      updateDimmingExplain();
    }
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileSelect);
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const files = Array.from(e.dataTransfer.files || []);
      for (const f of files) await processFile(f);
    });
    document.getElementById("ha-connect-btn").addEventListener("click", handleHAConnect);
    document.getElementById("ha-import-btn").addEventListener("click", handleHAImport);
    document.getElementById("fetch-tarieven-btn").addEventListener("click", fetchTarieven);
    document.getElementById("optimize-battery-btn")?.addEventListener("click", optimizeBatterySize);
    document.getElementById("show-setup-btn").addEventListener("click", showSetupModal);
    document.getElementById("modal-close").addEventListener("click", closeSetupModal);
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSetupModal();
    });
    document.getElementById("explain-close")?.addEventListener("click", closeHardwareExplainer);
    document.getElementById("explain-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeHardwareExplainer();
    });
    document.getElementById("tab-direct")?.addEventListener("click", () => {
      const fn = window.showModalTab || function(t) {
        document.getElementById("modal-tab-direct").style.display = t === "direct" ? "" : "none";
        document.getElementById("modal-tab-manual").style.display = t === "manual" ? "" : "none";
        document.getElementById("tab-direct").className = t === "direct" ? "btn-primary" : "btn-secondary";
        document.getElementById("tab-manual").className = t === "manual" ? "btn-primary" : "btn-secondary";
      };
      fn("direct");
    });
    document.getElementById("tab-manual")?.addEventListener("click", () => {
      const fn = window.showModalTab || function(t) {
        document.getElementById("modal-tab-direct").style.display = t === "direct" ? "" : "none";
        document.getElementById("modal-tab-manual").style.display = t === "manual" ? "" : "none";
        document.getElementById("tab-direct").className = t === "direct" ? "btn-primary" : "btn-secondary";
        document.getElementById("tab-manual").className = t === "manual" ? "btn-primary" : "btn-secondary";
      };
      fn("manual");
    });
    document.getElementById("copy-snippet-btn")?.addEventListener("click", copySetupSnippet);
    document.getElementById("btn-view-simple")?.addEventListener("click", () => setViewMode("simple"));
    document.getElementById("btn-view-advanced")?.addEventListener("click", () => setViewMode("advanced"));
    document.querySelectorAll("h2.section-title").forEach((el) => {
      el.addEventListener("click", () => toggleCard(el));
    });
    document.getElementById("btn-load-demo")?.addEventListener("click", loadDemoData);
    document.getElementById("prognose-toggle")?.addEventListener("change", runSimulation);
    document.getElementById("supplier-preset")?.addEventListener("change", (e) => applySupplierPreset(e.target.value));
    document.getElementById("solar-dimming-mode")?.addEventListener("change", runSimulation);
    document.getElementById("btn-explain-ev")?.addEventListener("click", () => showHardwareExplainer("ev"));
    document.getElementById("btn-explain-battery")?.addEventListener("click", () => showHardwareExplainer("battery"));
    document.getElementById("btn-explain-heatpump")?.addEventListener("click", () => showHardwareExplainer("heatpump"));
    document.getElementById("dt-toggle-btn")?.addEventListener("click", () => {
      toggleDigitalTwin(!digitalTwinEnabled);
    });
    ["imp", "exp", "spot", "solar", "ev", "hp", "bat"].forEach((l) => {
      document.getElementById("legend-" + l)?.addEventListener("click", () => toggleProfileLine(l));
    });
    ["bars", "sankey"].forEach((v) => {
      document.getElementById("ov-btn-view-" + v)?.addEventListener("click", () => setOverviewViewType(v));
    });
    ["day", "week", "month"].forEach((m) => {
      document.getElementById("ov-btn-" + m)?.addEventListener("click", () => setOverviewMode(m));
      document.getElementById("sim-btn-" + m)?.addEventListener("click", () => setSimMode(m));
    });
    ["energy", "cost", "savings"].forEach((m) => {
      document.getElementById("ov-btn-" + m)?.addEventListener("click", () => setOverviewMetric(m));
    });
    ["year", "month", "week", "day"].forEach((i) => {
      document.getElementById("sk-btn-" + i)?.addEventListener("click", () => setSankeyInterval(i));
    });
    document.getElementById("sk-nav-prev")?.addEventListener("click", () => navigateSankey(-1));
    document.getElementById("sk-nav-next")?.addEventListener("click", () => navigateSankey(1));
    document.getElementById("sim-back-btn")?.addEventListener("click", () => {
      appStore.setState({ simDrillDay: null });
      renderSimChart();
    });
    document.getElementById("hdr-fixed-net-energy")?.addEventListener("click", () => toggleTableDetail("hdr-fixed-net-energy", "fixed-net-detail"));
    document.getElementById("hdr-fixed-vaste-lasten")?.addEventListener("click", () => toggleTableDetail("hdr-fixed-vaste-lasten", "fixed-lasten-detail"));
    document.getElementById("hdr-dyn-net-energy")?.addEventListener("click", () => toggleTableDetail("hdr-dyn-net-energy", "dyn-net-detail"));
    document.getElementById("tbl-dyn-afname-row")?.addEventListener("click", (e) => {
      toggleAfnameDetail();
      e.stopPropagation();
    });
    document.getElementById("hdr-dyn-vaste-lasten")?.addEventListener("click", () => toggleTableDetail("hdr-dyn-vaste-lasten", "dyn-lasten-detail"));
    document.getElementById("btn-download-csv")?.addEventListener("click", downloadDataWithPrices);
    document.querySelectorAll(".btn-chart-export").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = btn.closest(".chart-export-wrap");
        const isOpen = wrap.classList.contains("open");
        _closeExportDropdowns(null);
        if (!isOpen) wrap.classList.add("open");
      });
    });
    document.querySelectorAll(".chart-export-dropdown button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = btn.closest(".chart-export-wrap");
        const svgId = wrap.dataset.chartSvg;
        const chartName = wrap.dataset.chartName;
        wrap.classList.remove("open");
        if (btn.dataset.format === "svg") exportChartAsSvg(svgId, chartName);
        else if (btn.dataset.format === "png") exportChartAsPng(svgId, chartName);
      });
    });
    document.addEventListener("click", () => _closeExportDropdowns(null));
    document.getElementById("btn-p1-help")?.addEventListener("click", () => {
      document.getElementById("p1-help-backdrop").style.display = "flex";
    });
    document.getElementById("p1-help-close")?.addEventListener("click", () => {
      document.getElementById("p1-help-backdrop").style.display = "none";
    });
    document.getElementById("p1-help-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) document.getElementById("p1-help-backdrop").style.display = "none";
    });
    document.getElementById("btn-show-guide")?.addEventListener("click", showUserGuide);
    document.getElementById("guide-close")?.addEventListener("click", closeUserGuide);
    document.getElementById("guide-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeUserGuide();
    });
    initDismissHandlers();
    initActionHandlers();
    ["sel-imp1", "sel-imp2", "sel-exp1", "sel-exp2"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", checkHAAutoImportAndCollapse);
    });
  }
  var haAutoTimeout = null;
  function checkHAAutoImportAndCollapse() {
    const imp1 = document.getElementById("sel-imp1")?.value;
    const imp2 = document.getElementById("sel-imp2")?.value;
    const exp1 = document.getElementById("sel-exp1")?.value;
    const exp2 = document.getElementById("sel-exp2")?.value;
    if (imp1 && imp2 && exp1 && exp2) {
      if (haAutoTimeout) clearTimeout(haAutoTimeout);
      haAutoTimeout = setTimeout(async () => {
        const statusEl = document.getElementById("ha-sync-status");
        if (statusEl) {
          statusEl.textContent = "Sensoren compleet. Data automatisch ophalen...";
          statusEl.style.color = "var(--accent-cyan)";
        }
        try {
          await handleHAImport();
        } catch (err) {
          console.error("Auto import failed:", err);
        }
      }, 1500);
    }
  }
  function restoreHACredentials() {
    const savedUrl = localStorage.getItem("ha_url");
    const savedToken = localStorage.getItem("ha_token");
    if (savedUrl) document.getElementById("ha-url").value = savedUrl;
    if (savedToken) document.getElementById("ha-token").value = savedToken;
  }
  function expandDemoProfile(p) {
    const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const p22 = (n) => (n < 10 ? "0" : "") + n;
    const rows = [];
    let i = 0;
    for (let m = 1; m <= 12 && i < p.hours; m++)
      for (let day = 1; day <= DAYS[m - 1] && i < p.hours; day++)
        for (let h = 0; h < 24 && i < p.hours; h++, i++)
          rows.push({
            timestamp: `${p.startYear}-${p22(m)}-${p22(day)}T${p22(h)}:00:00`,
            import_t1: p.imp[i],
            import_t2: 0,
            export_t1: p.exp[i],
            export_t2: 0,
            solar_yield: p.sol[i]
          });
    return rows;
  }
  async function loadDemoData() {
    try {
      if (window.DEMO_PROFILE && Array.isArray(window.DEMO_PROFILE.imp)) {
        appStore.setState({ energyData: expandDemoProfile(window.DEMO_PROFILE) });
        appStore.setState({ isDemoData: true });
        document.getElementById("data-status").textContent = `Voorbeelddata geladen \u2014 realistisch jaarprofiel (${Math.round(energyData.length / 24)} dagen) \xB7 koppel jouw HA voor je eigen data`;
        runSimulation();
        return;
      }
      const response = await fetch("p1_sample.json");
      if (!response.ok) throw new Error("Sample file missing");
      appStore.setState({ energyData: await response.json() });
      appStore.setState({ isDemoData: true });
      document.getElementById("data-status").textContent = "Voorbeelddata geladen \u2014 koppel jouw HA voor persoonlijke data";
      runSimulation();
    } catch (error) {
      console.error("Failed to load demo data:", error);
      document.getElementById("data-status").textContent = "Upload je eigen P1 bestand om te starten";
    }
  }
  function updateBatModeHint() {
    const el = document.getElementById("bat-mode-hint");
    if (!el) return;
    const mode = document.getElementById("bat-mode")?.value || "zelf";
    const is2026 = (document.getElementById("scenario-year")?.value || "2027") === "2026";
    const winst2026 = `Met saldering (2026) is teruglevering binnen je jaarverbruik bijna evenveel waard als zelfverbruik \u2014 net-laden en terugverkopen bij prijspieken kan dan \xE9cht lonen.`;
    const winst2027 = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Onder bruto-EB (2027) levert teruglevering minder op dan zelfverbruik, dus op normale prijzen komt dit vrijwel gelijk uit met "Kostenbewust". Echt voordeel pas bij flinke prijspieken.`;
    const hints = {
      zelf: `All\xE9\xE9n zon opslaan en ontladen voor eigen verbruik \u2014 robuust en voorspelbaar.`,
      kosten: `Laadt \xF3\xF3k goedkoop van het net, maar alleen voor eigen verbruik (geen teruglevering).`,
      winst: is2026 ? winst2026 : winst2027
    };
    el.innerHTML = hints[mode] || "";
    el.style.display = el.innerHTML ? "block" : "none";
  }
  function updateScenarioYearTag() {
    const tag = document.getElementById("fixed-params-year-tag");
    if (!tag) return;
    const year = document.getElementById("scenario-year")?.value || "2027";
    tag.textContent = year === "2026" ? "(2026 \xB7 met saldering)" : "(2027 \xB7 geen saldering)";
  }
  function copySetupSnippet() {
    const origin = window.location.origin;
    const snippet = `http:
  cors_allowed_origins:
    - ${origin}`;
    navigator.clipboard.writeText(snippet).then(() => {
      const btn = document.getElementById("copy-snippet-btn");
      btn.textContent = "Gekopieerd!";
      setTimeout(() => btn.textContent = "Kopieer naar klembord", 2e3);
    });
  }
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const f of files) await processFile(f);
    e.target.value = "";
    autoFetchEpex();
    setTimeout(() => {
      const uploadPanel = document.getElementById("upload-panel");
      if (uploadPanel) uploadPanel.classList.add("collapsed");
    }, 1500);
  }
  function processFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      document.getElementById("data-status").textContent = "Bezig met verwerken\u2026";
      reader.onload = async function(event) {
        try {
          let parsed = [];
          if (file.name.endsWith(".json")) {
            const raw = JSON.parse(event.target.result);
            if (Array.isArray(raw) && raw[0]?.timestamp !== void 0) {
              parsed = raw;
            } else if (Array.isArray(raw) && raw[0]?.entity_id !== void 0) {
              parsed = parseHAStatisticsJSON(raw);
            } else {
              throw new Error("Onbekend JSON-formaat. Gebruik een HA statistieken export of onze eigen export.");
            }
          } else if (file.name.endsWith(".csv")) {
            parsed = await parseAutoCSVAsync(event.target.result);
          } else {
            throw new Error("Ongeldig bestandstype. Selecteer een .json of .csv bestand.");
          }
          if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error("Geen geldige P1-stroomgegevens gevonden. Controleer of het bestand import/export sensor data bevat.");
          }
          const mergeBase = isDemoData ? [] : energyData;
          if (isDemoData) appStore.setState({ isDemoData: false });
          const merged = /* @__PURE__ */ new Map();
          for (const r of mergeBase) merged.set(r.timestamp, r);
          for (const r of parsed) merged.set(r.timestamp, r);
          const oldUntangle = untangle;
          const sorted = Array.from(merged.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          appStore.setState({
            energyData: sorted,
            untangle: parsed.untangle || oldUntangle || { active: false }
          });
          const span = energyData.length > 0 ? ` (${new Date(energyData[0].timestamp).toLocaleDateString("nl-NL")} t/m ${new Date(energyData[energyData.length - 1].timestamp).toLocaleDateString("nl-NL")})` : "";
          document.getElementById("data-status").innerHTML = `${ICON_CHECK2} <span>${file.name} \u2014 ${parsed.length} records \xB7 ${energyData.length} totaal${span}</span>`;
          updateDigitalTwinBanner(untangle);
          runSimulation();
        } catch (error) {
          if (error && /geannuleerd/i.test(error.message || "")) {
            document.getElementById("data-status").textContent = "Koppeling geannuleerd.";
          } else {
            console.error("Parse error:", error);
            showUploadError(error.message);
          }
        } finally {
          resolve();
        }
      };
      reader.onerror = () => {
        showUploadError("Bestand kon niet gelezen worden.");
        resolve();
      };
      reader.readAsText(file);
    });
  }
  function guessRolesFromEntities(entities) {
    const find = (...pats) => entities.find((e) => {
      const s = e.toLowerCase();
      return pats.some((p) => s.includes(p));
    }) || "";
    return {
      imp1: find("import_tariff_1", "import_t1", "afname_tarief_1", "afname_t1", "verbruik_piek"),
      imp2: find("import_tariff_2", "import_t2", "afname_tarief_2", "afname_t2", "verbruik_dal"),
      exp1: find("export_tariff_1", "export_t1", "teruglevering_tariff_1", "teruglever_t1"),
      exp2: find("export_tariff_2", "export_t2", "teruglevering_tariff_2", "teruglever_t2"),
      solar: find("solar", "_pv", "zon", "opwek", "envoy", "inverter", "omvormer"),
      ev: find("laadpaal", "wallbox", "charger", "myenergi", "zappi", "wallbox"),
      hp: find("warmtepomp", "heatpump", "altherma", "nibe", "compressor"),
      batIn: find("aggr_charge", "_charge", "laden", "bat_in", "battery_charge"),
      batOut: find("aggr_discharge", "discharge", "ontladen", "bat_out", "battery_discharge")
    };
  }
  async function parseAutoCSVAsync(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) throw new Error("CSV is leeg of heeft slechts \xE9\xE9n rij.");
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map((h) => h.trim());
    if (headers[0].toLowerCase() === "entity_id" && headers[1].toLowerCase() === "type" && headers[2].toLowerCase() === "unit") {
      return await parseHAStatisticsWideCSVAsync(lines, sep, headers, showCsvMapModal, digitalTwinEnabled);
    }
    if (headers.some((h) => ["timestamp", "datetime", "datum", "date"].includes(h.toLowerCase()))) {
      const result = parseLongCSV(lines, sep, headers);
      if (result !== null) return result;
      const guesses = guessColumnRoles(headers);
      const selection = await showCsvMapModal(headers, guesses);
      return parseLongCSVWithMapping(lines, sep, headers, selection);
    }
    if (headers[0].toLowerCase() === "entity_id" && headers[1].toLowerCase() === "state" && headers[2].toLowerCase() === "last_changed") {
      const entities = [...new Set(lines.slice(1).map((l) => l.split(sep)[0]?.trim()).filter(Boolean))];
      if (entities.length === 0) throw new Error("Geen sensoren (entity_id) gevonden in de CSV.");
      const guesses = guessRolesFromEntities(entities);
      if (_lastRoleMap) for (const role of Object.keys(guesses)) {
        if (_lastRoleMap[role] && entities.includes(_lastRoleMap[role])) guesses[role] = _lastRoleMap[role];
      }
      const selection = await showCsvMapModal(entities, guesses);
      const roleMap = {
        ...selection,
        solarUnit: "kWh",
        evUnit: "kWh",
        hpUnit: "kWh",
        batInUnit: "kWh",
        batOutUnit: "kWh"
      };
      appStore.setState({ _lastRoleMap: roleMap });
      return parseHAHistoryExportCSV(lines, sep, headers, roleMap, digitalTwinEnabled);
    }
    throw new Error("CSV-formaat niet herkend.");
  }
  function parseHAStatisticsJSON(raw) {
    const sensorMap = {};
    raw.forEach((entry) => {
      if (!entry.entity_id || entry.change === void 0) return;
      if (!sensorMap[entry.entity_id]) sensorMap[entry.entity_id] = {};
      sensorMap[entry.entity_id][entry.start || entry.timestamp] = Math.max(0, parseFloat(entry.change) || 0);
    });
    function findSensor(patterns) {
      for (const p of patterns) {
        const key = Object.keys(sensorMap).find((k) => k.toLowerCase().includes(p));
        if (key) return sensorMap[key];
      }
      return {};
    }
    const imp1 = findSensor(["import_tariff_1", "import_t1"]);
    const imp2 = findSensor(["import_tariff_2", "import_t2"]);
    const exp1 = findSensor(["export_tariff_1", "export_t1"]);
    const exp2 = findSensor(["export_tariff_2", "export_t2"]);
    const allTs = [.../* @__PURE__ */ new Set([
      ...Object.keys(imp1),
      ...Object.keys(imp2),
      ...Object.keys(exp1),
      ...Object.keys(exp2)
    ])].sort();
    return allTs.map((ts) => ({
      timestamp: new Date(ts).toISOString(),
      import_t1: imp1[ts] || 0,
      import_t2: imp2[ts] || 0,
      export_t1: exp1[ts] || 0,
      export_t2: exp2[ts] || 0
    }));
  }
  async function handleHAConnect() {
    const urlInput = document.getElementById("ha-url").value.trim();
    const tokenInput = document.getElementById("ha-token").value.trim();
    const statusEl = document.getElementById("ha-sync-status");
    if (!urlInput || !tokenInput) {
      statusEl.innerHTML = "Vul a.u.b. beide velden in.";
      statusEl.style.color = "var(--accent-orange)";
      return;
    }
    if (window.location.protocol === "file:") {
      statusEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Pagina geopend als bestand. Start een lokale server:<br><code style="display:block;margin:0.3rem 0;padding:0.3rem 0.5rem;background:rgba(0,0,0,0.4);border-radius:4px;">python3 -m http.server 8080</code>Voeg <strong>http://localhost:8080</strong> toe aan <code>cors_allowed_origins</code> in HA.`;
      statusEl.style.color = "var(--accent-orange)";
      return;
    }
    let cleanUrl = urlInput.replace(/\/$/, "");
    if (!/^https?:\/\//i.test(cleanUrl)) {
      if (window.location.protocol === "https:") {
        statusEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <strong>Ongeldige URL:</strong> Geef een volledig adres op dat begint met <code>https://</code> (bijv. <code>https://ha.mydomain.nl</code>).`;
        statusEl.style.color = "var(--accent-orange)";
        return;
      } else {
        cleanUrl = "http://" + cleanUrl;
      }
    }
    if (window.location.protocol === "https:" && cleanUrl.toLowerCase().startsWith("http://")) {
      statusEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <strong>Mixed Content geblokkeerd!</strong><br>Je bezoekt deze site via HTTPS, maar probeert te verbinden met een onbeveiligde Home Assistant (HTTP). De browser blokkeert dit om veiligheidsredenen.<br><br><strong>Oplossingen:</strong><br>1. Gebruik een <code>https://</code> adres voor Home Assistant (bijv. via Nabu Casa of reverse proxy).<br>2. Start de app lokaal via HTTP (bijv. via <code>npm start</code> of Python server) en open <a href="http://localhost:3000/" style="color:var(--accent-cyan); font-weight:600;">http://localhost:3000/</a>.<br>3. Exporteer handmatig je data uit HA en upload het CSV/JSON bestand. <a href="#" data-action="show-setup-manual" style="color:var(--accent-cyan); font-weight:600;">Gids \u2192</a>`;
      statusEl.style.color = "var(--accent-orange)";
      return;
    }
    statusEl.textContent = "Verbinding testen\u2026";
    statusEl.style.color = "var(--accent-cyan)";
    document.getElementById("ha-sensor-picker").style.display = "none";
    try {
      let apiResp;
      try {
        apiResp = await fetch(`${cleanUrl}/api/`, {
          headers: { "Authorization": `Bearer ${tokenInput}` }
        });
      } catch {
        statusEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Verbinding mislukt (CORS preflight geweigerd).<br>Voeg <code>${window.location.origin}</code> toe aan <code>cors_allowed_origins</code> in HA en herstart. <a href="#" data-action="show-setup-direct" style="color:var(--accent-cyan);">Gids \u2192</a>`;
        statusEl.style.color = "var(--accent-orange)";
        return;
      }
      if (apiResp.status === 401) {
        statusEl.textContent = "Ongeldige token \u2014 controleer je Long-Lived Access Token.";
        statusEl.style.color = "var(--accent-orange)";
        return;
      }
      statusEl.textContent = "Sensoren ophalen\u2026";
      const statesResp = await fetch(`${cleanUrl}/api/states`, {
        headers: { "Authorization": `Bearer ${tokenInput}` }
      });
      const allStates = await statesResp.json();
      const kwhSensors = allStates.filter((s) => s.attributes?.unit_of_measurement === "kWh").map((s) => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "kWh", unavailable };
      }).sort((a, b) => a.id.localeCompare(b.id));
      const whSensors = allStates.filter((s) => s.attributes?.unit_of_measurement === "Wh").map((s) => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "Wh", unavailable };
      }).sort((a, b) => a.id.localeCompare(b.id));
      const kwSensors = allStates.filter((s) => s.attributes?.unit_of_measurement === "kW").map((s) => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "kW", unavailable };
      }).sort((a, b) => a.id.localeCompare(b.id));
      const wSensors = allStates.filter((s) => s.attributes?.unit_of_measurement === "W").map((s) => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "W", unavailable };
      }).sort((a, b) => a.id.localeCompare(b.id));
      if (kwhSensors.length === 0) {
        statusEl.textContent = "Geen kWh sensoren gevonden in deze HA.";
        statusEl.style.color = "var(--accent-orange)";
        return;
      }
      const guess = (patterns) => (kwhSensors.find((s) => patterns.some((p) => s.id.toLowerCase().includes(p))) || {}).id || "";
      const savedSensors = JSON.parse(localStorage.getItem("ha_sensors") || "{}");
      populateSensorSelect(
        "sel-imp1",
        kwhSensors,
        savedSensors.imp1 || guess(["import_tariff_1", "import_t1", "afname_tariff_1", "energy_import_tariff_1"])
      );
      populateSensorSelect(
        "sel-imp2",
        kwhSensors,
        savedSensors.imp2 || guess(["import_tariff_2", "import_t2", "afname_tariff_2", "energy_import_tariff_2"])
      );
      populateSensorSelect(
        "sel-exp1",
        kwhSensors,
        savedSensors.exp1 || guess(["export_tariff_1", "export_t1", "return_tariff_1", "energy_export_tariff_1"])
      );
      populateSensorSelect(
        "sel-exp2",
        kwhSensors,
        savedSensors.exp2 || guess(["export_tariff_2", "export_t2", "return_tariff_2", "energy_export_tariff_2"])
      );
      const allAvailableSensors = [...kwhSensors, ...whSensors, ...kwSensors, ...wSensors];
      const sensorUnitMap = {};
      allAvailableSensors.forEach((s) => {
        sensorUnitMap[s.id] = s.unit;
      });
      window._solarSensorUnitMap = sensorUnitMap;
      window._haSensorUnitMap = sensorUnitMap;
      const fillCategorizedSelect = (id, savedVal, patterns, defaultLabel) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const selectedId = savedVal || (allAvailableSensors.find((s) => patterns.some((p) => s.id.toLowerCase().includes(p))) || {}).id || "";
        const rec = [];
        const other = [];
        allAvailableSensors.forEach((s) => {
          const isRec = patterns.some((p) => s.id.toLowerCase().includes(p));
          if (isRec) rec.push(s);
          else other.push(s);
        });
        const makeOpt = (s) => {
          const isLive = s.unit === "kW" || s.unit === "W";
          const label = isLive ? `${s.id} [${s.unit} - live vermogen fallback]` : s.unit === "Wh" ? `${s.id} [Wh \u2192 kWh]` : s.id;
          const o = document.createElement("option");
          o.value = s.id;
          o.textContent = label + (s.unavailable ? " [offline]" : "");
          o.dataset.unit = s.unit;
          if (s.id === selectedId) o.selected = true;
          return o;
        };
        const makeGroup = (label, arr) => {
          const g = document.createElement("optgroup");
          g.label = label;
          arr.forEach((s) => g.appendChild(makeOpt(s)));
          return g;
        };
        const appendGrouped = (arr) => {
          const kwh = arr.filter((s) => s.unit === "kWh");
          const wh = arr.filter((s) => s.unit === "Wh");
          const kw = arr.filter((s) => s.unit === "kW");
          const w = arr.filter((s) => s.unit === "W");
          if (kwh.length) sel.appendChild(makeGroup("kWh sensoren", kwh));
          if (wh.length) sel.appendChild(makeGroup("Wh sensoren (omvormers/laders)", wh));
          if (kw.length) sel.appendChild(makeGroup("kW sensoren (live vermogen fallback)", kw));
          if (w.length) sel.appendChild(makeGroup("W sensoren (live vermogen fallback)", w));
        };
        sel.textContent = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = defaultLabel;
        sel.appendChild(blank);
        if (rec.length) sel.appendChild(makeGroup("Aanbevolen (op basis van naam)", rec));
        if (other.length) appendGrouped(other);
      };
      fillCategorizedSelect(
        "sel-solar",
        savedSensors.solar,
        ["solar", "yield", "opwek", "pv_energy", "inverter", "omvormer", "production", "lifetime_energy", "zonnepaneel"],
        "\u2014 Niet koppelen (export-gebaseerde schatting) \u2014"
      );
      fillCategorizedSelect(
        "sel-ev",
        savedSensors.ev,
        ["ev", "wallbox", "charger", "laadpaal", "car_charg", "easee", "zaptec", "alfen", "tesla", "cocharger"],
        "\u2014 Niet koppelen \u2014"
      );
      fillCategorizedSelect(
        "sel-hp",
        savedSensors.hp,
        ["heat_pump", "warmtepomp", "heatpump", "hp_", "quatt", "daikin", "wp_", "elga"],
        "\u2014 Niet koppelen \u2014"
      );
      fillCategorizedSelect(
        "sel-bat-in",
        savedSensors.batIn,
        ["battery_charge", "battery_in", "accu_laden", "bat_charge", "charge_energy", "accu_in"],
        "\u2014 Niet koppelen \u2014"
      );
      fillCategorizedSelect(
        "sel-bat-out",
        savedSensors.batOut,
        ["battery_discharge", "battery_out", "accu_ontladen", "bat_discharge", "discharge_energy", "accu_uit"],
        "\u2014 Niet koppelen \u2014"
      );
      localStorage.setItem("ha_url", urlInput);
      localStorage.setItem("ha_token", tokenInput);
      const offlineCount = kwhSensors.filter((s) => s.unavailable).length;
      const offlineNote = offlineCount > 0 ? ` (${offlineCount} offline)` : "";
      const whNote = whSensors.length > 0 ? ` \xB7 ${whSensors.length} Wh-sensoren (omvormers) voor zonne-meting` : "";
      statusEl.innerHTML = `${ICON_CHECK2} <span>Verbonden \u2014 ${kwhSensors.length} kWh sensoren${offlineNote}${whNote}. Kies de juiste P1 sensoren hieronder.</span>`;
      statusEl.style.color = "var(--accent-green)";
      document.getElementById("ha-sensor-picker").style.display = "block";
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Fout: ${err.message}`;
      statusEl.style.color = "var(--accent-orange)";
    }
  }
  function populateSensorSelect(selectId, options, selectedValue) {
    const sel = document.getElementById(selectId);
    sel.textContent = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "\u2014 Niet gebruiken \u2014";
    sel.appendChild(blank);
    options.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.id + (s.unavailable ? " [offline]" : "");
      if (s.id === selectedValue) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  async function handleHAImport() {
    const urlInput = document.getElementById("ha-url").value.trim();
    const tokenInput = document.getElementById("ha-token").value.trim();
    const statusEl = document.getElementById("ha-sync-status");
    const days = parseInt(document.getElementById("ha-days").value) || 90;
    const solarSensor = document.getElementById("sel-solar")?.value || "";
    const savedSensorsForUnit = JSON.parse(localStorage.getItem("ha_sensors") || "{}");
    const solarUnit = window._solarSensorUnitMap?.[solarSensor] || document.querySelector(`#sel-solar option[value="${CSS.escape(solarSensor)}"]`)?.dataset?.unit || (savedSensorsForUnit.solar === solarSensor ? savedSensorsForUnit.solarUnit : null) || "kWh";
    const evSensor = document.getElementById("sel-ev")?.value || "";
    const hpSensor = document.getElementById("sel-hp")?.value || "";
    const batInSensor = document.getElementById("sel-bat-in")?.value || "";
    const batOutSensor = document.getElementById("sel-bat-out")?.value || "";
    const unitOf = (entId) => window._haSensorUnitMap?.[entId] || document.querySelector(`#sel-ev option[value="${CSS.escape(entId)}"]`)?.dataset?.unit || (savedSensorsForUnit.ev === entId ? savedSensorsForUnit.evUnit : null) || (savedSensorsForUnit.hp === entId ? savedSensorsForUnit.hpUnit : null) || (savedSensorsForUnit.batIn === entId ? savedSensorsForUnit.batInUnit : null) || (savedSensorsForUnit.batOut === entId ? savedSensorsForUnit.batOutUnit : null) || "kWh";
    const evUnit = unitOf(evSensor);
    const hpUnit = unitOf(hpSensor);
    const batInUnit = unitOf(batInSensor);
    const batOutUnit = unitOf(batOutSensor);
    const entities = [
      document.getElementById("sel-imp1").value,
      document.getElementById("sel-imp2").value,
      document.getElementById("sel-exp1").value,
      document.getElementById("sel-exp2").value,
      solarSensor,
      evSensor,
      hpSensor,
      batInSensor,
      batOutSensor
    ].filter(Boolean);
    const uniqueEntities = [...new Set(entities)];
    if (uniqueEntities.length === 0) {
      statusEl.textContent = "Selecteer minimaal \xE9\xE9n sensor.";
      statusEl.style.color = "var(--accent-orange)";
      return;
    }
    localStorage.setItem("ha_sensors", JSON.stringify({
      imp1: document.getElementById("sel-imp1").value,
      imp2: document.getElementById("sel-imp2").value,
      exp1: document.getElementById("sel-exp1").value,
      exp2: document.getElementById("sel-exp2").value,
      solar: document.getElementById("sel-solar")?.value || "",
      solarUnit,
      // onthoud of het Wh of kWh was
      ev: evSensor,
      evUnit,
      hp: hpSensor,
      hpUnit,
      batIn: batInSensor,
      batInUnit,
      batOut: batOutSensor,
      batOutUnit
    }));
    statusEl.textContent = "Verbinding via WebSocket\u2026";
    statusEl.style.color = "var(--accent-cyan)";
    const cleanUrl = urlInput.replace(/\/$/, "");
    const wsUrl = cleanUrl.replace(/^http/, "ws") + "/api/websocket";
    const roleMap = {
      imp1: document.getElementById("sel-imp1").value,
      imp2: document.getElementById("sel-imp2").value,
      exp1: document.getElementById("sel-exp1").value,
      exp2: document.getElementById("sel-exp2").value,
      solar: document.getElementById("sel-solar")?.value || "",
      solarUnit,
      ev: evSensor,
      evUnit,
      hp: hpSensor,
      hpUnit,
      batIn: batInSensor,
      batInUnit,
      batOut: batOutSensor,
      batOutUnit
    };
    try {
      const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1e3).toISOString();
      const endTime = (/* @__PURE__ */ new Date()).toISOString();
      const stats = await fetchHAStatisticsWS(wsUrl, tokenInput, uniqueEntities, startTime, endTime, statusEl);
      const haParsed = processHAStatistics(stats, roleMap, digitalTwinEnabled);
      appStore.setState({
        _lastHAStats: stats,
        _lastRoleMap: roleMap,
        energyData: haParsed,
        untangle: haParsed.untangle || { active: false },
        isDemoData: false
      });
      updateDigitalTwinBanner(untangle);
      statusEl.innerHTML = `${ICON_CHECK2} <span>${energyData.length} uurrecords geladen \xB7 EPEX prijzen ophalen\u2026</span>`;
      statusEl.style.color = "var(--accent-cyan)";
      let successMsg = "";
      try {
        await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
        successMsg = `${ICON_CHECK2} <span>${energyData.length} uurrecords + ${epexHistory.size} echte EPEX-prijzen geladen (${days} dagen)</span>`;
      } catch (_) {
        successMsg = `${ICON_CHECK2} <span>${energyData.length} uurrecords geladen (EPEX-prijzen niet beschikbaar)</span>`;
      }
      if (untangle.batterySensorSuspect) {
        statusEl.innerHTML = `<strong>${successMsg}</strong><br><span style="color:var(--accent-orange);font-size:0.78rem;">${ICON_WARN2} <span>Batterij-sensoren controleren: ontladen > laden over de hele periode is fysiek onmogelijk. Kies sensoren die beide aan de net-/AC-zijde meten (of verwissel in/uit).</span></span>`;
      } else {
        statusEl.innerHTML = successMsg;
        statusEl.style.color = "var(--accent-green)";
      }
      document.getElementById("data-status").textContent = `HA statistieken \u2014 ${energyData.length} uurrecords (${days}d)`;
      localStorage.setItem("ha_url", urlInput);
      localStorage.setItem("ha_token", tokenInput);
      runSimulation();
      if (!untangle.batterySensorSuspect) {
        setTimeout(() => {
          const haCard = document.getElementById("ha-card");
          if (haCard) haCard.classList.add("collapsed");
        }, 1500);
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Fout: ${err.message}`;
      statusEl.style.color = "var(--accent-orange)";
    }
  }
  function fetchHAStatisticsWS(wsUrl, token, statIds, startTime, endTime, statusEl) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        return reject(new Error("Ongeldig WebSocket-adres: " + wsUrl));
      }
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket timeout \u2014 controleer het HA-adres."));
      }, 15e3);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          if (statusEl) statusEl.textContent = "Statistieken ophalen\u2026";
          ws.send(JSON.stringify({
            id: 1,
            type: "recorder/statistics_during_period",
            start_time: startTime,
            end_time: endTime,
            statistic_ids: statIds,
            period: "hour",
            types: ["sum", "mean"]
          }));
        } else if (msg.type === "auth_invalid") {
          clearTimeout(timeout);
          ws.close();
          reject(new Error("Ongeldige token \u2014 controleer je Long-Lived Access Token."));
        } else if (msg.type === "result" && msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (!msg.success) reject(new Error("HA statistieken-fout: " + JSON.stringify(msg.error)));
          else resolve(msg.result || {});
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket verbinding mislukt \u2014 controleer HA-adres."));
      };
    });
  }
  function toggleDigitalTwin(enabled) {
    appStore.setState({ digitalTwinEnabled: enabled });
    if (!_lastHAStats || !_lastRoleMap) return;
    const dtParsed = processHAStatistics(_lastHAStats, _lastRoleMap, digitalTwinEnabled);
    appStore.setState({
      energyData: dtParsed,
      untangle: dtParsed.untangle || { active: false },
      isDemoData: false
    });
    updateDigitalTwinBanner(untangle);
    appStore.setState({ fullYearStamp: "" });
    runSimulation();
  }
  async function fetchTarieven() {
    const btn = document.getElementById("fetch-tarieven-btn");
    const status = document.getElementById("tarieven-status");
    btn.disabled = true;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Ophalen\u2026`;
    status.style.display = "block";
    status.style.color = "var(--text-muted)";
    status.textContent = "Frank Energie prijzen ophalen\u2026";
    try {
      let eb = liveEnergyTax2 || 0.11084;
      let avgOpslag = parseFloat(document.getElementById("dynamic-markup")?.value || "0.024");
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const frankResp = await fetch("https://frank-graphql-prod.graphcdn.app/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `{ marketPrices(date: "${today}") { electricityPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice } } }` })
      });
      const frankData = await frankResp.json();
      const prices = frankData?.data?.marketPrices?.electricityPrices || [];
      if (prices.length > 0) {
        eb = prices[0].energyTaxPrice;
        appStore.setState({ liveEnergyTax: eb });
        setSlider("energy-tax", eb);
        avgOpslag = prices.reduce((s, p) => s + p.sourcingMarkupPrice, 0) / prices.length;
        setSlider("dynamic-markup", avgOpslag.toFixed(4));
        appStore.updateEpexHistory(prices.map((p) => [epexKey(new Date(p.from)), p.marketPrice + p.marketPriceTax]));
        status.innerHTML = `${ICON_CHECK2} <span>Frank: EB = \u20AC${eb.toFixed(5)}/kWh \xB7 opslag = \u20AC${avgOpslag.toFixed(4)}/kWh \xB7 ${prices.length} uurprijzen geladen</span>`;
      }
      if (energyData.length > 0) {
        status.innerHTML = status.innerHTML.replace("</span>", "") + " \xB7 historische EPEX ophalen\u2026</span>";
        const fromISO = energyData[0].timestamp;
        const tillISO = energyData[energyData.length - 1].timestamp;
        await fetchEPEXHistory(fromISO, tillISO);
        status.innerHTML = `${ICON_CHECK2} <span>Frank: EB = \u20AC${eb.toFixed(5)}/kWh \xB7 opslag = \u20AC${avgOpslag.toFixed(4)}/kWh \xB7 ${prices.length} uurprijzen geladen \xB7 ${epexHistory.size} uurprijzen totaal</span>`;
      }
      status.style.color = "var(--accent-green)";
      runSimulation();
    } catch (err) {
      console.error("fetchTarieven:", err);
      status.innerHTML = `${ICON_WARN2} <span>Ophalen mislukt: ${err.message}</span>`;
      status.style.color = "var(--accent-orange)";
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Ophalen`;
    }
  }
  async function fetchEPEXHistory(fromISO, tillISO) {
    const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${encodeURIComponent(fromISO)}&tillDate=${encodeURIComponent(tillISO)}&interval=4&usageType=1&inclBtw=true`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`energyzero HTTP ${resp.status}`);
    const data = await resp.json();
    const newEntries = (data.Prices || []).map((p) => {
      const dt = new Date(p.readingDate);
      return [epexKey(dt), p.price];
    });
    if (newEntries.length) appStore.updateEpexHistory(newEntries);
  }
  async function autoFetchEpex() {
    if (energyData.length === 0) return;
    const before = epexHistory.size;
    try {
      await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
    } catch (err) {
      console.warn("autoFetchEpex: live EPEX niet beschikbaar, fallback actief \u2014", err.message);
      return;
    }
    if (epexHistory.size > before) runSimulation();
  }
  function initBadgeUnit(slider, badge) {
    const m = badge.textContent.trim().match(/^(\D*)(-?\d+(?:\.\d+)?)(.*)$/s);
    badge.dataset.unitPrefix = m ? m[1] : "";
    badge.dataset.unitSuffix = m ? m[3] : "";
    badge.dataset.unitDecimals = String(m && m[2].includes(".") ? m[2].split(".")[1].length : 0);
  }
  function formatBadgeValue(slider, badge) {
    if (badge.dataset.unitDecimals === void 0) initBadgeUnit(slider, badge);
    const dec = parseInt(badge.dataset.unitDecimals, 10) || 0;
    const num = parseFloat(slider.value);
    return `${badge.dataset.unitPrefix || ""}${num.toFixed(dec)}${badge.dataset.unitSuffix || ""}`;
  }
  function makeBadgeEditable(slider, badge) {
    badge.classList.add("val-editable");
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", "Waarde handmatig invoeren");
    badge.title = "Klik om de waarde te typen";
    const beginEdit = () => {
      if (badge.querySelector("input")) return;
      if (badge.dataset.unitDecimals === void 0) initBadgeUnit(slider, badge);
      const input = document.createElement("input");
      input.type = "number";
      input.className = "val-edit-input";
      input.min = slider.min;
      input.max = slider.max;
      input.step = slider.step;
      input.value = parseFloat(slider.value);
      input.setAttribute("aria-label", "Nieuwe waarde");
      badge.textContent = "";
      badge.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit) {
          let v = parseFloat(input.value);
          if (!Number.isNaN(v)) {
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            const step = parseFloat(slider.step) || 0;
            v = Math.min(max, Math.max(min, v));
            if (step > 0) v = Math.round(v / step) * step;
            slider.value = v;
          }
        }
        badge.textContent = formatBadgeValue(slider, badge);
        slider.setAttribute("aria-valuetext", badge.textContent.trim());
        if (commit) scheduleSim();
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("click", (e) => e.stopPropagation());
    };
    badge.addEventListener("click", (e) => {
      if (e.target === badge) beginEdit();
    });
    badge.addEventListener("keydown", (e) => {
      if (e.target !== badge) return;
      if ((e.key === "Enter" || e.key === " ") && !badge.querySelector("input")) {
        e.preventDefault();
        beginEdit();
      }
    });
  }
  function setSlider(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    const badge = document.getElementById(`${id}-val`);
    if (badge && !badge.querySelector("input")) {
      badge.textContent = formatBadgeValue(el, badge);
      el.setAttribute("aria-valuetext", badge.textContent.trim());
    }
  }
  function _median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  var SOLAR_MONTH_FACTOR = {
    1: 0.1,
    2: 0.2,
    3: 0.4,
    4: 0.65,
    5: 0.85,
    6: 1,
    7: 0.95,
    8: 0.85,
    9: 0.6,
    10: 0.35,
    11: 0.15,
    12: 0.08
  };
  var DAY_MS = 24 * 3600 * 1e3;
  var HOUR_MS = 3600 * 1e3;
  var GAP_SMALL_MAX_HOURS = 6;
  var _cleanedRef = null;
  function _rowTotals(r) {
    return {
      imp: (r.import_t1 || 0) + (r.import_t2 || 0),
      exp: (r.export_t1 || 0) + (r.export_t2 || 0),
      sol: r.solar_yield != null ? Number(r.solar_yield) : null
    };
  }
  function ensureCleanData() {
    if (!energyData || energyData.length < 2) {
      appStore.setState({ dataQuality: null });
      return;
    }
    if (energyData === _cleanedRef) return;
    cleanAndFillEnergyData();
    _cleanedRef = energyData;
  }
  function cleanAndFillEnergyData() {
    const byHour = /* @__PURE__ */ new Map();
    energyData.forEach((r) => {
      const t = new Date(r.timestamp).getTime();
      if (isNaN(t)) return;
      byHour.set(Math.floor(t / HOUR_MS) * HOUR_MS, r);
    });
    const keys0 = [...byHour.keys()].sort((a, b) => a - b);
    if (keys0.length < 2) {
      appStore.setState({ dataQuality: null });
      return;
    }
    const first = keys0[0], last = keys0[keys0.length - 1];
    const expectedHours = Math.round((last - first) / HOUR_MS) + 1;
    const shVals = {};
    const hVals = {};
    byHour.forEach((r, ms) => {
      const { imp, exp, sol } = _rowTotals(r);
      if (imp < 0 || exp < 0 || imp > 100 || exp > 100 || !isFinite(imp) || !isFinite(exp)) {
        byHour.delete(ms);
        return;
      }
      const d = new Date(ms), h = d.getHours(), sh = `${seasonOf(d.getMonth() + 1)}-${h}`;
      shVals[sh] ||= { imp: [], exp: [], sol: [] };
      hVals[h] ||= { imp: [], exp: [], sol: [] };
      shVals[sh].imp.push(imp);
      shVals[sh].exp.push(exp);
      hVals[h].imp.push(imp);
      hVals[h].exp.push(exp);
      if (sol != null) {
        shVals[sh].sol.push(sol);
        hVals[h].sol.push(sol);
      }
    });
    const hasSolar = Object.values(hVals).some((v) => v.sol.length > 0);
    const med = (arr) => arr && arr.length ? _median(arr) : null;
    const profileFor = (ms) => {
      const d = new Date(ms), h = d.getHours(), sh = `${seasonOf(d.getMonth() + 1)}-${h}`;
      const pick = (f) => {
        let m = med(shVals[sh]?.[f]);
        if (m == null) m = med(hVals[h]?.[f]);
        return m == null ? 0 : m;
      };
      return { imp: pick("imp"), exp: pick("exp"), sol: hasSolar ? pick("sol") : null };
    };
    const realSet = new Set(byHour.keys());
    const realHours = realSet.size;
    const gaps = [];
    let run = null;
    for (let ms = first; ms <= last; ms += HOUR_MS) {
      if (realSet.has(ms)) {
        if (run) {
          gaps.push(run);
          run = null;
        }
      } else {
        if (!run) run = { startMs: ms, endMs: ms, hours: 0 };
        run.endMs = ms;
        run.hours++;
      }
    }
    if (run) gaps.push(run);
    const mkRow = (ms, imp, exp, sol, fill) => ({
      timestamp: new Date(ms).toISOString(),
      import_t1: Math.max(0, imp),
      import_t2: 0,
      export_t1: Math.max(0, exp),
      export_t2: 0,
      solar_yield: sol,
      _fill: fill
    });
    let interpHours = 0, profileHours = 0;
    const largePeriods = [];
    gaps.forEach((g) => {
      const isLarge = g.hours > GAP_SMALL_MAX_HOURS;
      const beforeMs = g.startMs - HOUR_MS, afterMs = g.endMs + HOUR_MS;
      const before = byHour.get(beforeMs), after = byHour.get(afterMs);
      for (let ms = g.startMs; ms <= g.endMs; ms += HOUR_MS) {
        if (isLarge || !before || !after) {
          const p = profileFor(ms);
          byHour.set(ms, mkRow(ms, p.imp, p.exp, p.sol, isLarge ? "profile" : "interp"));
          isLarge ? profileHours++ : interpHours++;
        } else {
          const frac = (ms - beforeMs) / (afterMs - beforeMs);
          const b = _rowTotals(before), a = _rowTotals(after);
          const lerp = (x, y) => x + (y - x) * frac;
          const sol = b.sol != null && a.sol != null ? lerp(b.sol, a.sol) : hasSolar ? profileFor(ms).sol : null;
          byHour.set(ms, mkRow(ms, lerp(b.imp, a.imp), lerp(b.exp, a.exp), sol, "interp"));
          interpHours++;
        }
      }
      if (isLarge) largePeriods.push({ from: new Date(g.startMs).toISOString(), to: new Date(g.endMs).toISOString(), hours: g.hours });
    });
    appStore.setState({ energyData: [...byHour.keys()].sort((a, b) => a - b).map((ms) => byHour.get(ms)) });
    appStore.setState({
      dataQuality: {
        expectedHours,
        realHours,
        interpHours,
        profileHours,
        completenessPct: expectedHours > 0 ? Math.round(realHours / expectedHours * 100) : 100,
        largePeriods,
        spanFrom: new Date(first).toISOString(),
        spanTo: new Date(last).toISOString()
      },
      dataQualityDismissed: false
      // nieuwe import → samenvatting weer tonen
    });
  }
  function ensureFullYearData() {
    const prognose = document.getElementById("prognose-toggle")?.checked ?? true;
    if (energyData.length === 0) {
      appStore.setState({
        fullYearData: null,
        yearScale: 1,
        dataMeta: { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 }
      });
      return;
    }
    const stamp = `${prognose}|${energyData.length}|${energyData[0].timestamp}|${energyData[energyData.length - 1].timestamp}`;
    if (stamp === fullYearStamp) return;
    appStore.setState({ fullYearStamp: stamp });
    const firstMs = new Date(energyData[0].timestamp).getTime();
    const lastMs = new Date(energyData[energyData.length - 1].timestamp).getTime();
    const spanDays = (lastMs - firstMs) / DAY_MS;
    const realHoursTot = energyData.length;
    const daySet = /* @__PURE__ */ new Set();
    energyData.forEach((r) => daySet.add(rowMeta(r).dayKey));
    const realDays = daySet.size;
    if (spanDays >= 365 || realHoursTot >= 8760 || realDays >= 365) {
      const ys = 8760 / realHoursTot;
      appStore.setState({
        fullYearData: null,
        yearScale: ys,
        dataMeta: { mode: "full", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale: ys }
      });
      return;
    }
    if (!prognose) {
      const ys = 8760 / realHoursTot;
      appStore.setState({
        fullYearData: null,
        yearScale: ys,
        dataMeta: { mode: "linear", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale: ys }
      });
      return;
    }
    const mhAcc = {}, shAcc = {}, hAcc = {};
    const daysPerMonth = {};
    const add = (bucket, key, imp, exp, sol) => {
      const a = bucket[key] ||= { imp: 0, exp: 0, sol: 0, solN: 0, n: 0 };
      a.imp += imp;
      a.exp += exp;
      a.n++;
      if (sol != null) {
        a.sol += sol;
        a.solN++;
      }
    };
    let hasSolar = false;
    energyData.forEach((r) => {
      const { month, date, hour } = rowMeta(r);
      const t = _rowTotals(r);
      if (t.sol != null) hasSolar = true;
      (daysPerMonth[month] ||= /* @__PURE__ */ new Set()).add(date);
      add(mhAcc, `${month}-${hour}`, t.imp, t.exp, t.sol);
      add(shAcc, `${seasonOf(month)}-${hour}`, t.imp, t.exp, t.sol);
      add(hAcc, `${hour}`, t.imp, t.exp, t.sol);
    });
    const MIN_PROFILE_DAYS = 5;
    const measuredMonths = Object.keys(daysPerMonth).map(Number).filter((m) => daysPerMonth[m].size >= MIN_PROFILE_DAYS);
    const sourceMonth = {};
    for (let m = 1; m <= 12; m++) {
      if (measuredMonths.includes(m)) {
        sourceMonth[m] = m;
      } else if (measuredMonths.length === 0) {
        sourceMonth[m] = null;
      } else sourceMonth[m] = measuredMonths.reduce((best, c) => Math.abs(SOLAR_MONTH_FACTOR[c] - SOLAR_MONTH_FACTOR[m]) < Math.abs(SOLAR_MONTH_FACTOR[best] - SOLAR_MONTH_FACTOR[m]) ? c : best);
    }
    const mean = (a) => a && a.n ? { imp: a.imp / a.n, exp: a.exp / a.n, sol: a.solN ? a.sol / a.solN : 0 } : null;
    const synthProfileFor = (month, hour) => {
      const src = sourceMonth[month];
      return src != null && mean(mhAcc[`${src}-${hour}`]) || mean(shAcc[`${seasonOf(month)}-${hour}`]) || mean(hAcc[`${hour}`]) || { imp: 0, exp: 0, sol: 0 };
    };
    const realByMDH = /* @__PURE__ */ new Map();
    energyData.forEach((r) => {
      const { month, date, hour } = rowMeta(r);
      const d = month === 2 && date === 29 ? 28 : date;
      realByMDH.set(`${month}-${d}-${hour}`, r);
    });
    const year = new Date(energyData[energyData.length - 1].timestamp).getFullYear();
    const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const out = [];
    let realHours = 0, synthHours = 0;
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= DAYS_IN_MONTH[month - 1]; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const real = realByMDH.get(`${month}-${day}-${hour}`);
          if (real) {
            out.push(real);
            realHours++;
            continue;
          }
          const p = synthProfileFor(month, hour);
          const mm = String(month).padStart(2, "0");
          const dd = String(day).padStart(2, "0");
          const hh = String(hour).padStart(2, "0");
          out.push({
            timestamp: `${year}-${mm}-${dd}T${hh}:00:00`,
            // lokaal-naïef → getHours() klopt
            import_t1: Math.max(0, p.imp),
            import_t2: 0,
            export_t1: Math.max(0, p.exp),
            export_t2: 0,
            solar_yield: hasSolar ? p.sol : null,
            _synth: true
          });
          synthHours++;
        }
      }
    }
    const synthPct = realHours + synthHours > 0 ? synthHours / (realHours + synthHours) : 0;
    appStore.setState({
      fullYearData: out,
      yearScale: 1,
      dataMeta: { mode: "seasonal", synthesized: true, realDays, realHours, synthHours, synthPct, yearScale: 1 }
    });
  }
  function computeBillForConfig(cfg) {
    return _simulateCore(cfg, false);
  }
  function readSimConfig() {
    const isSimple = document.body && document.body.classList && typeof document.body.classList.contains === "function" ? document.body.classList.contains("mode-simple") : true;
    return {
      // Fiscaal scenariojaar (2026 = saldering · 2027 = bruto-EB, geen saldering).
      // Default 2027 zodat ontbrekende selector het bestaande gedrag behoudt.
      fiscalYear: parseInt(document.getElementById("scenario-year")?.value, 10) || 2027,
      fixedPeakRate: parseFloat(document.getElementById("fixed-peak").value),
      fixedDalRate: parseFloat(document.getElementById("fixed-dal").value),
      fixedFeedInRate: parseFloat(document.getElementById("fixed-feedin-rate").value),
      fixedVastrecht: parseFloat(document.getElementById("fixed-vastrecht").value),
      fixedFeedInFee: parseFloat(document.getElementById("fixed-feedin-fee")?.value) || 0,
      dynamicMarkup: parseFloat(document.getElementById("dynamic-markup").value),
      dynamicExportMarkup: parseFloat(document.getElementById("dynamic-export-markup")?.value || 0),
      dynamicVastrecht: parseFloat(document.getElementById("dynamic-vastrecht").value),
      stressMultiplier: isSimple ? 1 : parseFloat(document.getElementById("stress-multiplier")?.value) || 1,
      solarDimmingMode: isSimple ? "do_nothing" : document.getElementById("solar-dimming-mode")?.value || "do_nothing",
      hasHeatPump: isSimple ? false : document.getElementById("has-heatpump").checked,
      hpWinterBaseload: parseFloat(document.getElementById("hp-baseload").value),
      hasEv: isSimple ? false : document.getElementById("has-ev").checked,
      evWeeklyDist: parseFloat(document.getElementById("ev-dist").value),
      evConsumption: parseFloat(document.getElementById("ev-cons").value) / 100,
      evSolarMatch: document.getElementById("ev-solar-match").checked,
      evProfile: document.getElementById("ev-profile")?.value || "home",
      hasBattery: isSimple ? false : document.getElementById("has-battery").checked,
      batCapacity: parseFloat(document.getElementById("bat-cap").value),
      batPower: parseFloat(document.getElementById("bat-power").value),
      batEfficiency: parseFloat(document.getElementById("bat-eff").value) / 100,
      batMode: document.getElementById("bat-mode")?.value || "zelf",
      batCost: parseFloat(document.getElementById("bat-cost")?.value || 450)
    };
  }
  function downloadDataWithPrices() {
    if (!energyData || energyData.length === 0) {
      alert("Er is nog geen data geladen om te downloaden. Upload eerst je P1-data of koppel Home Assistant.");
      return;
    }
    const cfg = readSimConfig();
    const eb = liveEnergyTax2;
    const markupBtw = cfg.dynamicMarkup;
    const exportMarkup = cfg.dynamicExportMarkup ?? 0;
    const header = [
      "tijdstip",
      "afname_kWh",
      "teruglevering_kWh",
      "opwek_kWh",
      "epex_spot_eur_per_kWh_incl_btw",
      "prijs_bron",
      "dynamisch_allin_eur_per_kWh",
      "dynamisch_netto_kosten_eur",
      "vast_tarief_eur_per_kWh",
      "vast_netto_kosten_eur"
    ];
    const lines = [header.join(";")];
    energyData.forEach((r) => {
      const { hour, month, dow, epexKey: key } = rowMeta(r);
      const imp = (r.import_t1 || 0) + (r.import_t2 || 0);
      const exp = (r.export_t1 || 0) + (r.export_t2 || 0);
      const sol = r.solar_yield != null ? Number(r.solar_yield) : null;
      const real = epexHistory.has(key);
      const spot = real ? epexHistory.get(key) : getFallbackSpot2(month, hour);
      const allIn = spot + markupBtw + eb;
      const dynCost = imp * allIn - exp * (spot / 1.21 - exportMarkup);
      const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
      const tariff = isPeak ? cfg.fixedPeakRate : cfg.fixedDalRate;
      const vastCost = imp * tariff - exp * cfg.fixedFeedInRate + exp * cfg.fixedFeedInFee;
      lines.push([
        r.timestamp,
        imp.toFixed(4),
        exp.toFixed(4),
        sol == null ? "" : sol.toFixed(4),
        spot.toFixed(5),
        real ? "echt" : "geschat",
        allIn.toFixed(5),
        dynCost.toFixed(5),
        tariff.toFixed(4),
        vastCost.toFixed(5)
      ].join(";"));
    });
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const from = energyData[0].timestamp.slice(0, 10);
    const till = energyData[energyData.length - 1].timestamp.slice(0, 10);
    a.href = url;
    a.download = `energie-data-met-epex-prijzen_${from}_tot_${till}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  var BATTERY_SWEEP_CAPS = [2, 5, 10, 15, 20];
  var BATTERY_LIFETIME_YEARS = 15;
  var BATTERY_DEGRADATION_PER_YEAR = 0.02;
  var BATTERY_AVG_CAPACITY_FACTOR = 1 - BATTERY_DEGRADATION_PER_YEAR * BATTERY_LIFETIME_YEARS / 2;
  function optimizeBatterySize(_skipPrep = false) {
    const resEl = document.getElementById("battery-optimization-result");
    if (!resEl) return;
    if (energyData.length === 0) {
      resEl.style.display = "";
      resEl.innerHTML = "Laad eerst data om de optimale accu te berekenen.";
      return;
    }
    if (!_skipPrep) {
      const ebEl = document.getElementById("energy-tax");
      if (ebEl) appStore.setState({ liveEnergyTax: parseFloat(ebEl.value) });
      ensureFullYearData();
    }
    const baseCfg = readSimConfig();
    const noBat = computeBillForConfig({ ...baseCfg, hasBattery: false });
    const baselineFix = noBat.fixedBill;
    const baselineDyn = noBat.dynBill;
    const rows = BATTERY_SWEEP_CAPS.map((cap) => {
      const r = computeBillForConfig({
        ...baseCfg,
        hasBattery: true,
        batCapacity: cap,
        batPower: cap * 0.5,
        // gulden-ratio: 0,5C laad/ontlaadvermogen
        batEfficiency: baseCfg.batEfficiency,
        // UI-instelling
        batMode: baseCfg.batMode
        // UI-instelling
      });
      const extra = baselineDyn - r.dynBill;
      const extraFix = baselineFix - r.fixedBill;
      const cost = cap * baseCfg.batCost;
      const effExtra = extra * BATTERY_AVG_CAPACITY_FACTOR;
      const effExtraFix = extraFix * BATTERY_AVG_CAPACITY_FACTOR;
      const payback = effExtra > 0 ? cost / effExtra : Infinity;
      const paybackFix = effExtraFix > 0 ? cost / effExtraFix : Infinity;
      return { cap, power: cap * 0.5, dynBill: r.dynBill, fixedBill: r.fixedBill, extra, extraFix, cost, payback, paybackFix };
    });
    window.lastOptResults = { rows, noBat };
    const currentType = window.optContractType || "dyn";
    renderBatteryOptimization(rows, currentType, resEl);
  }
  function renderBatteryOptimization(rows, type, resEl) {
    const eur = (v) => (v >= 0 ? "" : "\u2212") + "\u20AC" + Math.abs(v).toFixed(0);
    const eurKwh = (v) => (v >= 0 ? "" : "\u2212") + "\u20AC" + Math.abs(v).toFixed(2);
    const yrs = (p) => Number.isFinite(p) ? `${p.toFixed(1)} jr` : "\u2014";
    const costEl = document.getElementById("bat-cost");
    const currentCostPerKwh = costEl ? parseFloat(costEl.value) : 450;
    let sweetIdx = -1, bestPayback = Infinity;
    rows.forEach((r, i) => {
      const pb = type === "dyn" ? r.payback : r.paybackFix;
      if (pb < bestPayback) {
        bestPayback = pb;
        sweetIdx = i;
      }
    });
    if (sweetIdx === -1) {
      rows.forEach((r, i) => {
        const extraVal = type === "dyn" ? r.extra : r.extraFix;
        const sweetExtraVal = sweetIdx === -1 ? 0 : type === "dyn" ? rows[sweetIdx].extra : rows[sweetIdx].extraFix;
        if (sweetIdx === -1 || extraVal > sweetExtraVal) sweetIdx = i;
      });
    }
    const body = rows.map((r, i) => {
      const sweet2 = i === sweetIdx;
      const bg = sweet2 ? "background:rgba(56,239,125,0.14);" : "";
      const star = sweet2 ? ` ${ICON_STAR}` : "";
      const extraVal = type === "dyn" ? r.extra : r.extraFix;
      const paybackVal = type === "dyn" ? r.payback : r.paybackFix;
      const perKwh = r.cap > 0 ? extraVal / r.cap : 0;
      return `<tr style="${bg}">
      <td style="padding:0.25rem 0.4rem;">${r.cap} kWh${star}</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${r.power.toFixed(1)} kW</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;color:var(--accent-green);">${eur(extraVal)}/jr <span style="font-size:0.65rem;color:var(--text-muted);">(${eurKwh(perKwh)}/kWh)</span></td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${yrs(paybackVal)}</td>
    </tr>`;
    }).join("");
    const sweet = rows[sweetIdx];
    const sweetPayback = sweet ? type === "dyn" ? sweet.payback : sweet.paybackFix : Infinity;
    const sweetExtra = sweet ? type === "dyn" ? sweet.extra : sweet.extraFix : 0;
    const contractLabel = type === "dyn" ? "dynamisch" : "vast";
    const beyondLife = Number.isFinite(sweetPayback) && sweetPayback > BATTERY_LIFETIME_YEARS;
    const verdict = sweet && Number.isFinite(sweetPayback) ? `<strong style="color:var(--accent-green);">Sweet spot: ${sweet.cap} kWh</strong> \u2014 accu-meerwaarde ${eur(sweetExtra)}/jaar, terugverdiend in ${yrs(sweetPayback)} (bij \u20AC${currentCostPerKwh}/kWh).` + (beyondLife ? ` <span style="color:var(--accent-orange);">${ICON_WARN2} Dat is l\xE1nger dan de verwachte levensduur (~${BATTERY_LIFETIME_YEARS} jr) \u2014 de accu verdient zichzelf binnen z'n leven waarschijnlijk niet terug.</span>` : "") : `Binnen dit scenario verdient geen enkele accu zichzelf terug op een ${contractLabel} contract (meerwaarde \u2264 \u20AC0/jaar).`;
    const tabDynActive = type === "dyn" ? "active" : "";
    const tabFixActive = type === "fix" ? "active" : "";
    resEl.style.display = "";
    resEl.innerHTML = `
    <div style="display:flex; justify-content:center; gap:0.5rem; margin-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.6rem;">
      <button type="button" class="btn-toggle ${tabDynActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" data-opt-contract="dyn">Dynamisch contract</button>
      <button type="button" class="btn-toggle ${tabFixActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" data-opt-contract="fix">Vast contract</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead><tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.12);">
        <th style="padding:0.25rem 0.4rem;text-align:left;">Accu</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Vermogen</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Meerwaarde / kWh</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Terugverdientijd</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div style="margin-top: 0.6rem; font-size: 0.72rem; line-height: 1.5; color: var(--text-main); margin-bottom:0.5rem;">
      ${verdict}
    </div>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.45rem;line-height:1.45;">
      ${ICON_LIGHTBULB} <strong>Let op:</strong> De besparingen worden berekend ten opzichte van dezelfde opstelling z\xF3nder thuisbatterij.
      ${type === "dyn" ? "Bij een <strong>dynamisch contract</strong> laadt de batterij op bij zonnestroom en bij goedkope uren van het net, en levert/ontlaadt bij dure uren." : "Bij een <strong>vast contract</strong> doet de batterij uitsluitend aan zelfconsumptie (zonne-overschot opslaan en 's avonds/nachts gebruiken)."}
    </p>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.45;">
      Investering \u20AC${currentCostPerKwh}/kWh (indicatief). Vermogen = 0,5\xD7 capaciteit.
      Terugverdientijd is gecorrigeerd voor ~${(BATTERY_DEGRADATION_PER_YEAR * 100).toFixed(0)}%/jaar degradatie
      (gemiddeld ~${(BATTERY_AVG_CAPACITY_FACTOR * 100).toFixed(0)}% capaciteit over ${BATTERY_LIFETIME_YEARS} jaar).
    </p>`;
    resEl.querySelectorAll("[data-opt-contract]").forEach((btn) => {
      btn.addEventListener("click", () => window.setOptContract(btn.getAttribute("data-opt-contract")));
    });
  }
  window.setOptContract = function(type) {
    window.optContractType = type;
    if (window.lastOptResults && window.lastOptResults.rows) {
      const resEl = document.getElementById("battery-optimization-result");
      renderBatteryOptimization(window.lastOptResults.rows, type, resEl);
    }
  };
  function runSimulation() {
    if (energyData.length === 0) return;
    const ebEl = document.getElementById("energy-tax");
    if (ebEl) appStore.setState({ liveEnergyTax: parseFloat(ebEl.value) });
    ensureCleanData();
    ensureFullYearData();
    buildCalibratedProfile();
    const cfg = readSimConfig();
    const ctx = buildSimContext();
    const sim = _simulateCore(cfg, true, ctx);
    const base0 = {
      ...cfg,
      hasHeatPump: false,
      hpWinterBaseload: 0,
      hasEv: false,
      evWeeklyDist: 0,
      evConsumption: 0,
      evSolarMatch: false,
      hasBattery: false,
      batCapacity: 0,
      batPower: 0,
      batEfficiency: 1,
      batMode: "zelf"
    };
    const base = _simulateCore(base0, false, ctx);
    const withHp = _simulateCore({ ...base0, hasHeatPump: true, hpWinterBaseload: cfg.hpWinterBaseload }, false, ctx);
    const withEv = _simulateCore({ ...base0, hasEv: true, evWeeklyDist: cfg.evWeeklyDist, evConsumption: cfg.evConsumption, evSolarMatch: cfg.evSolarMatch }, false, ctx);
    const withBat = _simulateCore({ ...base0, hasBattery: true, batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency, batMode: cfg.batMode }, false, ctx);
    const totalSolarKwh = ctx.simData.reduce((s, r) => s + (r.solar_yield || 0), 0) * ctx.yearScale;
    const hasSolarData = totalSolarKwh > 0;
    const noSolar = hasSolarData ? _simulateCore({ ...base0, noSolar: true, solarDimmingMode: "do_nothing" }, false, ctx) : null;
    appStore.setState({ activeSimulation: {
      ...sim,
      cfg,
      hwEffects: {
        base,
        hp: { fixed: withHp.fixedBill - base.fixedBill, dyn: withHp.dynBill - base.dynBill, enabled: cfg.hasHeatPump, cfg: { hpWinterBaseload: cfg.hpWinterBaseload } },
        ev: { fixed: withEv.fixedBill - base.fixedBill, dyn: withEv.dynBill - base.dynBill, enabled: cfg.hasEv, cfg: { evDist: cfg.evWeeklyDist, evCons: cfg.evConsumption, evSolar: cfg.evSolarMatch } },
        bat: { fixed: withBat.fixedBill - base.fixedBill, dyn: withBat.dynBill - base.dynBill, enabled: cfg.hasBattery, cfg: { batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency * 100, batMode: cfg.batMode } },
        sol: {
          fixed: hasSolarData ? base.fixedBill - noSolar.fixedBill : 0,
          dyn: hasSolarData ? base.dynBill - noSolar.dynBill : 0,
          enabled: hasSolarData,
          cfg: { solarKwh: Math.round(totalSolarKwh) }
        }
      }
    } });
    const pct = sim.epexPct;
    const taxEl = document.getElementById("tbl-dyn-tax-vol");
    if (taxEl) {
      taxEl.title = pct === 100 ? "100% echte EPEX uurprijzen" : pct > 0 ? `${pct}% echte EPEX, ${100 - pct}% seizoensprofiel` : "Geen echte EPEX \u2014 klik 'Ophalen' voor actuele tarieven";
    }
    updateUIElements();
    renderChart();
    renderOverviewChart();
    renderMonthlyChart();
    renderSimChart();
    renderHwChart();
    renderDynPriceExample();
    renderDataQualityBanner();
    const resEl = document.getElementById("battery-optimization-result");
    if (resEl && resEl.style.display !== "none") {
      scheduleOptimize();
    }
  }
  function renderDataQualityBanner() {
    const el = document.getElementById("data-quality-banner");
    if (!el) return;
    const q = dataQuality;
    const worthShowing = q && (q.profileHours > 0 || q.interpHours > 2);
    if (!worthShowing || dataQualityDismissed) {
      el.style.display = "none";
      return;
    }
    const fmtDays = (h) => {
      const d = h / 24;
      return d >= 1 ? `${d.toFixed(d % 1 === 0 ? 0 : 1)} dag${d >= 2 ? "en" : ""}` : `${h} uur`;
    };
    let parts = [];
    if (q.profileHours > 0) {
      const n = q.largePeriods.length;
      parts.push(`<strong>${n} langere periode${n > 1 ? "s" : ""}</strong> (samen ${fmtDays(q.profileHours)}) ${n > 1 ? "ontbraken" : "ontbrak"} \u2014 ingevuld met je eigen standaardprofiel (mediaan dagverloop per seizoen)`);
    }
    if (q.interpHours > 0) {
      parts.push(`${q.interpHours} kort${q.interpHours > 1 ? "e gaten" : " gat"} bijgeschat`);
    }
    el.style.display = "";
    el.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="margin-right:0.25rem;"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg> <strong>Data gecontroleerd:</strong> ${q.realHours.toLocaleString("nl-NL")} van ${q.expectedHours.toLocaleString("nl-NL")} uren waren echte metingen (${q.completenessPct}%). ` + parts.join("; ") + `. <span style="opacity:0.85;">De ingevulde periodes tellen mee als gemiddeld gebruik, niet als gemeten data.</span><button type="button" class="dismiss-x" data-dismiss="data-quality-banner" title="Verberg deze melding">\xD7</button>`;
  }
  function renderDynPriceExample() {
    const box = document.getElementById("dynprice-example");
    if (!box) return;
    const markup = activeSimulation2?.cfg?.dynamicMarkup ?? parseFloat(document.getElementById("dynamic-markup")?.value) ?? 0.024;
    const eb = liveEnergyTax2;
    let spot = null;
    const hp = activeSimulation2?.hourlyProfile;
    if (hp && hp[18]?.spots?.length) {
      const s = [...hp[18].spots].sort((a, b) => a - b);
      spot = s[Math.floor(s.length / 2)];
    }
    if (spot == null) spot = getFallbackSpot2(1, 18);
    const allIn = spot + markup + eb;
    const pct = activeSimulation2?.epexPct ?? 0;
    const bron = pct === 100 ? "echte EPEX" : pct > 0 ? `${pct}% echte EPEX` : "geschatte prijs";
    const part = (val, lbl) => `<span>\u20AC${val.toFixed(3)}</span> <span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);">${lbl}</span>`;
    box.innerHTML = `${part(spot, "EPEX (incl. btw)")} + ${part(markup, "opslag (incl. btw)")} + ${part(eb, "EB")} = <span style="color:var(--accent-cyan);font-weight:700;">\u20AC${allIn.toFixed(3)}/kWh</span><span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);"> &nbsp;(voorbeeld 18:00 \xB7 ${bron})</span>`;
  }
  function updateUIElements() {
    const sim = activeSimulation2;
    setChartsDependencies({
      activeSimulation: activeSimulation2,
      fullYearData,
      energyData,
      dataMeta
    });
    const badge = document.getElementById("prognosis-badge");
    const extrapolated = dataMeta.mode === "seasonal" || dataMeta.mode === "linear";
    if (badge && prognosisDismissed) {
      badge.style.display = "none";
    } else if (badge) {
      const setBadgeTone = (orange) => {
        badge.style.background = orange ? "rgba(255,165,0,0.12)" : "rgba(56,189,248,0.10)";
        badge.style.borderColor = orange ? "rgba(255,165,0,0.35)" : "rgba(56,189,248,0.30)";
        badge.style.color = orange ? "var(--accent-orange)" : "var(--accent-cyan)";
      };
      if (dataMeta.mode === "seasonal") {
        badge.style.display = "";
        const pct = Math.round((dataMeta.synthPct || 0) * 100);
        const prominent = (dataMeta.synthPct || 0) > 0.4;
        setBadgeTone(prominent);
        document.getElementById("prognosis-text").innerHTML = prominent ? `je hebt maar <strong>${dataMeta.realDays} dagen</strong> data, dus <strong>~${pct}% van het jaar is geschat</strong>. Ongemeten maanden zijn ingevuld met je eigen typische dag van de maand met gelijke daglengte (bijv. augustus \u2248 april). <strong>Meer maanden meten maakt de schatting flink nauwkeuriger.</strong>` : `${dataMeta.realDays} dagen eigen data aangevuld tot een volledig jaar (${pct}% geschat) via je eigen typische dag per maand.`;
      } else if (dataMeta.mode === "linear") {
        badge.style.display = "";
        setBadgeTone(false);
        document.getElementById("prognosis-text").innerHTML = `${dataMeta.realDays} dagen eigen data <strong>lineair</strong> doorgerekend naar een jaar (\xD7${dataMeta.yearScale.toFixed(1)}, g\xE9\xE9n seizoenscorrectie). Zet <em>Jaarprognose</em> aan voor een seizoensgewogen schatting.`;
      } else {
        badge.style.display = "none";
      }
    }
    const synthTag = extrapolated ? ` <span style="color:var(--accent-cyan);font-size:0.7rem;" title="Ge\xEBxtrapoleerd naar jaarbasis">\xB7 prognose</span>` : "";
    const savings = sim.totalSavings;
    const positive = savings >= 0;
    const col = positive ? "var(--accent-green)" : "var(--accent-orange)";
    document.getElementById("stat-savings-val").textContent = `${Math.abs(savings).toFixed(2)}`;
    document.getElementById("stat-savings-pct").textContent = `${Math.abs(sim.savingsPct).toFixed(1)}%`;
    document.getElementById("stat-savings-value").style.color = col;
    document.getElementById("stat-savings-pct").style.color = col;
    document.getElementById("stat-savings-card").classList.toggle("negative", !positive);
    document.getElementById("stat-savings-text").textContent = positive ? "Besparing per jaar" : "Extra kosten per jaar";
    const subEl = document.getElementById("stat-savings-sub");
    subEl.textContent = positive ? "\u25B2 in het voordeel van dynamisch" : "\u25BC vast contract is goedkoper";
    subEl.style.color = col;
    const demoNotice = document.getElementById("demo-notice");
    if (demoNotice) demoNotice.style.display = isDemoData ? "" : "none";
    document.getElementById("stat-fixed-val").textContent = `${sim.fixedTotalBill.toFixed(2)}`;
    document.getElementById("stat-dynamic-val").textContent = `${sim.dynamicTotalBill.toFixed(2)}`;
    const salderen = !!sim.salderen;
    const fixedPeakRate = sim.cfg?.fixedPeakRate ?? parseFloat(document.getElementById("fixed-peak").value);
    const fixedDalRate = sim.cfg?.fixedDalRate ?? parseFloat(document.getElementById("fixed-dal").value);
    const feedRate = sim.cfg?.fixedFeedInRate ?? parseFloat(document.getElementById("fixed-feedin-rate").value);
    const setLbl = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    if (salderen) {
      setLbl("tbl-fixed-peak-label", "Gesaldeerde afname (piek+dal)");
      document.getElementById("tbl-fixed-peak-imp").innerHTML = `${(sim.fixedNetImportKwh ?? 0).toFixed(1)} kWh \xD7 \u20AC${(sim.fixedSalderTariff ?? 0).toFixed(3)} (gewogen)${synthTag}`;
      document.getElementById("tbl-fixed-peak-cost").textContent = `\u20AC ${sim.fixedImportCost.toFixed(2)}`;
      setLbl("tbl-fixed-dal-label", "Weggestreept (saldering)");
      document.getElementById("tbl-fixed-dal-imp").textContent = `${(sim.fixedSalderedKwh ?? 0).toFixed(1)} kWh teruglevering \u2194 afname`;
      document.getElementById("tbl-fixed-dal-cost").textContent = `\u20AC 0.00`;
      setLbl("tbl-fixed-exp-label", "Overschot-teruglevering (vergoeding)");
      document.getElementById("tbl-fixed-exp").textContent = `${(sim.fixedSurplusExportKwh ?? 0).toFixed(1)} kWh \xD7 \u20AC${feedRate.toFixed(3)}`;
    } else {
      const peakImpCost = sim.fixedPeakImport * fixedPeakRate;
      const dalImpCost = sim.fixedDalImport * fixedDalRate;
      const totalFixedExp = sim.fixedPeakExport + sim.fixedDalExport;
      setLbl("tbl-fixed-peak-label", "Piekafname");
      document.getElementById("tbl-fixed-peak-imp").innerHTML = `${sim.fixedPeakImport.toFixed(1)} kWh \xD7 \u20AC${fixedPeakRate.toFixed(2)}${synthTag}`;
      document.getElementById("tbl-fixed-peak-cost").textContent = `\u20AC ${peakImpCost.toFixed(2)}`;
      setLbl("tbl-fixed-dal-label", "Dalafname");
      document.getElementById("tbl-fixed-dal-imp").textContent = `${sim.fixedDalImport.toFixed(1)} kWh \xD7 \u20AC${fixedDalRate.toFixed(2)}`;
      document.getElementById("tbl-fixed-dal-cost").textContent = `\u20AC ${dalImpCost.toFixed(2)}`;
      setLbl("tbl-fixed-exp-label", "Teruglevering (vergoeding)");
      document.getElementById("tbl-fixed-exp").textContent = `${totalFixedExp.toFixed(1)} kWh \xD7 \u20AC${feedRate.toFixed(3)}`;
    }
    document.getElementById("tbl-fixed-feedin-credit").textContent = `\u2212 \u20AC ${sim.fixedFeedInCredit.toFixed(2)}`;
    document.getElementById("tbl-fixed-vtk-cost").textContent = `\u20AC ${sim.fixedFeedInFee.toFixed(2)}`;
    const fixedNetCost = sim.fixedImportCost - sim.fixedFeedInCredit + sim.fixedFeedInFee;
    document.getElementById("tbl-fixed-net-energy").textContent = `\u20AC ${fixedNetCost.toFixed(2)}`;
    const fixedVasteLasten = sim.fixedSubscription - (sim.taxRebate ?? 0) + (sim.gridFees ?? 0);
    document.getElementById("tbl-fixed-vaste-lasten").textContent = `\u20AC ${fixedVasteLasten.toFixed(2)}`;
    document.getElementById("tbl-fixed-subcost").textContent = `\u20AC ${sim.fixedSubscription.toFixed(2)}`;
    document.getElementById("tbl-fixed-rebate").textContent = `\u2212 \u20AC ${(sim.taxRebate ?? 0).toFixed(2)}`;
    document.getElementById("tbl-fixed-grid-fees").textContent = `\u20AC ${(sim.gridFees ?? 0).toFixed(2)}`;
    document.getElementById("tbl-fixed-total").textContent = `\u20AC ${sim.fixedTotalBill.toFixed(2)}`;
    const dynNetCost = sim.dynamicRawImportCost - sim.dynamicRawExportRevenue + sim.dynamicNetTax;
    document.getElementById("tbl-dyn-net-cost-header").textContent = `\u20AC ${dynNetCost.toFixed(2)}`;
    document.getElementById("tbl-dyn-imp-kwh").innerHTML = `${sim.totalImportKwh.toFixed(1)} kWh${synthTag}`;
    document.getElementById("tbl-dyn-raw-imp").textContent = `\u20AC ${sim.dynamicRawImportCost.toFixed(2)}`;
    document.getElementById("tbl-dyn-exp-kwh").textContent = `${sim.totalExportKwh.toFixed(1)} kWh`;
    const expRev = sim.dynamicRawExportRevenue;
    const expEl = document.getElementById("tbl-dyn-raw-exp");
    if (expRev >= 0) {
      expEl.textContent = `\u2212 \u20AC ${expRev.toFixed(2)}`;
    } else {
      expEl.innerHTML = `+ \u20AC ${Math.abs(expRev).toFixed(2)} <svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-left:0.35rem;vertical-align:-0.12em;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }
    expEl.style.color = expRev >= 0 ? "var(--accent-green)" : "var(--accent-orange)";
    expEl.title = expRev < 0 ? "Negatief: export tijdens uren met negatieve EPEX-prijs kost geld" : "";
    document.getElementById("tbl-dyn-net-kwh").textContent = `${sim.netDynamicKwh.toFixed(1)} kWh`;
    document.getElementById("tbl-dyn-net-cost").textContent = `\u20AC ${dynNetCost.toFixed(2)}`;
    const dynVasteLasten = sim.dynamicSubscription - (sim.taxRebate ?? 0) + (sim.gridFees ?? 0);
    document.getElementById("tbl-dyn-vaste-lasten").textContent = `\u20AC ${dynVasteLasten.toFixed(2)}`;
    const ebVol = sim.dynamicTaxableKwh ?? sim.totalImportKwh;
    setLbl("tbl-dyn-tax-note", salderen ? "(netto afname na saldering)" : "(bruto afname)");
    setLbl("tbl-dyn-exp-label", salderen ? "Teruglevering (gesaldeerde waarde)" : "Teruglevering (EPEX spotprijs)");
    document.getElementById("tbl-dyn-tax-vol").textContent = `${ebVol.toFixed(1)} kWh \xD7 \u20AC${liveEnergyTax2.toFixed(5)}`;
    document.getElementById("tbl-dyn-tax").textContent = `\u20AC ${sim.dynamicNetTax.toFixed(2)}`;
    document.getElementById("tbl-dyn-subcost").textContent = `\u20AC ${sim.dynamicSubscription.toFixed(2)}`;
    document.getElementById("tbl-dyn-rebate").textContent = `\u2212 \u20AC ${(sim.taxRebate ?? 0).toFixed(2)}`;
    document.getElementById("tbl-dyn-grid-fees").textContent = `\u20AC ${(sim.gridFees ?? 0).toFixed(2)}`;
    document.getElementById("tbl-dyn-total").textContent = `\u20AC ${sim.dynamicTotalBill.toFixed(2)}`;
    const setHtml = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };
    setLbl("tooltip-feedin-rate", salderen ? "De vaste vergoeding voor teruglevering boven de salderingsgrens (overschot-export). Het saldeerbare deel wordt verrekend tegen het volle retail-tarief. Typisch \u20AC0,04\u2013\u20AC0,05/kWh." : "De vaste vergoeding die je ontvangt per teruggeleverde kWh. Geen saldering meer \u2014 dit is het enige wat je terugkrijgt voor zonne-energie. Typisch \u20AC0,04\u2013\u20AC0,05/kWh in 2027.");
    setLbl("tooltip-feedin-fee", salderen ? "Leveranciers rekenen VTK in 2026 al over \xE1lle teruggeleverde kWh \u2014 ook het saldeerbare deel. Hierdoor kost terugleveren je netto geld per kWh. Typisch \u20AC0,01\u2013\u20AC0,045/kWh (standaard: geen VTK)." : "Veel leveranciers rekenen per 2027 een VTK (Vaste Terugleverkosten) per teruggeleverde kWh \u2014 bovenop het netwerk. Hierdoor kost terugleveren jou geld per kWh in plaats van dat je er voor wordt betaald. Typisch \u20AC0,01\u2013\u20AC0,045/kWh (standaard: geen VTK).");
    setHtml("tooltip-dyn-badge", salderen ? "Berekening voor een <strong>dynamisch contract</strong>: de prijs volgt elk uur de stroombeurs (EPEX). Saldeerbare teruglevering wordt verrekend tegen de all-in import-prijs; energiebelasting over je netto afname." : "Berekening voor een <strong>dynamisch contract</strong>: de prijs volgt elk uur de stroombeurs (EPEX). Teruglevering wordt vergoed tegen de spotprijs van dat uur, energiebelasting over je bruto afname.");
    setHtml("dynprice-li-feedin", salderen ? "<strong>Teruglevering (saldeerbaar deel)</strong> wordt verrekend tegen de all-in import-prijs van dat uur (incl. energiebelasting + BTW). Overschot boven de salderingsgrens krijgt de kale EPEX-prijs minus teruglever-opslag." : "<strong>Teruglevering</strong> wordt vergoed tegen de kale EPEX-prijs van dat uur (zonder energiebelasting), minus de teruglever-opslag van je leverancier. Bij een negatieve prijs betaal je juist bij om terug te leveren.");
    setHtml("dynprice-li-eb", salderen ? "<strong>Energiebelasting (2026):</strong> je betaalt EB alleen over je netto afname (import minus saldeerbare export). Zolang je evenveel exporteert als importeert, is de EB op het gesaldeerde deel nul." : "<strong>Energiebelasting (2027):</strong> sinds het einde van de saldering betaal je deze over \xE1lle afgenomen kWh \u2014 je teruglevering wordt er niet meer van afgetrokken.");
  }
  window.addEventListener("resize", scheduleResize);
  function setSimMode(mode) {
    appStore.setState({ simMode: mode });
    appStore.setState({ simDrillDay: null });
    document.getElementById("sim-btn-day").className = mode === "day" ? "btn-primary" : "btn-secondary";
    document.getElementById("sim-btn-week").className = mode === "week" ? "btn-primary" : "btn-secondary";
    document.getElementById("sim-btn-day").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
    document.getElementById("sim-btn-week").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
    renderSimChart();
  }
  function setOverviewMode(mode) {
    appStore.setState({ overviewMode: mode });
    ["day", "week", "month"].forEach((m) => {
      const btn = document.getElementById(`ov-btn-${m}`);
      if (btn) btn.classList.toggle("active", m === mode);
    });
    renderOverviewChart();
  }
  function setOverviewMetric(metric) {
    appStore.setState({ overviewMetric: metric });
    ["energy", "cost", "savings"].forEach((m) => {
      const btn = document.getElementById(`ov-btn-${m}`);
      if (btn) btn.classList.toggle("active", m === metric);
    });
    renderOverviewChart();
  }
  function setOverviewViewType(type) {
    appStore.setState({ activeViewType: type });
    const btnBars = document.getElementById("ov-btn-view-bars");
    const btnSankey = document.getElementById("ov-btn-view-sankey");
    if (btnBars) btnBars.classList.toggle("active", type === "bars");
    if (btnSankey) btnSankey.classList.toggle("active", type === "sankey");
    const barControls = document.getElementById("bar-controls-row");
    const sankeyControls = document.getElementById("sankey-controls-row");
    const legends = document.getElementById("overview-legends");
    if (type === "bars") {
      if (barControls) barControls.style.display = "flex";
      if (sankeyControls) sankeyControls.style.display = "none";
      if (legends) legends.style.display = "flex";
      renderOverviewChart();
    } else {
      if (barControls) barControls.style.display = "none";
      if (sankeyControls) sankeyControls.style.display = "flex";
      if (legends) legends.style.display = "none";
      initSankeyPickers();
      renderSankeyDiagram();
    }
  }
  function setSankeyInterval(interval) {
    appStore.setState({ sankeyInterval: interval });
    ["year", "month", "week", "day"].forEach((i) => {
      const btn = document.getElementById(`sk-btn-${i}`);
      if (btn) btn.classList.toggle("active", i === interval);
    });
    const periods = getUniqueSankeyPeriods();
    if (interval === "month") sankeyValue2 = periods.months[0] || "";
    else if (interval === "week") sankeyValue2 = periods.weeks[0] || "";
    else if (interval === "day") sankeyValue2 = periods.days[0] || "";
    else sankeyValue2 = "";
    initSankeyPickers();
    renderSankeyDiagram();
  }
  function setSankeyValue(val) {
    appStore.setState({ sankeyValue: val });
    renderSankeyDiagram();
  }
  function getUniqueSankeyPeriods() {
    const months = /* @__PURE__ */ new Set();
    const weeks = /* @__PURE__ */ new Set();
    const days = [];
    if (energyData && energyData.length > 0) {
      energyData.forEach((row) => {
        const dayKey = row.timestamp.slice(0, 10);
        months.add(dayKey.slice(0, 7));
        weeks.add(isoWeek(dayKey));
        if (days.length === 0 || days[days.length - 1] !== dayKey) {
          days.push(dayKey);
        }
      });
    }
    return {
      months: Array.from(months).sort(),
      weeks: Array.from(weeks).sort(),
      days: days.sort()
    };
  }
  function initSankeyPickers() {
    const container = document.getElementById("sk-picker-container");
    if (!container) return;
    container.innerHTML = "";
    const periods = getUniqueSankeyPeriods();
    const prevBtn = document.getElementById("sk-nav-prev");
    const nextBtn = document.getElementById("sk-nav-next");
    if (sankeyInterval2 === "year") {
      container.innerHTML = `<span style="font-size:0.75rem; color:var(--text-main); font-weight:bold; padding:0.25rem 0.5rem;">Hele Jaar</span>`;
      appStore.setState({ sankeyValue: "" });
      if (prevBtn) prevBtn.style.display = "none";
      if (nextBtn) nextBtn.style.display = "none";
    } else if (sankeyInterval2 === "month") {
      if (prevBtn) prevBtn.style.display = "";
      if (nextBtn) nextBtn.style.display = "";
      const select = document.createElement("select");
      select.id = "sk-month-select";
      select.className = "ha-select";
      select.style.cssText = "padding:0.25rem 2rem 0.25rem 0.5rem; font-size:0.75rem; width:auto; height:28px; background-position: right 0.5rem center;";
      select.onchange = (e) => setSankeyValue(e.target.value);
      periods.months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        const d = /* @__PURE__ */ new Date(m + "-02T12:00:00Z");
        opt.textContent = d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
        select.appendChild(opt);
      });
      if (periods.months.length > 0) {
        if (!periods.months.includes(sankeyValue2)) {
          appStore.setState({ sankeyValue: periods.months[0] });
        }
        select.value = sankeyValue2;
      }
      container.appendChild(select);
    } else if (sankeyInterval2 === "week") {
      if (prevBtn) prevBtn.style.display = "";
      if (nextBtn) nextBtn.style.display = "";
      const select = document.createElement("select");
      select.id = "sk-week-select";
      select.className = "ha-select";
      select.style.cssText = "padding:0.25rem 2rem 0.25rem 0.5rem; font-size:0.75rem; width:auto; height:28px; background-position: right 0.5rem center;";
      select.onchange = (e) => setSankeyValue(e.target.value);
      periods.weeks.forEach((w) => {
        const opt = document.createElement("option");
        opt.value = w;
        opt.textContent = w.replace(/(\d{4})-W(\d+)/, (_, y, num) => `Week ${num}, ${y}`);
        select.appendChild(opt);
      });
      if (periods.weeks.length > 0) {
        if (!periods.weeks.includes(sankeyValue2)) {
          appStore.setState({ sankeyValue: periods.weeks[0] });
        }
        select.value = sankeyValue2;
      }
      container.appendChild(select);
    } else if (sankeyInterval2 === "day") {
      if (prevBtn) prevBtn.style.display = "";
      if (nextBtn) nextBtn.style.display = "";
      const input = document.createElement("input");
      input.type = "date";
      input.id = "sk-day-picker";
      input.style.cssText = "background:rgba(0,0,0,0.3); border:1px solid var(--border-color); border-radius:6px; padding:0.25rem 0.5rem; color:var(--text-main); font-size:0.75rem; font-family:var(--font-body); height:28px; outline:none;";
      input.onchange = (e) => setSankeyValue(e.target.value);
      if (periods.days.length > 0) {
        input.min = periods.days[0];
        input.max = periods.days[periods.days.length - 1];
        if (!periods.days.includes(sankeyValue2)) {
          appStore.setState({ sankeyValue: periods.days[0] });
        }
        input.value = sankeyValue2;
      }
      container.appendChild(input);
    }
  }
  function navigateSankey(direction) {
    const periods = getUniqueSankeyPeriods();
    let list = [];
    if (sankeyInterval2 === "month") list = periods.months;
    else if (sankeyInterval2 === "week") list = periods.weeks;
    else if (sankeyInterval2 === "day") list = periods.days;
    if (list.length === 0) return;
    let idx = list.indexOf(sankeyValue2);
    if (idx === -1) {
      appStore.setState({ sankeyValue: list[0] });
    } else {
      idx += direction;
      if (idx < 0) idx = 0;
      if (idx >= list.length) idx = list.length - 1;
      appStore.setState({ sankeyValue: list[idx] });
    }
    const selectMonth = document.getElementById("sk-month-select");
    const selectWeek = document.getElementById("sk-week-select");
    const pickerDay = document.getElementById("sk-day-picker");
    if (selectMonth) selectMonth.value = sankeyValue2;
    else if (selectWeek) selectWeek.value = sankeyValue2;
    else if (pickerDay) pickerDay.value = sankeyValue2;
    renderSankeyDiagram();
  }
  if (typeof window !== "undefined") {
    window._simulateCore = _simulateCore;
    window.getFallbackSpot = getFallbackSpot2;
    window.EPEX_PROFILES = EPEX_PROFILES;
    window.buildCalibratedProfile = buildCalibratedProfile;
    window.ensureCleanData = ensureCleanData;
    window.processHAStatistics = processHAStatistics;
    window.computeBillForConfig = computeBillForConfig;
    window.runSimulation = runSimulation;
    window.parseHAHistoryExportCSV = parseHAHistoryExportCSV;
    window.guessRolesFromEntities = guessRolesFromEntities;
    window.DEMO_ROLEMAP = DEMO_ROLEMAP;
    window.parseLongCSV = parseLongCSV;
    window.parseLongCSVWithMapping = parseLongCSVWithMapping;
    window.parseHAStatisticsWideCSVAsync = parseHAStatisticsWideCSVAsync;
    window.normalizeToHourly = normalizeToHourly;
    window.__setTestState = function(state) {
      if ("energyData" in state) energyData = state.energyData;
      if ("fullYearData" in state) fullYearData = state.fullYearData;
      if ("epexHistory" in state) epexHistory = state.epexHistory;
      if ("liveEnergyTax" in state) liveEnergyTax2 = state.liveEnergyTax;
      if ("yearScale" in state) yearScale = state.yearScale;
      if ("_cleanedRef" in state) _cleanedRef = state._cleanedRef;
      if ("calibratedProfile" in state) calibratedProfile2 = state.calibratedProfile;
      const storeUpdates = {};
      for (const key of ["energyData", "fullYearData", "epexHistory", "liveEnergyTax", "yearScale", "calibratedProfile", "fullYearStamp"]) {
        if (key in state) storeUpdates[key] = state[key];
      }
      if ("fullYearData" in state && state.fullYearData === null) {
        fullYearStamp = "";
        storeUpdates.fullYearStamp = "";
      }
      if (Object.keys(storeUpdates).length) appStore.setState(storeUpdates);
    };
    window.__getTestState = function() {
      return {
        energyData,
        fullYearData,
        epexHistory,
        liveEnergyTax: liveEnergyTax2,
        yearScale,
        dataQuality,
        dataMeta,
        calibratedProfile: calibratedProfile2,
        calibrationMeta: calibrationMeta2,
        _cleanedRef,
        activeSimulation: activeSimulation2
      };
    };
  }
  function showUserGuide() {
    const backdrop = document.getElementById("guide-backdrop");
    const content = document.getElementById("guide-content");
    if (!backdrop || !content) return;
    backdrop.style.display = "flex";
    content.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Handleiding laden...</p>';
    fetch("/docs/GEBRUIKERSHANDLEIDING.md").then((resp) => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    }).then((md) => {
      content.innerHTML = markdownToHtml(md);
      const modal = backdrop.querySelector(".modal-box");
      if (modal) modal.scrollTop = 0;
    }).catch((err) => {
      console.error("Failed to load guide:", err);
      content.innerHTML = `<p style="color:var(--accent-orange);">Handleiding kon niet worden geladen. Zorg dat <code>/docs/GEBRUIKERSHANDLEIDING.md</code> bestaat.</p>`;
    });
  }
  function closeUserGuide() {
    const backdrop = document.getElementById("guide-backdrop");
    if (backdrop) backdrop.style.display = "none";
  }
  function markdownToHtml(markdown) {
    let html = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^### (.*?)$/gm, '<h3 style="font-size:0.95rem; color:var(--accent-cyan); margin:1.2rem 0 0.5rem; font-weight:600;">$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2 style="font-size:1.1rem; color:var(--accent-cyan); margin:1.5rem 0 0.6rem; font-weight:700;">$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1 style="font-size:1.3rem; color:var(--accent-blue); margin:2rem 0 1rem; font-weight:700;">$1</h1>');
    html = html.replace(/^> (.*?)$/gm, (match, text) => {
      return `<div style="background:rgba(0,242,254,0.06); border-left:3px solid var(--accent-cyan); padding:0.8rem 1rem; margin:1rem 0; border-radius:6px;"><strong>${text}</strong></div>`;
    });
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, (match, text) => {
      if (match.startsWith("**")) return match;
      return `<em>${text}</em>`;
    });
    html = html.replace(/_(.*?)_/g, "<em>$1</em>");
    html = html.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.3); padding:0.2rem 0.4rem; border-radius:3px; font-family:monospace; font-size:0.85em;">$1</code>');
    html = html.replace(/^\s*[-*] (.*?)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*?<\/li>)/s, (match) => {
      return `<ul style="margin:0.5rem 0 0.5rem 1.5rem; padding:0;">${match}</ul>`;
    });
    html = html.replace(/^\s*(\d+)\. (.*?)$/gm, "<li>$2</li>");
    html = html.replace(/(<li>.*?<\/li>)/s, (match) => {
      if (match.includes("<ol")) return match;
      return `<ol style="margin:0.5rem 0 0.5rem 1.5rem; padding:0;">${match}</ol>`;
    });
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:var(--accent-cyan); text-decoration:underline;">$1</a>');
    html = html.replace(/^(---|___|\\*\\*\\*)\s*$/gm, '<hr style="border:none; border-top:1px solid rgba(255,255,255,0.1); margin:1.5rem 0;">');
    const lines = html.split("\n");
    let inList = false;
    let inBlockquote = false;
    let result = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("<ul") || trimmed.startsWith("<ol")) {
        inList = true;
      } else if (trimmed === "</ul>" || trimmed === "</ol>") {
        inList = false;
      }
      if (trimmed.startsWith('<div style="background:rgba(0,242,254,0.06)')) {
        inBlockquote = true;
      } else if (inBlockquote && trimmed.endsWith("</div>")) {
        inBlockquote = false;
      }
      if (trimmed === "" || trimmed.startsWith("<") || inList || inBlockquote) {
        result.push(line);
      } else {
        result.push(trimmed ? `<p style="margin:0.5rem 0; line-height:1.7;">${trimmed}</p>` : "");
      }
    }
    html = result.join("\n");
    html = html.replace(/<\/p>\n<p/g, "</p>\n<p");
    html = html.replace(/\n\n+/g, "\n");
    return html;
  }
  function _resolveCssVars(str) {
    const cs = getComputedStyle(document.documentElement);
    return str.replace(/var\(--([^),\s]+)[^)]*\)/g, (_, name) => {
      return cs.getPropertyValue("--" + name.trim()).trim() || "transparent";
    });
  }
  function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function _buildExportSvg(svgEl) {
    const clone = svgEl.cloneNode(true);
    const vb = svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const w = vb.width || Math.round(rect.width);
    const h = vb.height || Math.round(rect.height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim() || "#0f1117";
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", bgColor);
    clone.insertBefore(bg, clone.firstChild);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = 'text, tspan { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }';
    clone.insertBefore(style, clone.firstChild);
    const raw = new XMLSerializer().serializeToString(clone);
    return { svg: _resolveCssVars(raw), w, h };
  }
  function exportChartAsSvg(svgId, chartName) {
    const el = document.getElementById(svgId);
    if (!el) return;
    const { svg } = _buildExportSvg(el);
    _triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), chartName + ".svg");
  }
  function exportChartAsPng(svgId, chartName) {
    const el = document.getElementById(svgId);
    if (!el) return;
    const scale = 2;
    const { svg, w, h } = _buildExportSvg(el);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => _triggerDownload(b, chartName + ".png"), "image/png");
    };
    img.src = url;
  }
  function _closeExportDropdowns(except) {
    document.querySelectorAll(".chart-export-wrap.open").forEach((w) => {
      if (w !== except) w.classList.remove("open");
    });
  }
})();
