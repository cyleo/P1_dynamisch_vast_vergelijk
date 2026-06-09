/**
 * @module Engine
 * @description Core simulation engine for energy calculations.
 */
import { appStore } from "./store.js";
import {
  rowMeta, seasonOf,
  precomputeEVSchedules, precomputeBatterySchedule,
  applyHeatPumpLoad, applyEVLoad, applyBatteryState, applySmartDimming
} from "./energyMath.js";
import { EPEX_PROFILES, FISCAL_MODELS, DEFAULT_FISCAL_YEAR } from "./constants.js";

let _dayRowsCache = null, _dayRowsSrc = null;

/**
 * Groups simulation data rows by dayKey. Uses a simple cache.
 * @param {Array<Object>} simData - The raw telemetry data rows.
 * @returns {Object<string, Array<Object>>} Grouped data mapping dayKey to rows.
 */
export function getDayRows(simData) {
  if (_dayRowsSrc === simData && _dayRowsCache) return _dayRowsCache;
  const dr = {};
  simData.forEach(r => { (dr[rowMeta(r).dayKey] ||= []).push(r); });
  _dayRowsSrc = simData; _dayRowsCache = dr;
  return dr;
}

/**
 * Retrieves the fallback spot market price for a given month and hour.
 * Includes VAT (x1.21) on positive hours if using static profiles.
 * @param {number} month - The month number (1-12).
 * @param {number} hour - The hour of the day (0-23).
 * @returns {number} The spot price in €/kWh.
 */
export function getFallbackSpot(month, hour) {
  const { calibratedProfile } = appStore.getState();
  const season = seasonOf(month);
  
  // Eerst proberen of er een gekalibreerd profiel voor is
  const cal = calibratedProfile?.[season]?.[hour];
  if (cal != null) return cal;
  // Anders: generiek seizoensprofiel (ruwe beurs → ×1.21 op positieve uren).
  const raw = EPEX_PROFILES[season][hour];
  return raw >= 0 ? raw * 1.21 : raw;
}

/**
 * Builds the runtime simulation context from the global appStore.
 * @returns {Object} Context object containing simData, epexHistory, eb, yearScale.
 */
export function buildSimContext() {
  const { fullYearData, energyData, epexHistory, liveEnergyTax, yearScale } = appStore.getState();
  return {
    simData: fullYearData || energyData,
    epexHistory,
    eb: liveEnergyTax,
    yearScale,
  };
}

/**
 * Zero-init record voor de per-dag breakdown (`perDayTotals`). Eén plek voor de
 * ~40 accumulator-velden zodat de vorm consistent blijft met `accumulateFull`.
 * @returns {Object} dagrecord met alle tellers op 0.
 */
function makeDayTotal() {
  return {
    dynCost: 0, fixedCost: 0, impKwh: 0, expKwh: 0, spotSum: 0, spotN: 0, impCost: 0, expRev: 0,
    rawImp: 0, rawExp: 0, solarYield: 0,
    evKwh: 0, evCost: 0, evSavings: 0, evSolar: 0, evGrid: 0,
    hpKwh: 0, hpCost: 0, hpSavings: 0, hpSolar: 0, hpGrid: 0,
    batCharge: 0, batDischarge: 0, batCost: 0, batSavings: 0,
    batChargeCost: 0, batDischargeValue: 0,
    batChargeGrid: 0, batChargeGridCost: 0, batChargeSolar: 0,
    batDischargeToHouse: 0, batDischargeToGrid: 0,
    baseloadCost: 0, baseloadReturn: 0,
    baseloadImportSavings: 0, baseloadExportSavings: 0
  };
}

/**
 * The core simulation engine that processes 8760 hours of data to evaluate
 * fixed vs dynamic contract costs, battery arbitrage, EV charging, and solar dimming.
 * 
 * @param {Object} cfg - The simulation configuration containing all sliders and options.
 * @param {boolean} [full=false] - Whether to generate detailed hourly/weekly profiles.
 * @param {Object} [ctx=null] - Overrides the default store context (used for tests).
 * @returns {Object} Total bill calculation and optional detailed profiles.
 */
export function _simulateCore(cfg, full = false, ctx = null) {
  ctx = ctx || buildSimContext();
  const {
    fixedPeakRate, fixedDalRate, fixedFeedInRate, fixedVastrecht, fixedFeedInFee,
    dynamicMarkup, dynamicExportMarkup = 0.0, dynamicVastrecht, stressMultiplier = 1.0,
    solarDimmingMode,
    hasHeatPump, hpWinterBaseload,
    hasEv, evWeeklyDist, evConsumption, evSolarMatch, evProfile = "home",
    hasBattery, batCapacity, batPower, batEfficiency, batArbitrage, batGridExport = false,
    batMode,
    noSolar = false,
  } = cfg;

  // ── Accu-modus (v=38) ──
  //   "zelf"   = maximaal zelfverbruik: alléén zon opslaan ↔ eigen import dekken.
  //   "kosten" = kostenbewust: óók 's nachts van het net laden, maar uitsluitend om
  //              eigen verbruik te dekken (geen net-teruglevering).
  //   "winst"  = maximale winst: bovenstaande + bij hoge prijs aan het net verkopen.
  //   Back-compat: oude cfg's met batArbitrage/batGridExport mappen op deze modi.
  const mode = batMode || (batGridExport ? "winst" : (batArbitrage ? "kosten" : "zelf"));
  const gridCharge = mode === "kosten" || mode === "winst";   // van het net mogen laden
  const gridExport = mode === "winst";                        // aan het net mogen verkopen

  const markupBtw = dynamicMarkup;   // slider is incl. BTW (Pad 1): rechtstreeks gebruiken
  const exportMarkup = dynamicExportMarkup;   // slider is incl. BTW (Pad 1): rechtstreeks van de kale prijs af
  // Markt-/dataset-inputs uit de context i.p.v. module-globals (DOM-vrij, worker-klaar).
  const eb = ctx.eb;
  const epexHistory = ctx.epexHistory;   // lokaal: alle .has/.get hieronder binden hieraan
  const simData = ctx.simData;
  // ── PRE-COMPUTATION CAPTURE: Bereken EV Profielen ÉÉNMAAL (Vector 3 & 5 Fix) ──
  const dayRows = getDayRows(simData);
  const { evScheduleCacheDyn, evScheduleCacheFx } = precomputeEVSchedules(cfg, ctx, dayRows, markupBtw);

  // ── Accu-arbitrage: per dag de goedkoopste laad- en duurste ontlaad-uren bepalen.
  const { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve } = 
    precomputeBatterySchedule(cfg, ctx, dayRows, markupBtw, exportMarkup, gridCharge, gridExport);

  // Accumulatoren
  let fxPeakImp = 0, fxDalImp = 0, fxPeakExp = 0, fxDalExp = 0;
  let dynImpCost = 0, dynExpRev = 0, dynImpKwh = 0, dynExpKwh = 0;
  // Salderbare teruglever-omzet (incl. BTW + inkoopvergoeding) — de all-in waarde van het
  // export-uur, parallel aan dynExpRev (kale 2027-waarde). Alléén gebruikt in het 2026-model.
  let dynExpRevSalder = 0;
  let batSoC = 0, batSoCFx = 0;
  let epexReal = 0, epexFall = 0;
  const batGridDrawn = {};    // dayKey → reeds van het net ingekochte kWh (drawn, budgetbewaking)

  // Profiel-arrays (wanneer full=true)
  const hourly = full ? Array.from({ length: 24 }, () => ({
    imports: [], exports: [], spots: [], dynCosts: [], fixedCosts: [],
    solar: [], ev: [], hp: [], batCharge: [], batDischarge: []
  })) : null;
  const weekly = full ? Array.from({ length: 7 }, () => ({ dynCosts: [], fixedCosts: [] })) : null;
  const dayTot = full ? {} : null;
  const dayHour = full ? {} : null;

  // ── full=true breakdown-accumulator ──────────────────────────────────────────
  // Uitgesplitst uit de hoofdloop om de cyclomatische complexiteit te verlagen.
  // Closure over de constante contractparameters (eb, tarieven, opslag, hasHeatPump)
  // en de profiel-accumulatoren; krijgt per uur alléén de variërende waarden mee.
  // Gedrag is byte-identiek aan de oude inline-versie (geborgd door test15_snapshot).
  const accumulateFull = (h) => {
    const { hour, dow, dayKey, isPeak, spot, dynImp, dynExp, basePrice,
      rawImp, rawExp, solarYield, hpLoad, hpFromSolar, hpFromGrid,
      evRes, batRes, impFx, expFx } = h;

    hourly[hour].imports.push(dynImp);
    hourly[hour].exports.push(dynExp);
    const allIn = basePrice + eb;
    const returnPrice = (spot / 1.21) - exportMarkup;
    const dynHrCost = dynImp * allIn - dynExp * returnPrice;   // teruglevering = kale spot (excl. BTW, 2027) minus opslag
    const tariff = isPeak ? fixedPeakRate : fixedDalRate;
    const fxHrCost = impFx * tariff - expFx * fixedFeedInRate + expFx * fixedFeedInFee;

    hourly[hour].dynCosts.push(dynHrCost);
    hourly[hour].fixedCosts.push(fxHrCost);
    weekly[dow].dynCosts.push(dynHrCost);
    weekly[dow].fixedCosts.push(fxHrCost);

    // Collect simulated hardware values for 24h profile
    hourly[hour].solar.push(solarYield);
    hourly[hour].ev.push(evRes.evVal);
    hourly[hour].hp.push(hasHeatPump ? hpLoad : 0);
    hourly[hour].batCharge.push(batRes.batChargeVal);
    hourly[hour].batDischarge.push(batRes.batDischargeVal);

    // Detailed hourly calculations for savings breakdown
    const fixedReturnPrice = fixedFeedInRate - fixedFeedInFee;

    const evCostFx = evRes.evGridFx * tariff - evRes.evSolarFx * fixedReturnPrice;
    const evCostDyn = evRes.evGridDyn * allIn - evRes.evSolarDyn * returnPrice;
    const evSavings = evCostFx - evCostDyn;

    const hpCostFx = hpFromGrid * tariff - hpFromSolar * fixedReturnPrice;
    const hpCostDyn = hpFromGrid * allIn - hpFromSolar * returnPrice;
    const hpSavings = hpCostFx - hpCostDyn;

    const batCostFx = batRes.batChargeSolarFxVal * fixedReturnPrice - batRes.batDischargeToHouseFxVal * tariff;
    const batCostDyn = (batRes.batChargeGridVal * allIn + batRes.batChargeSolarVal * returnPrice) - (batRes.batDischargeToHouseVal * allIn + batRes.batDischargeToGridVal * returnPrice);
    const batSavings = batCostFx - batCostDyn;

    const baseloadImportSavings = rawImp * (tariff - allIn);
    const baseloadExportSavings = rawExp * (returnPrice - fixedReturnPrice);

    const pd = (dayTot[dayKey] ||= makeDayTotal());
    pd.dynCost += dynHrCost; pd.fixedCost += fxHrCost;
    pd.impKwh += dynImp; pd.expKwh += dynExp;
    pd.impCost += dynImp * allIn;
    pd.expRev += dynExp * returnPrice;
    if (dynImp > 0) { pd.spotSum += spot * dynImp; pd.spotN += dynImp; }

    pd.rawImp += rawImp;
    pd.rawExp += rawExp;
    pd.solarYield += solarYield;

    pd.evKwh += (evRes.evGridDyn + evRes.evSolarDyn);
    pd.evCost += evCostDyn;
    pd.evSavings += evSavings;
    pd.evSolar += evRes.evSolarDyn;
    pd.evGrid += evRes.evGridDyn;

    pd.hpKwh += hpLoad;
    pd.hpCost += hpCostDyn;
    pd.hpSavings += hpSavings;
    pd.hpSolar += hpFromSolar;
    pd.hpGrid += hpFromGrid;

    pd.batCharge += (batRes.batChargeSolarVal + batRes.batChargeGridVal);
    pd.batDischarge += (batRes.batDischargeToHouseVal + batRes.batDischargeToGridVal);
    pd.batCost += batCostDyn;
    pd.batSavings += batSavings;
    pd.batChargeCost += (batRes.batChargeGridVal * allIn + batRes.batChargeSolarVal * returnPrice);
    pd.batDischargeValue += (batRes.batDischargeToHouseVal * allIn + batRes.batDischargeToGridVal * returnPrice);
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

  // ── HOOFDLOOP (8760 UUR REEKS) ──
  simData.forEach(row => {
    const { hour, month, dow, dayKey, epexKey: tsKey } = rowMeta(row);
    const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;

    const _rawImp0 = row.import_t1 + row.import_t2;
    const _rawExp0 = row.export_t1 + row.export_t2;
    const solarYieldRaw = row.solar_yield || 0;
    // noSolar-run: reconstrueer huis-last zonder zon (alles van net, geen teruglevering).
    // Energie-behoud: houseLoad = rawImp − rawExp + solar_yield.
    const rawImp = (noSolar && solarYieldRaw > 0)
      ? Math.max(0, _rawImp0 - _rawExp0 + solarYieldRaw)
      : _rawImp0;
    const rawExp = (noSolar && solarYieldRaw > 0) ? 0 : _rawExp0;
    const solarYield = noSolar ? 0 : solarYieldRaw;

    let spot = epexHistory.has(tsKey) ? epexHistory.get(tsKey) : getFallbackSpot(month, hour);
    if (epexHistory.has(tsKey)) epexReal++; else epexFall++;
    if (spot > 0 && stressMultiplier !== 1.0) spot *= stressMultiplier;

    if (full) {
      hourly[hour].spots.push(spot);
    }

    // Thermische stooklast (Warmtepomp)
    const hpLoad = applyHeatPumpLoad(hasHeatPump, hpWinterBaseload, month, hour);
    const hpFromSolar = Math.min(hpLoad, rawExp);
    const hpFromGrid = hpLoad - hpFromSolar;
    let impDyn = rawImp + hpFromGrid;
    let expDyn = rawExp - hpFromSolar;
    let impFx = rawImp + hpFromGrid;
    let expFx = rawExp - hpFromSolar;

    // EV verbruik injecteren vanuit gescheiden dagschemas.
    const evRes = applyEVLoad(hasEv, evScheduleCacheDyn, evScheduleCacheFx, dayKey, hour, impDyn, expDyn, impFx, expFx);
    impDyn = evRes.impDyn; expDyn = evRes.expDyn;
    impFx = evRes.impFx; expFx = evRes.expFx;

    // Thuisaccu processing (Volledig lineair, Vector 2 Fix) — context-object i.p.v. 18 args.
    const batRes = applyBatteryState({
      cfg, eb, markupBtw, exportMarkup, gridCharge, gridExport,
      dayKey, hour, spot,
      batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve,
      batSoC, batSoCFx, batGridDrawnVal: batGridDrawn[dayKey] || 0,
      impDyn, expDyn, impFx, expFx,
    });
    impDyn = batRes.impDyn; expDyn = batRes.expDyn;
    impFx = batRes.impFx; expFx = batRes.expFx;
    batSoC = batRes.batSoC; batSoCFx = batRes.batSoCFx;
    if (batRes.drawnGrid > 0) batGridDrawn[dayKey] = (batGridDrawn[dayKey] || 0) + batRes.drawnGrid;

    // Accumuleer Vast Contract Volumes
    if (isPeak) { fxPeakImp += impFx; fxPeakExp += expFx; }
    else { fxDalImp += impFx; fxDalExp += expFx; }

    // ── Slimme Omvormer Interventie bij Negatieve Spot (Vector 1 Fix) ──
    const dimRes = applySmartDimming(solarDimmingMode, spot, impDyn, expDyn, solarYield, markupBtw, eb);
    const dynImp = dimRes.dynImp;
    const dynExp = dimRes.dynExp;

    // Accumuleer Dynamische Resultaten
    const basePrice = spot + markupBtw;
    dynImpCost += dynImp * basePrice;
    dynExpRev += dynExp * ((spot / 1.21) - exportMarkup);
    // Saldering-waardering (2026): salderbare teruglevering krijgt BTW + inkoopvergoeding
    // terug → de all-in import-prijs van het export-uur (spot incl. BTW + opslag).
    dynExpRevSalder += dynExp * basePrice;
    dynImpKwh += dynImp;
    dynExpKwh += dynExp;

    if (full) accumulateFull({
      hour, dow, dayKey, isPeak, spot, dynImp, dynExp, basePrice,
      rawImp, rawExp, solarYield,
      hpLoad, hpFromSolar, hpFromGrid, evRes, batRes, impFx, expFx,
    });
  });

  // Jaarnormalisatie-schaling (factor uit de context)
  const ys = ctx.yearScale;
  fxPeakImp *= ys; fxDalImp *= ys; fxPeakExp *= ys; fxDalExp *= ys;
  dynImpCost *= ys; dynExpRev *= ys; dynExpRevSalder *= ys; dynImpKwh *= ys; dynExpKwh *= ys;

  // ── FISCAAL JAARMODEL (scenario-selector) ──
  // Eén object per jaar bundelt álle verschillen; de engine takt alléén op `salderen`.
  // 2027 = huidige gedrag (geen saldering); 2026 = wettelijke jaarverrekening.
  const model = FISCAL_MODELS[cfg.fiscalYear] || FISCAL_MODELS[DEFAULT_FISCAL_YEAR];
  // Heffingskorting + netbeheer komen uit het jaarmodel — identiek voor beide contracten
  // (comparison-neutraal), maar nodig voor realistische jaartotalen.
  const ebRebate = model.ebRebate;
  const gridFees = model.netbeheer;
  const fxSub = fixedVastrecht * 12.0;
  const dynSub = dynamicVastrecht * 12.0;

  // ── EINDTOTALEN REKENING ──
  // Het vaste piek/dal-tarief is het all-in tarief zoals getekend (incl. EB-bij-tekenen).
  // De energiebelasting-schuif (een dynamisch-contract-parameter) mag het vaste contract
  // NIET stil herprijzen.
  let fxImpCost, fxFeedCredit, fxFeedPenalt, fixedBill, dynEB, effExpRev, dynTaxableKwh, dynBill;

  if (model.salderen) {
    // ── 2026 · SALDERING (wettelijke jaarverrekening, salderingsgrens = jaarafname) ──
    // Vast contract: afname ↔ teruglevering wordt netto verrekend tégen het retail-tarief.
    // De netto import betaalt het volume-gewogen piek/dal-tarief; het overschot (teruglevering
    // bóven de afname) krijgt het teruglevertarief (− VTK).
    const fxImpKwh = fxPeakImp + fxDalImp;
    const fxExpKwh = fxPeakExp + fxDalExp;
    const fxNetImp = Math.max(0, fxImpKwh - fxExpKwh);
    const fxSurplusExp = Math.max(0, fxExpKwh - fxImpKwh);
    const peakShare = fxImpKwh > 0 ? fxPeakImp / fxImpKwh : 0;
    fxImpCost = fxNetImp * (peakShare * fixedPeakRate + (1 - peakShare) * fixedDalRate);
    fxFeedCredit = fxSurplusExp * fixedFeedInRate;
    fxFeedPenalt = fxSurplusExp * fixedFeedInFee;

    // Dynamisch contract: EB over de NETTO afname; salderbare teruglevering (tot de
    // salderingsgrens = totale afname) krijgt BTW + inkoopvergoeding terug (all-in waarde),
    // het overschot krijgt de kale 2027-waarde. We proraten op jaarvolume → geen
    // uur-volgorde-bias (de salderbare fractie wordt over álle export-uren uitgesmeerd).
    dynTaxableKwh = Math.max(0, dynImpKwh - dynExpKwh);
    dynEB = dynTaxableKwh * eb;
    const salderFrac = dynExpKwh > 0 ? Math.min(1, dynImpKwh / dynExpKwh) : 0;
    effExpRev = salderFrac * dynExpRevSalder + (1 - salderFrac) * dynExpRev;
  } else {
    // ── 2027 · GEEN SALDERING (EB over bruto afname, kale teruglevering) ──
    fxImpCost = fxPeakImp * fixedPeakRate + fxDalImp * fixedDalRate;
    fxFeedCredit = (fxPeakExp + fxDalExp) * fixedFeedInRate;
    fxFeedPenalt = (fxPeakExp + fxDalExp) * fixedFeedInFee;
    dynTaxableKwh = dynImpKwh;
    dynEB = dynImpKwh * eb; // Gross energy tax charging rule
    effExpRev = dynExpRev;
  }

  fixedBill = fxImpCost - fxFeedCredit + fxFeedPenalt + fxSub - ebRebate + gridFees;
  dynBill = (dynImpCost - effExpRev) + dynEB + dynSub - ebRebate + gridFees;

  const out = { fixedBill, dynBill };

  if (full) {
    Object.assign(out, {
      totalImportKwh: dynImpKwh, totalExportKwh: dynExpKwh,
      netDynamicKwh: Math.max(0, dynImpKwh - dynExpKwh),
      dynamicRawImportCost: dynImpCost, dynamicRawExportRevenue: effExpRev,
      dynamicNetTax: dynEB, dynamicTaxableKwh: dynTaxableKwh,
      dynamicSubscription: dynSub, dynamicTotalBill: dynBill,
      taxRebate: ebRebate, gridFees: gridFees,
      fixedPeakImport: fxPeakImp, fixedPeakExport: fxPeakExp,
      fixedDalImport: fxDalImp, fixedDalExport: fxDalExp,
      fixedImportCost: fxImpCost, fixedFeedInCredit: fxFeedCredit,
      fixedFeedInFee: fxFeedPenalt, fixedSubscription: fxSub, fixedTotalBill: fixedBill,
      totalSavings: fixedBill - dynBill,
      // Deel door |fixedBill|: door de heffingskorting kan een totaal negatief zijn
      // (zon-huishouden krijgt geld terug) → anders zou het % van teken wisselen.
      savingsPct: fixedBill !== 0 ? ((fixedBill - dynBill) / Math.abs(fixedBill)) * 100 : 0,
      hourlyProfile: hourly, weekdayProfile: weekly, perDayTotals: dayTot, perDayHourly: dayHour,
      epexPct: (epexReal + epexFall) > 0 ? Math.round(epexReal / (epexReal + epexFall) * 100) : 0,
    });
  }
  return out;
}
