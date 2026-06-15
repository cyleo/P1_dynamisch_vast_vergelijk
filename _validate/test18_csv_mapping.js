// TEST 18 — CSV sensor-koppeling (long-format HA-historie-export).
// Borgt dat een gebruiker met EIGEN sensornamen (niet de demo-namen) zijn sensoren kan
// koppelen: (1) de auto-gok `guessRolesFromEntities` herkent gangbare NL/EN-namen, en
// (2) `parseHAHistoryExportCSV` levert correcte records voor een willekeurige roleMap
// (het ding dat de koppelmodal teruggeeft). Vóór deze fix viel het long-format-pad stil
// terug op DEMO_ROLEMAP → bij afwijkende namen kwam er niets binnen.
const { sandbox } = require("./harness");

const guess = sandbox.window.guessRolesFromEntities;
const parse = sandbox.parseHAHistoryExportCSV;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };

console.log("=== TEST 18: CSV SENSOR-KOPPELING (eigen sensornamen) ===\n");

// ── (1) Auto-gok herkent eigen/afwijkende sensornamen ──────────────────────────
const entities = [
  "sensor.mijn_p1_import_tariff_1",
  "sensor.mijn_p1_import_tariff_2",
  "sensor.mijn_p1_export_tariff_1",
  "sensor.mijn_p1_export_tariff_2",
  "sensor.groeizon_omvormer_pv_productie",
  "sensor.altherma_warmtepomp_verbruik",
  "sensor.myenergi_zappi_laadpaal_sessie",
];
const g = guess(entities);
ok(g.imp1 === "sensor.mijn_p1_import_tariff_1", `gok imp1 → ${g.imp1}`);
ok(g.imp2 === "sensor.mijn_p1_import_tariff_2", `gok imp2 → ${g.imp2}`);
ok(g.exp1 === "sensor.mijn_p1_export_tariff_1", `gok exp1 → ${g.exp1}`);
ok(g.exp2 === "sensor.mijn_p1_export_tariff_2", `gok exp2 → ${g.exp2}`);
ok(g.solar === "sensor.groeizon_omvormer_pv_productie", `gok solar → ${g.solar}`);
ok(g.hp === "sensor.altherma_warmtepomp_verbruik", `gok hp → ${g.hp}`);
ok(g.ev === "sensor.myenergi_zappi_laadpaal_sessie", `gok ev → ${g.ev}`);

// ── (2) Parser werkt met een WILLEKEURIGE (eigen) roleMap ──────────────────────
// Bouw een lange HA-export: cumulatieve meterstanden, 1 kWh import & 0,5 kWh export per uur.
const IMP = "sensor.mijn_p1_import_tariff_1";
const EXP = "sensor.mijn_p1_export_tariff_1";
const rows = ["entity_id,state,last_changed"];
for (let h = 0; h <= 6; h++) {
  const ts = `2026-01-01T${String(h).padStart(2, "0")}:00:00`;
  rows.push(`${IMP},${h},${ts}`);          // cumulatief 0,1,2,…,6 → delta 1/uur
  rows.push(`${EXP},${(h * 0.5).toFixed(2)},${ts}`); // cumulatief → delta 0,5/uur
}
const sep = ",";
const headers = rows[0].split(sep);

// De roleMap zoals de koppelmodal die zou teruggeven (rol → eigen entity_id), géén demo-namen.
const userRoleMap = {
  imp1: IMP, imp2: "", exp1: EXP, exp2: "", solar: "",
  solarUnit: "kWh", evUnit: "kWh", hpUnit: "kWh", batInUnit: "kWh", batOutUnit: "kWh",
};

const records = parse(rows, sep, headers, userRoleMap, true);
const totImp = records.reduce((s, r) => s + (r.import_t1 || 0) + (r.import_t2 || 0), 0);
const totExp = records.reduce((s, r) => s + (r.export_t1 || 0) + (r.export_t2 || 0), 0);

ok(Array.isArray(records) && records.length >= 5, `parser levert records (${records.length})`);
ok(Math.abs(totImp - 6) < 0.01, `import-delta's kloppen (Σ=${totImp.toFixed(2)} kWh, verwacht 6)`);
ok(Math.abs(totExp - 3) < 0.01, `export-delta's kloppen (Σ=${totExp.toFixed(2)} kWh, verwacht 3)`);

// Controle: met de DEMO-roleMap (verkeerde namen) zou er NIETS binnenkomen → bewijst dat
// het koppelen écht nodig is en dat de eigen roleMap het verschil maakt.
const demoRecords = parse(rows, sep, headers, sandbox.DEMO_ROLEMAP, true);
const demoImp = demoRecords.reduce((s, r) => s + (r.import_t1 || 0) + (r.import_t2 || 0), 0);
ok(demoImp === 0, `DEMO_ROLEMAP matcht eigen sensoren NIET (Σimport=${demoImp}) → koppelen vereist`);

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
