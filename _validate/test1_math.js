// TEST 1 — Exacte math-validatie tegen handberekening.
// Constante last 1 kWh/uur, geen export, constante spot 0.10, geen hardware.
const { RUN } = require("./harness");

const YEAR = 2026;
function buildConstant(kwhImp, kwhExp, spotConst) {
  const rows = [];
  const epex = new Map();
  const start = new Date(YEAR, 0, 1, 0, 0, 0); // 1 jan 2026 lokaal
  for (let h = 0; h < 8760; h++) {
    const dt = new Date(start.getTime() + h * 3600 * 1000);
    rows.push({
      timestamp: dt.toISOString(),
      import_t1: kwhImp, import_t2: 0,
      export_t1: kwhExp, export_t2: 0,
      solar_yield: 0,
    });
    const p2 = n => (n < 10 ? "0" + n : "" + n);
    const key = `${dt.getFullYear()}-${p2(dt.getMonth()+1)}-${p2(dt.getDate())}T${p2(dt.getHours())}`;
    epex.set(key, spotConst);
  }
  return { rows, epex };
}

const cfg = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};

const { rows, epex } = buildConstant(1, 0, 0.10);
const r = RUN({ rows, epex, cfg, eb: 0.11084, yearScale: 1.0 });

// --- Handberekening ---
const eb = 0.11084, markup = 0.018, spot = 0.10;
const REBATE = 628.96;   // heffingskorting (EB-vermindering) — van beide totalen af
const totImp = 8760;
const dynImpCost_hand = totImp * (spot + markup * 1.21);
const dynEB_hand = totImp * eb;
const dynSub_hand = 6.00 * 12;
const dynBill_hand = dynImpCost_hand + dynEB_hand + dynSub_hand - REBATE;

// Peak/dal split — bepaald door engine; we lezen volumes terug en checken kosten consistent.
const peakImp = r.fixedPeakImport, dalImp = r.fixedDalImport;
const fixedImp_hand = peakImp * 0.27 + dalImp * 0.24;
const fixedSub_hand = 7.50 * 12;
const fixedBill_hand = fixedImp_hand + fixedSub_hand - REBATE;

function chk(name, a, b, tol = 0.01) {
  const ok = Math.abs(a - b) < tol;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: engine=${a.toFixed(4)}  hand=${b.toFixed(4)}  Δ=${(a-b).toFixed(4)}`);
}

console.log("=== TEST 1: exacte math-validatie (1 kWh/u, spot 0.10, geen export/hardware) ===");
console.log(`Totaal import kWh: ${r.totalImportKwh.toFixed(1)} (verwacht 8760)`);
console.log(`Peak/dal volume split: peak=${peakImp.toFixed(0)} dal=${dalImp.toFixed(0)} som=${(peakImp+dalImp).toFixed(0)}`);
chk("dyn raw importkosten", r.dynamicRawImportCost, dynImpCost_hand);
chk("dyn energiebelasting", r.dynamicNetTax, dynEB_hand);
chk("dyn vastrecht", r.dynamicSubscription, dynSub_hand);
chk("dyn TOTAAL", r.dynamicTotalBill, dynBill_hand);
chk("vast importkosten", r.fixedImportCost, fixedImp_hand);
chk("vast TOTAAL", r.fixedTotalBill, fixedBill_hand);
console.log(`\nEngine dynBill = €${r.dynamicTotalBill.toFixed(2)} | fixedBill = €${r.fixedTotalBill.toFixed(2)}`);
