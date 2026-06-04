// TEST 10 — Geherijkte kern-asserties (v=44)
// Voorheen een puur diagnostisch script; nu echte pass/fail-checks.
//   Deel 1: accu-laadvermogen (batPower) wordt gerespecteerd bij zon-opslag.
//   Deel 2: terugleveropbrengst wordt excl. BTW berekend (spot/1.21).
//   Deel 3: het vaste contract is invariant voor de energiebelasting-schuif.
const { RUN } = require("./harness");
const { buildYear } = require("./profile");

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };
const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

const cfgBase = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};
const EB = 0.11084;

console.log("=== TEST 10: GEHERIJKTE KERN-ASSERTIES ===\n");

// ─────────────────────────────────────────────────────────────
// Deel 1 — Accu-laadvermogen (batPower) gerespecteerd bij zon-opslag
// ─────────────────────────────────────────────────────────────
// Eén uur met 10 kWh zon-export; accu 20 kWh / 5 kW. Met genoeg dag-import (avond)
// zodat de dag-opslaglimiet (socCap = min(capaciteit, dag-import)) ruim genoeg is.
// De zon-opslag mag dat uur HOOGUIT batPower (5 kWh) absorberen → export blijft 5 kWh.
{
  const rows = [], epex = new Map();
  const p2 = n => (n < 10 ? "0" + n : "" + n);
  for (let h = 0; h < 24; h++) {
    const dt = new Date(2026, 5, 1, h, 0, 0);
    const isSun = (h === 12);
    const isEve = (h >= 18 && h <= 22);   // 5×4 = 20 kWh dag-import → socCap ruim
    rows.push({
      timestamp: dt.toISOString(),
      import_t1: isEve ? 4.0 : 0, import_t2: 0,
      export_t1: isSun ? 10.0 : 0, export_t2: 0,
      solar_yield: isSun ? 12.0 : 0,
    });
    epex.set(`2026-06-01T${p2(h)}`, isSun ? -0.05 : 0.20);
  }
  const res = RUN({
    rows, epex, eb: EB, yearScale: 1.0,
    cfg: { ...cfgBase, hasBattery: true, batCapacity: 20, batPower: 5, batEfficiency: 1.0, batMode: "zelf" },
  });
  const dk = Object.keys(res.perDayHourly)[0];
  const exp12 = res.perDayHourly[dk][12].expKwh;
  ok(near(exp12, 5.0, 0.05),
     `Deel 1: zon-opslag gecapt op batPower → export-uur 12 = ${exp12.toFixed(2)} kWh (verwacht 5.0, niet 0)`);
}

// ─────────────────────────────────────────────────────────────
// Deel 2 — Terugleveropbrengst excl. BTW (spot/1.21)
// ─────────────────────────────────────────────────────────────
{
  const rowsPV = buildYear(3500, 3500);
  const res = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: EB, yearScale: 1.0 });
  const exclBtw = 77.58;   // referentie excl. BTW (= 93.87 / 1.21)
  ok(near(res.dynamicRawExportRevenue, exclBtw, 0.10),
     `Deel 2: exportopbrengst excl. BTW → €${res.dynamicRawExportRevenue.toFixed(2)} (verwacht €${exclBtw})`);
}

// ─────────────────────────────────────────────────────────────
// Deel 3 — Vast contract invariant voor de EB-schuif
// ─────────────────────────────────────────────────────────────
{
  const rowsPV = buildYear(3500, 3500);
  const a = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.11084, yearScale: 1.0 });
  const b = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.15000, yearScale: 1.0 });
  ok(near(a.fixedTotalBill, b.fixedTotalBill, 0.001),
     `Deel 3: vast invariant voor EB (€${a.fixedTotalBill.toFixed(2)} = €${b.fixedTotalBill.toFixed(2)})`);
  ok(b.dynamicTotalBill > a.dynamicTotalBill,
     `Deel 3: hogere EB → hogere dyn rekening (€${a.dynamicTotalBill.toFixed(2)} → €${b.dynamicTotalBill.toFixed(2)})`);
}

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
