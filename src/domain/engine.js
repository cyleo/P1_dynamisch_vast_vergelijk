// src/domain/engine.js
// Extracted simulation engine.
import { appStore } from "./store.js";
import {
  rowMeta, epexKey, toConsumerPrice, seasonOf,
  precomputeEVSchedules, precomputeBatterySchedule,
  applyHeatPumpLoad, applyEVLoad, applyBatteryState, applySmartDimming
} from "./energyMath.js";
import { EPEX_PROFILES } from "./constants.js";

export function getFallbackSpot(month, hour) {
  const season = seasonOf(month);
  // Voorkeur: gekalibreerd op eigen EPEX-historie (al incl. BTW → geen extra ×1.21).
  const cal = calibratedProfile?.[season]?.[hour];
  if (cal != null) return cal;
  // Anders: generiek seizoensprofiel (ruwe beurs → ×1.21 op positieve uren).
  const raw = EPEX_PROFILES[season][hour];
  return raw >= 0 ? raw * 1.21 : raw;
}

export function buildSimContext() {
  return {
    simData: fullYearData || energyData,
    epexHistory,
    eb: liveEnergyTax,
    yearScale,
  };
}

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
  const dimmingActive = solarDimmingMode && solarDimmingMode !== "off";

  // ── PRE-COMPUTATION CAPTURE: Bereken EV Profielen ÉÉNMAAL (Vector 3 & 5 Fix) ──
  const dayRows = getDayRows(simData);
  const { evScheduleCacheDyn, evScheduleCacheFx } = precomputeEVSchedules(cfg, ctx, dayRows, markupBtw);

  // ── Accu-arbitrage: per dag de goedkoopste laad- en duurste ontlaad-uren bepalen.
  const { batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve } = 
    precomputeBatterySchedule(cfg, ctx, dayRows, markupBtw, exportMarkup, gridCharge, gridExport);

  // Accumulatoren
  let fxPeakImp = 0, fxDalImp = 0, fxPeakExp = 0, fxDalExp = 0;
  let dynImpCost = 0, dynExpRev = 0, dynImpKwh = 0, dynExpKwh = 0;
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

  // ── HOOFDLOOP (8760 UUR REEKS) ──
  simData.forEach(row => {
    const { hour, month, dow, dayKey, epexKey: tsKey } = rowMeta(row);
    const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;

    const rawImp = row.import_t1 + row.import_t2;
    const rawExp = row.export_t1 + row.export_t2;

    let spot = epexHistory.has(tsKey) ? epexHistory.get(tsKey) : getFallbackSpot(month, hour);
    if (epexHistory.has(tsKey)) epexReal++; else epexFall++;
    if (spot > 0 && stressMultiplier !== 1.0) spot *= stressMultiplier;

    let batChargeVal = 0;
    let batDischargeVal = 0;
    let batChargeSolarVal = 0;
    let batChargeGridVal = 0;
    let batDischargeToHouseVal = 0;
    let batDischargeToGridVal = 0;

    let batChargeSolarFxVal = 0;
    let batDischargeToHouseFxVal = 0;

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

    // Thuisaccu processing (Volledig lineair, Vector 2 Fix)
    const batRes = applyBatteryState(
      cfg, eb, markupBtw, exportMarkup, gridCharge, gridExport,
      dayKey, hour, spot,
      batChargeHrs, batDischargeHrs, batDayMinAllin, batGridBudget, batStoreCap, batSelfReserve,
      batSoC, batSoCFx, batGridDrawn[dayKey] || 0,
      impDyn, expDyn, impFx, expFx
    );
    impDyn = batRes.impDyn; expDyn = batRes.expDyn;
    impFx = batRes.impFx; expFx = batRes.expFx;
    batSoC = batRes.batSoC; batSoCFx = batRes.batSoCFx;
    if (batRes.drawnGrid > 0) batGridDrawn[dayKey] = (batGridDrawn[dayKey] || 0) + batRes.drawnGrid;

    // Accumuleer Vast Contract Volumes
    if (isPeak) { fxPeakImp += impFx; fxPeakExp += expFx; }
    else { fxDalImp += impFx; fxDalExp += expFx; }

    // ── Slimme Omvormer Interventie bij Negatieve Spot (Vector 1 Fix) ──
    const dimRes = applySmartDimming(solarDimmingMode, spot, impDyn, expDyn, row.solar_yield);
    const dynImp = dimRes.dynImp;
    const dynExp = dimRes.dynExp;

    // Accumuleer Dynamische Resultaten
    const basePrice = spot + markupBtw;
    dynImpCost += dynImp * basePrice;
    dynExpRev += dynExp * ((spot / 1.21) - exportMarkup);
    dynImpKwh += dynImp;
    dynExpKwh += dynExp;

    if (full) {
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
      hourly[hour].solar.push(row.solar_yield || 0);
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

      if (!dayTot[dayKey]) {
        dayTot[dayKey] = {
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
      const pd = dayTot[dayKey];
      pd.dynCost += dynHrCost; pd.fixedCost += fxHrCost;
      pd.impKwh += dynImp; pd.expKwh += dynExp;
      pd.impCost += dynImp * allIn;
      pd.expRev += dynExp * returnPrice;
      if (dynImp > 0) { pd.spotSum += spot * dynImp; pd.spotN += dynImp; }

      pd.rawImp += rawImp;
      pd.rawExp += rawExp;
      pd.solarYield += (row.solar_yield || 0);
      
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
    }
  });

  // Jaarnormalisatie-schaling (factor uit de context)
  const ys = ctx.yearScale;
  fxPeakImp *= ys; fxDalImp *= ys; fxPeakExp *= ys; fxDalExp *= ys;
  dynImpCost *= ys; dynExpRev *= ys; dynImpKwh *= ys; dynExpKwh *= ys;

  // ── EINDTOTALEN REKENING (Fiscaal Zuiver Model 2027) ──
  // Het vaste piek/dal-tarief is het all-in tarief zoals getekend (incl. EB-bij-tekenen).
  // We rekenen er rechtstreeks mee: de energiebelasting-schuif (een dynamisch-contract-
  // parameter, ook live bijgewerkt door Frank) mag het vaste contract NIET stil herprijzen.
  const fxImpCost = fxPeakImp * fixedPeakRate + fxDalImp * fixedDalRate;
  const fxFeedCredit = (fxPeakExp + fxDalExp) * fixedFeedInRate;
  const fxFeedPenalt = (fxPeakExp + fxDalExp) * fixedFeedInFee;
  const fxSub = fixedVastrecht * 12.0;

  // Heffingskorting (vaste jaarlijkse EB-vermindering per aansluiting) — identiek voor
  // beide contracten, dus comparison-neutraal, maar nodig voor realistische jaartotalen.
  const ebRebate = EB_REBATE_2026;
  const gridFees = NETBEHEER_2026;

  const fixedBill = fxImpCost - fxFeedCredit + fxFeedPenalt + fxSub - ebRebate + gridFees;

  const dynEB = dynImpKwh * eb; // Gross energy tax charging rule
  const dynSub = dynamicVastrecht * 12.0;
  const dynBill = (dynImpCost - dynExpRev) + dynEB + dynSub - ebRebate + gridFees;

  const out = { fixedBill, dynBill };

  if (full) {
    Object.assign(out, {
      totalImportKwh: dynImpKwh, totalExportKwh: dynExpKwh,
      netDynamicKwh: Math.max(0, dynImpKwh - dynExpKwh),
      dynamicRawImportCost: dynImpCost, dynamicRawExportRevenue: dynExpRev,
      dynamicNetTax: dynEB, dynamicSubscription: dynSub, dynamicTotalBill: dynBill,
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
