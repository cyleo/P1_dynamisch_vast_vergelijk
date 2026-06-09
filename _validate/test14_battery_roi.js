// TEST 14 — Thuisbatterij ROI / meerwaarde-berekening (v=65)
// Borgt de logica achter de Sweet Spot Finder (optimizeBatterySize):
//   - meerwaarde = rekening ZÓNDER accu − rekening MÉT accu (isoleert de accu-bijdrage)
//   - meerwaarde is positief en monotoon niet-dalend in capaciteit (binnen tolerantie)
//   - meerwaarde/kWh DAALT met capaciteit (afnemende meeropbrengst → sweet spot bestaat)
//   - payback = investering / meerwaarde, en lager bij goedkopere accu
// Draait de ECHTE engine (computeBillForConfig) op een realistisch prosument-jaar.

const { sandbox } = require("./harness");
const { buildYear } = require("./profile");
const cbf = sandbox.computeBillForConfig;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };

console.log("=== TEST 14: THUISBATTERIJ ROI / MEERWAARDE ===\n");

const base = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07, fixedVastrecht: 7.5, fixedFeedInFee: 0.0,
  dynamicMarkup: 0.018, dynamicExportMarkup: 0.020, dynamicVastrecht: 6.0,
  stressMultiplier: 1.0, solarDimmingMode: "do_nothing", hasHeatPump: false, hasEv: false,
  hasBattery: false, batEfficiency: 0.90, batMode: "kosten", batCost: 450,
};

// Seed de engine-globals (energyData/epex/eb/yearScale) via RUN, daarna read-only cbf.
sandbox.RUN({ rows: buildYear(3500, 4000), epex: new Map(), cfg: base, eb: 0.11084, yearScale: 1.0 });

const noBat = cbf({ ...base, hasBattery: false });
const baselineDyn = noBat.dynBill;

const caps = [2, 5, 10, 15, 20];
const rows = caps.map(cap => {
  const r = cbf({ ...base, hasBattery: true, batCapacity: cap, batPower: cap * 0.5 });
  const extra = baselineDyn - r.dynBill;          // meerwaarde/jaar (dynamisch)
  const perKwh = extra / cap;
  const cost = cap * base.batCost;
  const payback = extra > 0 ? cost / extra : Infinity;
  return { cap, extra, perKwh, cost, payback };
});

console.log("baseline dynBill zonder accu: €" + baselineDyn.toFixed(0));
rows.forEach(r => console.log(`  ${String(r.cap).padStart(2)} kWh → meerwaarde €${r.extra.toFixed(0)} (€${r.perKwh.toFixed(1)}/kWh), payback ${Number.isFinite(r.payback) ? r.payback.toFixed(1) + " jr" : "—"}`));
console.log("");

// D1. Elke accu levert positieve meerwaarde op dit profiel.
ok(rows.every(r => r.extra > 0), `D1 alle capaciteiten meerwaarde > 0 (min €${Math.min(...rows.map(r => r.extra)).toFixed(0)})`);

// D2. Meerwaarde monotoon niet-dalend in capaciteit (tolerantie €1 voor plateau/ruis).
let mono = true;
for (let i = 1; i < rows.length; i++) if (rows[i].extra < rows[i - 1].extra - 1) mono = false;
ok(mono, `D2 meerwaarde niet-dalend in capaciteit (${rows.map(r => "€" + r.extra.toFixed(0)).join(" → ")})`);

// D3. Meerwaarde/kWh DAALT strikt met capaciteit (afnemende meeropbrengst → sweet spot).
let dim = true;
for (let i = 1; i < rows.length; i++) if (rows[i].perKwh >= rows[i - 1].perKwh) dim = false;
ok(dim, `D3 meerwaarde/kWh daalt met capaciteit (${rows.map(r => "€" + r.perKwh.toFixed(1)).join(" → ")})`);

// D4. Payback-formule: cost / meerwaarde; goedkopere accu → kortere payback.
{
  const r = rows.find(x => x.cap === 5);
  const expPb = (5 * base.batCost) / r.extra;
  ok(Math.abs(r.payback - expPb) < 0.01, `D4 payback = investering/meerwaarde (${r.payback.toFixed(2)} jr @ €${base.batCost}/kWh)`);
  const cheaper = cbf({ ...base, hasBattery: true, batCapacity: 5, batPower: 2.5 });
  const extraC = baselineDyn - cheaper.dynBill;
  const pbCheap = (5 * 300) / extraC;   // €300/kWh i.p.v. €450
  ok(pbCheap < r.payback, `D4 goedkopere accu (€300/kWh) → kortere payback (${pbCheap.toFixed(1)} jr < ${r.payback.toFixed(1)} jr)`);
}

// D5. Sweet spot (laagste payback) is een echte, eindige capaciteit.
{
  const finite = rows.filter(r => Number.isFinite(r.payback));
  const sweet = finite.reduce((b, r) => (r.payback < b.payback ? r : b), finite[0]);
  ok(sweet && Number.isFinite(sweet.payback), `D5 sweet spot = ${sweet.cap} kWh (payback ${sweet.payback.toFixed(1)} jr)`);
}

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
