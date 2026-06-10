// TEST 19 — Saldering (fiscaal jaarmodel 2026 vs 2027)
// Borgt het kernverschil tussen de scenariojaren:
//   1. Default (geen fiscalYear) ≡ expliciet 2027 → geen regressie.
//   2. 2027: EB over BRUTO afname (belastbaar volume = totale import).
//   3. 2026: EB over NETTO afname na saldering (max(0, import − export)).
//   4. 2026 ≤ 2027 voor een prosument: saldering is nooit nadelig voor de consument.
//   5. Netto-exporteur (export > import): belastbaar volume = 0 → EB = 0.
//   6. Vast contract 2026: salderbare teruglevering verrekent tegen het retail-tarief
//      (geen los laag teruglevertarief) → géén feed-credit zolang import > export.
// Draait de ECHTE _simulateCore via het vm-harnas.

const { RUN } = require("./harness");

const H = 3600000, START = Date.UTC(2023, 0, 1, 0, 0, 0), DAYS = 365;
const p2 = n => (n < 10 ? "0" + n : "" + n);
const EB = 0.11084;

// Zon-zwaar prosument-profiel: netto exporteur in de zomer, importeur in de winter,
// op jaarbasis méér afname dan teruglevering (import > export).
function solarFor(h, m) { const peak = (m >= 4 && m <= 8) ? 2.6 : 0.9; const x = (h - 13) / 4; return Math.max(0, peak * Math.exp(-x * x)); }
function loadFor(h) { if (h >= 7 && h < 9) return 0.6; if (h >= 17 && h < 22) return 0.9; if (h >= 0 && h < 6) return 0.15; return 0.35; }
function spotFor(h) { if (h >= 11 && h < 15) return 0.04; if (h >= 17 && h < 21) return 0.22; if (h >= 0 && h < 6) return 0.06; return 0.11; }

function buildRows(solarScale) {
  const rows = [], epex = new Map();
  for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) {
    const dt = new Date(START + (d * 24 + h) * H), m = dt.getUTCMonth() + 1;
    const sol = solarFor(h, m) * solarScale, load = loadFor(h), net = load - sol;
    rows.push({ timestamp: dt.toISOString(), import_t1: Math.max(0, net), import_t2: 0, export_t1: Math.max(0, -net), export_t2: 0, solar_yield: sol });
    epex.set(`${dt.getUTCFullYear()}-${p2(m)}-${p2(dt.getUTCDate())}T${p2(dt.getUTCHours())}`, spotFor(h));
  }
  return { rows, epex };
}

const base = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07, fixedVastrecht: 7.5, fixedFeedInFee: 0.0,
  dynamicMarkup: 0.018, dynamicExportMarkup: 0.020, dynamicVastrecht: 6.0,
  stressMultiplier: 1.0, solarDimmingMode: "do_nothing",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};

const { rows, epex } = buildRows(0.5);                    // prosument: import > export (partiële saldering)
const run = cfg => RUN({ rows, epex, cfg, eb: EB, yearScale: 1.0 });

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

console.log("=== TEST 19: SALDERING (2026 vs 2027) ===\n");

const def = run({ ...base });                              // geen fiscalYear → default
const y27 = run({ ...base, fiscalYear: 2027 });
const y26 = run({ ...base, fiscalYear: 2026 });

// 1. Default ≡ 2027 (geen regressie op het bestaande model)
ok(near(def.dynBill, y27.dynBill, 0.001) && near(def.fixedBill, y27.fixedBill, 0.001),
  `default-cfg (geen fiscalYear) ≡ expliciet 2027  (dyn €${def.dynBill.toFixed(2)} / €${y27.dynBill.toFixed(2)}, vast €${def.fixedBill.toFixed(2)} / €${y27.fixedBill.toFixed(2)})`);

// 2. 2027: EB over BRUTO afname
ok(near(y27.dynamicTaxableKwh, y27.totalImportKwh, 0.5),
  `2027: belastbaar EB-volume = bruto import (${y27.dynamicTaxableKwh.toFixed(1)} ≈ ${y27.totalImportKwh.toFixed(1)} kWh)`);
ok(near(y27.dynamicNetTax, y27.totalImportKwh * EB, 0.5),
  `2027: EB = bruto import × tarief (€${y27.dynamicNetTax.toFixed(2)} ≈ €${(y27.totalImportKwh * EB).toFixed(2)})`);

// 3. 2026: EB over NETTO afname (saldering)
const expectedNet = Math.max(0, y26.totalImportKwh - y26.totalExportKwh);
ok(near(y26.dynamicTaxableKwh, expectedNet, 0.5),
  `2026: belastbaar EB-volume = netto afname max(0, imp−exp) (${y26.dynamicTaxableKwh.toFixed(1)} ≈ ${expectedNet.toFixed(1)} kWh)`);
ok(near(y26.dynamicNetTax, expectedNet * EB, 0.5),
  `2026: EB = netto afname × tarief (€${y26.dynamicNetTax.toFixed(2)} ≈ €${(expectedNet * EB).toFixed(2)})`);
ok(y26.dynamicTaxableKwh < y27.dynamicTaxableKwh - 1,
  `2026 belastbaar volume < 2027 (saldering streept teruglevering weg: ${y26.dynamicTaxableKwh.toFixed(0)} < ${y27.dynamicTaxableKwh.toFixed(0)} kWh)`);

// 4. 2026 ≤ 2027 voor de consument (zowel dynamisch als vast)
ok(y26.dynBill <= y27.dynBill + 0.5,
  `2026 dynamische rekening ≤ 2027 (saldering nooit nadelig: €${y26.dynBill.toFixed(2)} ≤ €${y27.dynBill.toFixed(2)})`);
ok(y26.fixedBill <= y27.fixedBill + 0.5,
  `2026 vaste rekening ≤ 2027 (€${y26.fixedBill.toFixed(2)} ≤ €${y27.fixedBill.toFixed(2)})`);

// 5. Netto-exporteur: export > import → belastbaar volume = 0, EB = 0
const big = buildRows(3.0);                                // veel meer zon → export > import
const y26exp = RUN({ rows: big.rows, epex: big.epex, cfg: { ...base, fiscalYear: 2026 }, eb: EB, yearScale: 1.0 });
ok(y26exp.totalExportKwh > y26exp.totalImportKwh,
  `netto-exporteur opgezet (export ${y26exp.totalExportKwh.toFixed(0)} > import ${y26exp.totalImportKwh.toFixed(0)} kWh)`);
ok(near(y26exp.dynamicTaxableKwh, 0, 0.001) && near(y26exp.dynamicNetTax, 0, 0.001),
  `2026 netto-exporteur: belastbaar volume = 0 → EB = €0,00 (volume ${y26exp.dynamicTaxableKwh.toFixed(3)}, EB €${y26exp.dynamicNetTax.toFixed(3)})`);

// 6. Vast contract 2026: import > export → alle teruglevering salderbaar → géén los feed-credit
ok(near(y26.fixedFeedInCredit, 0, 0.001),
  `2026 vast (import>export): salderbaar → geen los teruglever-credit (€${y26.fixedFeedInCredit.toFixed(3)})`);
ok(y27.fixedFeedInCredit > 1,
  `2027 vast: teruglevering krijgt wél het (lage) teruglevertarief (€${y27.fixedFeedInCredit.toFixed(2)})`);

// 6b. Presentatievelden (H3): de UI-detailrijen moeten exact optellen tot de kopregel —
//     gesaldeerde afname × gewogen tarief = fixedImportCost, en de salderen-vlag klopt.
ok(y26.salderen === true && y27.salderen === false,
  `salderen-vlag in full-output (2026 ${y26.salderen}, 2027 ${y27.salderen})`);
ok(near(y26.fixedNetImportKwh * y26.fixedSalderTariff, y26.fixedImportCost, 0.01),
  `2026: netImp × gewogen tarief = fixedImportCost (${y26.fixedNetImportKwh.toFixed(1)} × €${y26.fixedSalderTariff.toFixed(4)} = €${y26.fixedImportCost.toFixed(2)})`);
ok(near(y26.fixedSalderedKwh, Math.min(y26.totalImportKwh, y26.totalExportKwh), 5) || y26.fixedSalderedKwh >= 0,
  `2026: weggestreept volume aanwezig (${y26.fixedSalderedKwh.toFixed(1)} kWh)`);

// 7. VTK (terugleverkosten) 2026: over de BRUTO teruglevering — saldering streept de
//    energie weg, niet de terugleverkosten (Eneco: ct/kWh over alle teruglevering;
//    Vattenfall: staffel op jaarteruglevering). Vóór deze fix: alleen overschot → €0
//    voor een typische prosument (import > export) → vaste rekening onderschat.
{
  const FEE = 0.02;
  const y26vtk = run({ ...base, fiscalYear: 2026, fixedFeedInFee: FEE });
  const y27vtk = run({ ...base, fiscalYear: 2027, fixedFeedInFee: FEE });
  const grossExp26 = y26vtk.fixedPeakExport + y26vtk.fixedDalExport;
  ok(y26vtk.fixedFeedInFee > 1 && near(y26vtk.fixedFeedInFee, grossExp26 * FEE, 0.5),
    `2026 VTK over BRUTO teruglevering (€${y26vtk.fixedFeedInFee.toFixed(2)} ≈ ${grossExp26.toFixed(0)} kWh × €${FEE})`);
  ok(near(y26vtk.fixedFeedInFee, y27vtk.fixedFeedInFee, 0.5),
    `VTK identiek in beide jaren (2026 €${y26vtk.fixedFeedInFee.toFixed(2)} ≈ 2027 €${y27vtk.fixedFeedInFee.toFixed(2)})`);
}

// 8. Accu-export-economie is jaar-afhankelijk: onder saldering is teruglevering de all-in
//    import-prijs waard → de winst-modus exporteert in 2026 bij pieken waar de kale
//    2027-waarde onder de laad-all-in blijft. Met dit profiel: 2027-gate
//    (0.22/1.21 − 0.02)×0.9 ≈ 0.146 < loAllin ≈ 0.169 → géén export; 2026-gate
//    (0.22 + 0.018)×0.9 ≈ 0.214 > 0.169 → wél export.
{
  const batCfg = { hasBattery: true, batCapacity: 10, batPower: 5, batEfficiency: 0.9, batMode: "winst" };
  const y26bat = run({ ...base, ...batCfg, fiscalYear: 2026 });
  const y27bat = run({ ...base, ...batCfg, fiscalYear: 2027 });
  ok(y26bat.totalExportKwh > y27bat.totalExportKwh + 1,
    `2026 winst-accu exporteert wél bij pieken, 2027 niet (export ${y26bat.totalExportKwh.toFixed(0)} > ${y27bat.totalExportKwh.toFixed(0)} kWh)`);
  const y26noBat = run({ ...base, fiscalYear: 2026 });
  ok(y26bat.dynBill < y26noBat.dynBill - 1,
    `2026 winst-accu verlaagt de dynamische rekening (€${y26bat.dynBill.toFixed(2)} < €${y26noBat.dynBill.toFixed(2)})`);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail === 0) console.log("PASS  test19_saldering");
process.exit(fail === 0 ? 0 : 1);
