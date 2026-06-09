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
  stressMultiplier: 1.0, solarDimmingMode: "do_nothing",
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

// B2b. Terugleveropbrengst met opslag (Pad 1, conventie A): de slider is incl. BTW en
//      wordt RECHTSTREEKS van de kale prijs afgetrokken. Bij kale spot €0.10 en opslag
//      €0.020 incl. BTW is de opbrengst 0.10 − 0.020 = €0.080/kWh.
{
  const { rows, epex } = buildDay({ exp: 1, solar: 1 }, 0.121);   // kale spot = 0.121/1.21 = 0.10
  const res = RUN({ rows, epex, cfg: { ...cfgBase, dynamicExportMarkup: 0.020 }, eb: EB, yearScale: 1.0 });
  ok(near(res.dynamicRawExportRevenue, 24 * 1 * 0.080, 0.01),
     `B2b export-opbrengst met opslag = spot/1.21 − markup (€${res.dynamicRawExportRevenue.toFixed(3)} ≈ €1.92 voor 24 kWh)`);
}

// B2c. PIN van de teruglever-opslag-conventie (Pad 1, v=66): de effectieve aftrek op de
//      KALE prijs is exact de slider-waarde (incl. BTW, rechtstreeks). Borgt dat een
//      refactor deze keuze niet stil omdraait.
{
  const day = buildDay({ exp: 1, solar: 1 }, 0.121);
  const m = 0.0248;   // bv. Tibber-terugleverkosten incl. BTW
  const noMk = RUN({ rows: day.rows, epex: day.epex, cfg: { ...cfgBase, dynamicExportMarkup: 0 }, eb: EB, yearScale: 1.0 });
  const wMk  = RUN({ rows: day.rows, epex: day.epex, cfg: { ...cfgBase, dynamicExportMarkup: m }, eb: EB, yearScale: 1.0 });
  const deductPerKwh = (noMk.dynamicRawExportRevenue - wMk.dynamicRawExportRevenue) / 24;
  ok(near(deductPerKwh, m, 0.0005),
     `B2c aftrek op kale prijs = slider-waarde rechtstreeks (€${deductPerKwh.toFixed(4)}/kWh voor markup €${m})`);
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
  // Vaste (niet-geschaalde) posten = vastrecht ×12 - heffingskorting + netbeheerkosten.
  const gridFees = y1.gridFees ?? 480.00;
  const dynFixed = 6.00 * 12 - (y1.taxRebate ?? 0) + gridFees;
  const fxFixed = 7.50 * 12 - (y1.taxRebate ?? 0) + gridFees;
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
  // Reconstrueer: dyn-totaal = energie + EB + vastrecht − korting + netbeheerkosten.
  const gridFees = res.gridFees ?? 480.00;
  const dynRecon = (res.dynamicRawImportCost - res.dynamicRawExportRevenue) + res.dynamicNetTax + res.dynamicSubscription - res.taxRebate + gridFees;
  ok(near(dynRecon, res.dynamicTotalBill, 0.01), `B6 dyn-totaal bevat korting-aftrek (recon €${dynRecon.toFixed(2)} = €${res.dynamicTotalBill.toFixed(2)})`);
}

// B7. Netbeheerkosten (NETBEHEER_2026) worden bij BEIDE totalen opgeteld → comparison-
//     neutraal, maar verschijnen in de absolute jaartotalen. Borg: vast-reconstructie + het
//     verschil (vast − dyn) is invariant voor het al-of-niet meerekenen van netbeheer.
{
  const rowsPV = buildYear(3500, 3500);
  const res = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: EB, yearScale: 1.0 });
  const gridFees = res.gridFees ?? 0;
  ok(near(gridFees, 480.00, 0.01), `B7 netbeheerkosten = €480,00 (2026) → €${gridFees.toFixed(2)}`);
  const fxRecon = res.fixedImportCost - res.fixedFeedInCredit + res.fixedFeedInFee
    + res.fixedSubscription - res.taxRebate + gridFees;
  ok(near(fxRecon, res.fixedTotalBill, 0.01), `B7 vast-totaal bevat netbeheer (recon €${fxRecon.toFixed(2)} = €${res.fixedTotalBill.toFixed(2)})`);
  // Comparison-neutraal: het verschil zonder netbeheer in beide = met netbeheer in beide.
  const diffWith = res.fixedTotalBill - res.dynamicTotalBill;
  const diffWithout = (res.fixedTotalBill - gridFees) - (res.dynamicTotalBill - gridFees);
  ok(near(diffWith, diffWithout, 0.001), `B7 netbeheer valt weg in het verschil (€${diffWith.toFixed(2)})`);
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

// C2. REGRESSIEWACHT (CB-1): de warmtepomp én een zonne-ladende EV mogen niet DEZELFDE
//     zon claimen. Energiebehoud: als de WP alle zon opeet, moet de zonne-EV zijn volledige
//     dagbehoefte alsnog van het net halen. Vóór de fix klemde de EV-injectie het zon-tekort
//     stil weg (expDyn = max(0, …)) zonder het als net-afname te verrekenen → EV-vraag
//     verdween → onderschat bruto import + EB. Toen verhoogde +EV de import met ~0 kWh.
{
  const { rows, epex } = buildDay({ imp: 0, exp: 1, solar: 1 }, 0.10);
  const hpCfg = { ...cfgBase, hasHeatPump: true, hpWinterBaseload: 10.0 };   // eet alle zon (≥1 kWh/u)
  const evExtra = { hasEv: true, evWeeklyDist: 70, evConsumption: 0.2, evSolarMatch: true, evProfile: "home" };
  const hp   = RUN({ rows, epex, cfg: hpCfg, eb: EB, yearScale: 1.0 });
  const hpEv = RUN({ rows, epex, cfg: { ...hpCfg, ...evExtra }, eb: EB, yearScale: 1.0 });
  const evDailyKwh = 70 * 0.2 / 7;   // 2.0 kWh/dag
  const dImp = hpEv.totalImportKwh - hp.totalImportKwh;
  ok(near(dImp, evDailyKwh, 0.05),
     `C2 WP+EV claimen niet dezelfde zon: +EV verhoogt import met ${dImp.toFixed(2)} kWh ≈ EV-behoefte ${evDailyKwh.toFixed(2)} (energiebehoud)`);
}

// C3. REGRESSIEWACHT: zonnedimmen mag de dynamische rekening NOOIT verhogen t.o.v. niets
//     doen. Bug (gevonden bij handmatig testen): de "uit"-modus trok bij ÉLKE negatieve spot
//     de hele huis-last naar het net (dynImp = currentHouseLoad). Bij gematigd-negatieve
//     prijzen kost net-import echter nog steeds geld (EB-vloer: spot + opslag + EB > 0), dus
//     gratis zelfverbruik is goedkoper. Met een zonne-ladende EV in die uren verhoogde "uit"
//     daardoor de rekening — logisch onmogelijk. Fix: zelfverbruik alleen wegnemen als de
//     all-in importprijs zélf negatief is. Dit borgt de invariant dat dimmen ≤ niets doen,
//     juist in de hardware-interactie (EV) die de totalen-only suite eerder niet ving.
{
  // Dag met gematigd-negatieve middag-spot (−0.05): spot < 0, maar all-in (+opslag+EB) > 0.
  // Middag zon-overschot dat de zonne-ladende EV oppikt; rest van de dag gewone afname.
  const p2 = n => (n < 10 ? "0" + n : "" + n);
  const rows = [], epex = new Map();
  for (let h = 0; h < 24; h++) {
    const dt = new Date(2026, 5, 1, h, 0, 0);
    const midday = h >= 10 && h <= 15;
    rows.push({
      timestamp: dt.toISOString(),
      import_t1: midday ? 0 : 0.5, import_t2: 0,
      export_t1: midday ? 3 : 0, export_t2: 0,
      solar_yield: midday ? 4 : 0,
    });
    // Net-negatieve middag-spot (−0.01): all-in blijft ruim positief (−0.01+opslag+EB ≈ 0.12),
    // dus de buggy "uit" zou zelfverbruik (incl. EV-zon) tegen 0.12/kWh naar het net duwen,
    // terwijl de vermeden export-boete (≈0.008/kWh) verwaarloosbaar is → bug domineert helder.
    epex.set(`2026-06-01T${p2(h)}`, midday ? -0.01 : 0.10);
  }
  const evCfg = { hasEv: true, evWeeklyDist: 70, evConsumption: 0.2, evSolarMatch: true, evProfile: "home" };
  const off = RUN({ rows, epex, cfg: { ...cfgBase, ...evCfg, solarDimmingMode: "do_nothing" }, eb: EB, yearScale: 1.0 });
  const uit = RUN({ rows, epex, cfg: { ...cfgBase, ...evCfg, solarDimmingMode: "turn_off" }, eb: EB, yearScale: 1.0 });
  const dim = RUN({ rows, epex, cfg: { ...cfgBase, ...evCfg, solarDimmingMode: "dim" }, eb: EB, yearScale: 1.0 });
  ok(uit.dynamicTotalBill <= off.dynamicTotalBill + 0.001,
     `C3 dimmen "uit" ≤ niets doen, ook met zonne-EV (€${uit.dynamicTotalBill.toFixed(2)} ≤ €${off.dynamicTotalBill.toFixed(2)})`);
  ok(dim.dynamicTotalBill <= off.dynamicTotalBill + 0.001,
     `C3 dimmen "dim" ≤ niets doen (€${dim.dynamicTotalBill.toFixed(2)} ≤ €${off.dynamicTotalBill.toFixed(2)})`);
  ok(near(uit.fixedTotalBill, off.fixedTotalBill, 0.001) && near(dim.fixedTotalBill, off.fixedTotalBill, 0.001),
     `C3 dimmen raakt het vaste contract NIET (€${off.fixedTotalBill.toFixed(2)})`);
}

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
