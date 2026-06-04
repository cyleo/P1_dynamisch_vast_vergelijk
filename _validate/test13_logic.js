// TEST 13 — Logische & fiscale sanity-checks (v=44)
// Vult de bestaande suite aan op twee fronten:
//   A. Digital-Twin ontwarring — randgevallen die test12 niet dekt
//      (gelijktijdige import+export zonder apparaten = REGRESSIEWACHT, zon onaangeroerd,
//       interne overdracht heft op, zon-gevoede consument strippen verhoogt export,
//       register-behoud).
//   B. Engine fiscaal model 2027 — borgt de kernregels tegen NL-bronnen:
//      EB op BRUTO afname (saldering eindigt 1-1-2027), terugleveropbrengst = kale spot
//      (excl. EB én BTW), vast contract invariant voor de EB-schuif, stresstest raakt
//      alléén dynamisch, jaarschaling lineair, vastrecht op jaarbasis.
// Plus informatieve diagnostiek (geen pass/fail) voor twee bekende beperkingen.

const { RUN, sandbox } = require("./harness");
const { buildYear } = require("./profile");
const processHAStatistics = sandbox.processHAStatistics;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };
const near = (a, b, tol = 0.001) => Math.abs(a - b) < tol;

console.log("=== TEST 13: LOGISCHE & FISCALE SANITY-CHECKS ===\n");

// ── Helper: één-uurs ontwarring via processHAStatistics ──
const ROLE = {
  imp1: "i1", imp2: "i2", exp1: "e1", exp2: "e2", solar: "sol", solarUnit: "kWh",
  ev: "ev", evUnit: "kWh", hp: "hp", hpUnit: "kWh",
  batIn: "bi", batInUnit: "kWh", batOut: "bo", batOutUnit: "kWh",
};
function untangle(inp, role = ROLE) {
  const stats = {};
  const add = (r, v) => { const id = role[r]; if (id) stats[id] = [{ start: 0, sum: 0 }, { start: 3600000, sum: v }]; };
  add("imp1", inp.imp1 ?? 0); add("imp2", inp.imp2 ?? 0);
  add("exp1", inp.exp1 ?? 0); add("exp2", inp.exp2 ?? 0);
  add("ev", inp.ev ?? 0); add("hp", inp.hp ?? 0);
  add("batIn", inp.batIn ?? 0); add("batOut", inp.batOut ?? 0);
  add("solar", inp.solar ?? 0);
  return processHAStatistics(stats, role);
}

// ─────────────────────────────────────────────────────────────
console.log("--- A. Digital-Twin ontwarring (aanvullend op test12) ---");

// A1. REGRESSIEWACHT: zonder gekoppelde apparaten mag een uur met gelijktijdige
//     import én export (sub-uur, wolkenflarden) NIET gesaldeerd worden. Anders
//     verdwijnt bruto import/export → onderschat EB (2027 = EB op bruto).
{
  const NONE = { imp1: "i1", imp2: "i2", exp1: "e1", exp2: "e2", solar: null,
                 ev: null, hp: null, batIn: null, batOut: null };
  const r = untangle({ imp1: 0.3, exp1: 1.2 }, NONE)[0];
  ok(near(r.import_t1 + r.import_t2, 0.3), `A1 geen apparaten: bruto import behouden (0.3) → ${ (r.import_t1+r.import_t2).toFixed(3) }`);
  ok(near(r.export_t1 + r.export_t2, 1.2), `A1 geen apparaten: bruto export behouden (1.2) → ${ (r.export_t1+r.export_t2).toFixed(3) }`);
}

// A2. Apparaat-stripping mag de gemeten zonopbrengst NOOIT aanraken.
{
  const r = untangle({ imp1: 0, exp1: 0, ev: 3, solar: 4 })[0];
  ok(near(r.solar_yield, 4), `A2 solar_yield onaangeroerd door EV-strip → ${r.solar_yield}`);
}

// A3. Interne overdracht heft op: EV laadt uit de accu (ev=3, batOut=3) → baseNet 0,
//     geen dubbeltelling.
{
  const r = untangle({ imp1: 0, exp1: 0, ev: 3, batOut: 3 })[0];
  ok(near(r.import_t1, 0) && near(r.export_t1, 0), `A3 interne overdracht (EV uit accu) heft op → imp ${r.import_t1}, exp ${r.export_t1}`);
}

// A4. Een zon-gevoede consument strippen MOET de export verhogen (net-space kan dit,
//     import-space niet): ruwe export 1, EV at 2 kWh uit de zon → baseExport 3.
{
  const r = untangle({ imp1: 0, exp1: 1, ev: 2 })[0];
  ok(near(r.export_t1, 3), `A4 zon-gevoede EV strippen verhoogt export (1 → 3) → ${r.export_t1}`);
}

// A5. Warmtepomp 's nachts (geen zon): ruwe import 2 = puur WP → baseImport 0.
{
  const r = untangle({ imp1: 2, hp: 2 })[0];
  ok(near(r.import_t1, 0), `A5 WP-strip 's nachts: baseImport 0 → ${r.import_t1}`);
}

// A6. Zonder apparaten blijven de t1/t2-registers gescheiden (niet platgeslagen).
{
  const NONE = { imp1: "i1", imp2: "i2", exp1: "e1", exp2: "e2", solar: null,
                 ev: null, hp: null, batIn: null, batOut: null };
  const r = untangle({ imp1: 1.0, imp2: 0.5 }, NONE)[0];
  ok(near(r.import_t1, 1.0) && near(r.import_t2, 0.5), `A6 registers behouden zonder apparaten → t1 ${r.import_t1}, t2 ${r.import_t2}`);
}

// ─────────────────────────────────────────────────────────────
console.log("\n--- B. Engine fiscaal model 2027 ---");

const cfgBase = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};
const EB = 0.11084;

// Bouw een dagreeks (24 u) met expliciete EPEX-keys (lokale YYYY-MM-DDTHH).
function buildDay(perHour, spotInclBtw) {
  const rows = [], epex = new Map();
  const p2 = n => (n < 10 ? "0" + n : "" + n);
  for (let h = 0; h < 24; h++) {
    const dt = new Date(2026, 5, 1, h, 0, 0);   // 1 juni 2026 (weekdag — ma)
    rows.push({
      timestamp: dt.toISOString(),
      import_t1: perHour.imp ?? 0, import_t2: 0,
      export_t1: perHour.exp ?? 0, export_t2: 0,
      solar_yield: perHour.solar ?? 0,
    });
    if (spotInclBtw !== undefined) epex.set(`2026-06-01T${p2(h)}`, spotInclBtw);
  }
  return { rows, epex };
}

// B1. EB op BRUTO afname, niet netto (saldering eindigt 1-1-2027).
{
  const rowsPV = buildYear(3500, 3500);
  const res = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: EB, yearScale: 1.0 });
  ok(near(res.dynamicNetTax, res.totalImportKwh * EB, 0.01),
     `B1 EB = bruto import × tarief (€${res.dynamicNetTax.toFixed(2)} = ${res.totalImportKwh.toFixed(0)}kWh × ${EB})`);
  // Bewijs dat het BRUTO is en niet netto: EB > wat netto (imp-exp) zou opleveren.
  const ebNetto = res.netDynamicKwh * EB;
  ok(res.dynamicNetTax > ebNetto + 1,
     `B1 EB(bruto €${res.dynamicNetTax.toFixed(2)}) >> EB-als-netto (€${ebNetto.toFixed(2)}) → geen saldering`);
}

// B2. Terugleveropbrengst = kale spot (excl. EB én BTW): bij vlakke spot 0.121 incl. BTW
//     is de opbrengst 0.121/1.21 = €0.10/kWh.
{
  const { rows, epex } = buildDay({ exp: 1, solar: 1 }, 0.121);
  const res = RUN({ rows, epex, cfg: cfgBase, eb: EB, yearScale: 1.0 });
  ok(near(res.dynamicRawExportRevenue, 24 * 1 * (0.121 / 1.21), 0.01),
     `B2 export-opbrengst = spot/1.21 (€${res.dynamicRawExportRevenue.toFixed(3)} ≈ €2.40 voor 24 kWh)`);
}

// B3. Vast contract is invariant voor de EB-schuif (EB raakt alléén dynamisch).
{
  const rowsPV = buildYear(3500, 3500);
  const a = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.11084, yearScale: 1.0 });
  const b = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.15000, yearScale: 1.0 });
  ok(near(a.fixedTotalBill, b.fixedTotalBill, 0.001),
     `B3 vast invariant voor EB (€${a.fixedTotalBill.toFixed(2)} = €${b.fixedTotalBill.toFixed(2)})`);
  ok(b.dynamicTotalBill > a.dynamicTotalBill,
     `B3 hogere EB → hogere dyn rekening (€${a.dynamicTotalBill.toFixed(2)} → €${b.dynamicTotalBill.toFixed(2)})`);
}

// B4. Stresstest verhoogt alléén het dynamische bedrag (positieve spot ×factor).
{
  const { rows, epex } = buildDay({ imp: 1 }, 0.10);
  const s1 = RUN({ rows, epex, cfg: { ...cfgBase, stressMultiplier: 1.0 }, eb: EB, yearScale: 1.0 });
  const s2 = RUN({ rows, epex, cfg: { ...cfgBase, stressMultiplier: 3.0 }, eb: EB, yearScale: 1.0 });
  ok(s2.dynamicTotalBill > s1.dynamicTotalBill,
     `B4 stress 3× verhoogt dyn (€${s1.dynamicTotalBill.toFixed(2)} → €${s2.dynamicTotalBill.toFixed(2)})`);
  ok(near(s1.fixedTotalBill, s2.fixedTotalBill, 0.001),
     `B4 stress raakt vast NIET (€${s1.fixedTotalBill.toFixed(2)} = €${s2.fixedTotalBill.toFixed(2)})`);
}

// B5. Jaarschaling is lineair op energie, vastrecht blijft op jaarbasis (×12).
{
  const { rows, epex } = buildDay({ imp: 1 }, 0.10);
  const y1 = RUN({ rows, epex, cfg: cfgBase, eb: EB, yearScale: 1.0 });
  const y2 = RUN({ rows, epex, cfg: cfgBase, eb: EB, yearScale: 2.0 });
  // Vaste (niet-geschaalde) posten = vastrecht ×12 + heffingskorting.
  const dynFixed = 6.00 * 12 - (y1.taxRebate ?? 0);
  const fxFixed = 7.50 * 12 - (y1.taxRebate ?? 0);
  ok(near(y2.dynamicTotalBill - dynFixed, 2 * (y1.dynamicTotalBill - dynFixed), 0.02),
     `B5 dyn energie schaalt ×2 (excl. vaste posten): €${(y1.dynamicTotalBill-dynFixed).toFixed(2)} → €${(y2.dynamicTotalBill-dynFixed).toFixed(2)}`);
  ok(near(y2.fixedTotalBill - fxFixed, 2 * (y1.fixedTotalBill - fxFixed), 0.02),
     `B5 vast energie schaalt ×2 (excl. vaste posten)`);
  ok(near(y1.dynamicSubscription, 72) && near(y1.fixedSubscription, 90),
     `B5 vastrecht op jaarbasis ×12 (dyn €${y1.dynamicSubscription}, vast €${y1.fixedSubscription})`);
}

// B6. Heffingskorting (EB-vermindering) wordt van BEIDE rekeningen afgetrokken, identiek
//     bedrag → comparison-neutraal (verschil ongewijzigd), maar totalen ~€629 lager.
{
  const rowsPV = buildYear(3500, 3500);
  const res = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: EB, yearScale: 1.0 });
  ok(near(res.taxRebate, 628.96, 0.01), `B6 heffingskorting = €628,96 (2026) → €${(res.taxRebate ?? 0).toFixed(2)}`);
  // Reconstrueer: dyn-totaal = energie + EB + vastrecht − korting.
  const dynRecon = (res.dynamicRawImportCost - res.dynamicRawExportRevenue) + res.dynamicNetTax + res.dynamicSubscription - res.taxRebate;
  ok(near(dynRecon, res.dynamicTotalBill, 0.01), `B6 dyn-totaal bevat korting-aftrek (recon €${dynRecon.toFixed(2)} = €${res.dynamicTotalBill.toFixed(2)})`);
}

// ─────────────────────────────────────────────────────────────
console.log("\n--- C. Geborgde fixes (voorheen beperkingen) ---");

// C1. Warmtepomp consumeert éérst zonoverschot (net als de EV), niet puur import.
//     In een uur met zon-overschot dat groter is dan de WP-last mag de import NIET stijgen;
//     in plaats daarvan daalt de export (de WP eet de zon op).
{
  const { rows, epex } = buildDay({ imp: 0, exp: 2, solar: 2 }, 0.10);
  const noHp = RUN({ rows, epex, cfg: cfgBase, eb: EB, yearScale: 1.0 });
  const wHp  = RUN({ rows, epex, cfg: { ...cfgBase, hasHeatPump: true, hpWinterBaseload: 1.0 }, eb: EB, yearScale: 1.0 });
  ok(near(wHp.totalImportKwh, noHp.totalImportKwh, 0.01),
     `C1 WP eet zon i.p.v. te importeren: import blijft ${wHp.totalImportKwh.toFixed(2)} kWh (geen kunstmatige bruto-import)`);
  ok(wHp.totalExportKwh < noHp.totalExportKwh - 0.5,
     `C1 WP-zonconsumptie verlaagt export (${noHp.totalExportKwh.toFixed(1)} → ${wHp.totalExportKwh.toFixed(1)} kWh)`);
}

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
