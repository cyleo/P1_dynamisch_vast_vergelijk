// TEST 9 — Accu-arbitrage op dagspread (geen zon, goedkope nacht → dure avond).
// Oude logica (laden ≤€0,01) deed hier NIETS; nieuwe moet de dynamische rekening verlagen.
const { RUN } = require("./harness");

const H = 3600000;
const START = Date.UTC(2026, 0, 5, 0, 0, 0);   // winter, geen zon
const DAYS = 30;
const p2 = n => (n < 10 ? "0" + n : "" + n);

// Spotprofiel (incl. BTW, excl. EB): goedkope nacht, dure avondpiek.
function spotFor(h) {
  if (h >= 0 && h < 6) return 0.05;     // nacht goedkoop
  if (h >= 17 && h < 21) return 0.28;   // avondpiek duur
  if (h >= 10 && h < 15) return 0.09;   // middag
  return 0.13;
}
// Verbruik: nacht 0,2 · dag 0,4 · avondpiek 1,0 kWh/u. Geen zon, geen export.
function loadFor(h) {
  if (h >= 17 && h < 21) return 1.0;
  if (h >= 0 && h < 6) return 0.2;
  return 0.4;
}

const rows = [], epex = new Map();
for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) {
  const ms = START + (d * 24 + h) * H;
  const dt = new Date(ms);
  rows.push({ timestamp: dt.toISOString(), import_t1: loadFor(h), import_t2: 0, export_t1: 0, export_t2: 0, solar_yield: 0 });
  const key = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}T${p2(dt.getHours())}`;
  epex.set(key, spotFor(h));
}

const base = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07, fixedVastrecht: 7.5, fixedFeedInFee: 0.0,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.0, stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};
const withBat = { ...base, hasBattery: true, batCapacity: 10, batPower: 5, batEfficiency: 0.90, batArbitrage: true, batGridExport: false };

// yearScale moet 1 zijn (30 dagen, geen jaarprojectie in harness → expliciet 1)
const noBat = RUN({ rows, epex, cfg: base, eb: 0.11084, yearScale: 1.0 });
const bat = RUN({ rows, epex, cfg: withBat, eb: 0.11084, yearScale: 1.0 });

const saving = noBat.dynamicTotalBill - bat.dynamicTotalBill;
console.log("=== TEST 9: accu-arbitrage dagspread (30 dagen, geen zon) ===");
console.log(`Dynamische rekening ZONDER accu: €${noBat.dynamicTotalBill.toFixed(2)}`);
console.log(`Dynamische rekening MET accu:    €${bat.dynamicTotalBill.toFixed(2)}`);
console.log(`Arbitrage-besparing:             €${saving.toFixed(2)} over 30 dagen`);
console.log(`Import zonder accu ${noBat.totalImportKwh.toFixed(0)} kWh · met accu ${bat.totalImportKwh.toFixed(0)} kWh (laden verhoogt bruto import)`);
console.log(`\n${saving > 0 ? "PASS" : "FAIL"}  Accu verlaagt de dynamische rekening (arbitrage werkt)`);
console.log(`${bat.totalImportKwh > noBat.totalImportKwh ? "PASS" : "FAIL"}  Bruto import stijgt door nachtladen (verwacht — EB op bruto)`);

// Sanity: vast contract is invariant (accu doet daar alleen zelfconsumptie, geen zon hier → niets)
console.log(`${Math.abs(bat.fixedTotalBill - noBat.fixedTotalBill) < 0.01 ? "PASS" : "FAIL"}  Vast contract ongewijzigd (geen zon → accu-zelfconsumptie nul): €${noBat.fixedTotalBill.toFixed(2)} vs €${bat.fixedTotalBill.toFixed(2)}`);
