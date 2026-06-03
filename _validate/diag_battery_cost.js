// Diagnose: kan de accu de DYNAMISCHE rekening verhogen? Zonneprosument, jaar.
const { RUN } = require("./harness");
const H = 3600000;
const START = Date.UTC(2026, 0, 1, 0, 0, 0);
const DAYS = 120;
const p2 = n => (n < 10 ? "0" + n : "" + n);

// Realistisch zonprofiel: zon overdag, verbruik ochtend/avond.
function solarFor(h, m) {
  // zomerse boog rond 13u; schaal per maand
  const peak = (m >= 4 && m <= 8) ? 2.5 : 1.2;
  const x = (h - 13) / 4;
  return Math.max(0, peak * Math.exp(-x * x));
}
function loadFor(h) {
  if (h >= 7 && h < 9) return 0.6;
  if (h >= 17 && h < 22) return 0.9;
  if (h >= 0 && h < 6) return 0.15;
  return 0.35;
}
// EPEX: zonne-uren goedkoop/negatief, avondpiek duur.
function spotFor(h) {
  if (h >= 11 && h < 15) return -0.02;
  if (h >= 17 && h < 21) return 0.22;
  if (h >= 0 && h < 6) return 0.06;
  return 0.11;
}

const rows = [], epex = new Map();
for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) {
  const ms = START + (d * 24 + h) * H;
  const dt = new Date(ms);
  const m = dt.getMonth() + 1;
  const sol = solarFor(h, m), load = loadFor(h);
  const net = load - sol;
  rows.push({
    timestamp: dt.toISOString(),
    import_t1: Math.max(0, net), import_t2: 0,
    export_t1: Math.max(0, -net), export_t2: 0,
    solar_yield: sol,
  });
  const key = `${dt.getFullYear()}-${p2(m)}-${p2(dt.getDate())}T${p2(dt.getHours())}`;
  epex.set(key, spotFor(h));
}

const base = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07, fixedVastrecht: 7.5, fixedFeedInFee: 0.0,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.0, stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};

function run(cfg) { return RUN({ rows, epex, cfg, eb: 0.11084, yearScale: 1.0 }); }

const noBat = run(base);
console.log(`Geen accu:        DYN €${noBat.dynamicTotalBill.toFixed(2)} · import ${noBat.totalImportKwh.toFixed(0)} kWh · export ${noBat.totalExportKwh.toFixed(0)} kWh`);

for (const arb of [false, true]) {
  console.log(`\n--- arbitrage=${arb} ---`);
  for (const cap of [5, 10, 20]) {
    const cfg = { ...base, hasBattery: true, batCapacity: cap, batPower: cap * 0.5, batEfficiency: 0.90, batArbitrage: arb, batGridExport: false };
    const r = run(cfg);
    const delta = r.dynamicTotalBill - noBat.dynamicTotalBill;
    console.log(`  accu ${String(cap).padStart(2)} kWh: DYN €${r.dynamicTotalBill.toFixed(2)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}) · import ${r.totalImportKwh.toFixed(0)} · export ${r.totalExportKwh.toFixed(0)}`);
  }
}
