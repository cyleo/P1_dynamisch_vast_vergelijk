// TEST 20 — Import-resolutie & wide-CSV passthrough (normalizeToHourly).
// Borgt twee stille datacorruptie-bugs uit de code-review:
//   1. Sub-uur-data (15-min kwartierwaarden) werd NIET gesommeerd op het brede-CSV-pad;
//      de uur-dedup in cleanAndFillEnergyData ("laatste wint") gooide ~75% energie weg.
//      → nu: per uur GESOMMEERD, energiebehoud exact.
//   2. Dag-resolutie werd als "uur" behandeld → yearScale blies de rekening ~24× op.
//      → nu: harde, duidelijke fout.
//   3. De brede HA-CSV vroeg solar/ev/hp/accu in de koppelmodal maar gooide ze weg.
//      → nu: solar_yield in de records + Digital-Twin ontwarring (NET-DEMAND-model).
const { sandbox } = require("./harness");

const parseLongCSV = sandbox.window.parseLongCSV;
const parseWide = sandbox.window.parseHAStatisticsWideCSVAsync;

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); c ? pass++ : fail++; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const sumImp = rs => rs.reduce((s, r) => s + (r.import_t1 || 0) + (r.import_t2 || 0), 0);
const sumExp = rs => rs.reduce((s, r) => s + (r.export_t1 || 0) + (r.export_t2 || 0), 0);
const sumSol = rs => rs.reduce((s, r) => s + (r.solar_yield || 0), 0);

console.log("=== TEST 20: IMPORT-RESOLUTIE & WIDE-CSV PASSTHROUGH ===\n");

// ── (1) Tidy-CSV, 15-min kwartierwaarden → per uur gesommeerd, energiebehoud exact ──
{
  const rows = ["timestamp;import_t1;export_t1"];
  let totI = 0, totE = 0;
  for (let h = 0; h < 48; h++) for (let q = 0; q < 4; q++) {
    const ts = new Date(Date.UTC(2026, 0, 1, h, q * 15)).toISOString();
    const i = 0.1 + 0.01 * q, e = 0.05 * q;
    totI += i; totE += e;
    rows.push(`${ts};${i};${e}`);
  }
  const recs = parseLongCSV(rows, ";", rows[0].split(";"));
  ok(recs.length === 48, `kwartier-tidy: 192 kwartieren → ${recs.length} uurrecords (verwacht 48)`);
  ok(near(sumImp(recs), totI, 1e-6) && near(sumExp(recs), totE, 1e-6),
    `kwartier-tidy: energiebehoud exact (imp ${sumImp(recs).toFixed(3)}=${totI.toFixed(3)}, exp ${sumExp(recs).toFixed(3)}=${totE.toFixed(3)})`);
}

// ── (2) Tidy-CSV, uurdata → 1-op-1 (regressie) ──────────────────────────────────
{
  const rows = ["timestamp;import_t1;export_t1"];
  for (let h = 0; h < 24; h++) rows.push(`${new Date(Date.UTC(2026, 0, 1, h)).toISOString()};1.0;0.5`);
  const recs = parseLongCSV(rows, ";", rows[0].split(";"));
  ok(recs.length === 24 && near(sumImp(recs), 24) && near(sumExp(recs), 12),
    `uur-tidy: 1-op-1 doorgegeven (${recs.length} records, imp ${sumImp(recs)}, exp ${sumExp(recs)})`);
}

// ── (3) Tidy-CSV, DAG-resolutie → harde fout (geen 24×-opblazing meer) ──────────
{
  const rows = ["timestamp;import_t1;export_t1"];
  for (let d = 1; d <= 30; d++) rows.push(`2026-01-${String(d).padStart(2, "0")};8.5;3.2`);
  let threw = null;
  try { parseLongCSV(rows, ";", rows[0].split(";")); } catch (e) { threw = e; }
  ok(threw && /resolutie/i.test(threw.message),
    `dag-tidy: harde fout met duidelijke melding (${threw ? '"' + threw.message.slice(0, 60) + '…"' : "GEEN FOUT — dagdata glipt door!"})`);
}

// ── (4+5) Brede HA-CSV: kwartier-sommering + solar/EV-passthrough + ontwarring ──
// Wide format: entity_id,type,unit,<ts1>,<ts2>,…  — modal-stub levert de koppeling.
async function wideTests() {
  const HOURS = 6, Q = 4;
  const tss = [];
  for (let h = 0; h < HOURS; h++) for (let q = 0; q < Q; q++)
    tss.push(new Date(Date.UTC(2026, 5, 1, h, q * 15)).toISOString());
  const mk = (id, unit, vals) => [id, "sum", unit, ...vals].join(",");
  const impVals = tss.map(() => 0.25);            // 1.0 kWh/uur huis-import
  const expVals = tss.map(() => 0.125);           // 0.5 kWh/uur export
  const solVals = tss.map(() => 250);             // Wh! → 0.25 kWh/kwartier = 1.0 kWh/uur
  const evVals  = tss.map(() => 0.05);            // 0.2 kWh/uur EV
  const lines = [
    ["entity_id", "type", "unit", ...tss].join(","),
    mk("sensor.p1_import_tariff_1", "kWh", impVals),
    mk("sensor.p1_export_tariff_1", "kWh", expVals),
    mk("sensor.envoy_production", "Wh", solVals),
    mk("sensor.laadpaal_ev", "kWh", evVals),
  ];
  const headers = lines[0].split(",");
  const modalStub = () => Promise.resolve({
    imp1: "sensor.p1_import_tariff_1", imp2: "", exp1: "sensor.p1_export_tariff_1", exp2: "",
    solar: "sensor.envoy_production", ev: "sensor.laadpaal_ev", hp: "", batIn: "", batOut: "",
  });

  // 4a. Digital Twin AAN: kwartieren gesommeerd, solar door, EV ontward uit de meterstand.
  const recs = await parseWide(lines, ",", headers, modalStub, true);
  ok(recs.length === HOURS, `wide: ${tss.length} kwartierkolommen → ${recs.length} uurrecords (verwacht ${HOURS})`);
  ok(near(sumSol(recs), HOURS * 1.0, 1e-6),
    `wide: solar gaat MEE in de records, Wh→kWh + kwartier-som (Σ ${sumSol(recs).toFixed(2)} kWh, verwacht ${HOURS}.00)`);
  // NET-DEMAND-ontwarring: baseNet = (1.0 − 0.5) − 0.2(EV) = 0.3 → import 0.3, export 0.
  ok(near(sumImp(recs), HOURS * 0.3, 1e-6) && near(sumExp(recs), 0, 1e-6),
    `wide+DT: EV ontward uit meterstand (imp ${sumImp(recs).toFixed(2)} verwacht ${(HOURS * 0.3).toFixed(2)}, exp ${sumExp(recs).toFixed(2)})`);
  ok(recs.untangle && recs.untangle.active === true && recs.untangle.devices.ev === true,
    `wide+DT: records.untangle gezet (active=${recs.untangle?.active}, ev=${recs.untangle?.devices?.ev})`);

  // 4b. Digital Twin UIT: meterstanden 1-op-1 (bruto blijft bruto), solar nog steeds mee.
  const recsOff = await parseWide(lines, ",", headers, modalStub, false);
  ok(near(sumImp(recsOff), HOURS * 1.0, 1e-6) && near(sumExp(recsOff), HOURS * 0.5, 1e-6)
    && recsOff.untangle.active === false,
    `wide zonder DT: registers bruto bewaard (imp ${sumImp(recsOff).toFixed(2)}, exp ${sumExp(recsOff).toFixed(2)}, untangle.active=false)`);

  // 5. Wide met DAG-kolommen → zelfde harde fout.
  const dayTss = Array.from({ length: 10 }, (_, d) => new Date(Date.UTC(2026, 0, d + 1)).toISOString());
  const dayLines = [
    ["entity_id", "type", "unit", ...dayTss].join(","),
    mk("sensor.p1_import_tariff_1", "kWh", dayTss.map(() => 8.5)),
  ];
  let threw = null;
  try { await parseWide(dayLines, ",", dayLines[0].split(","), modalStub, true); } catch (e) { threw = e; }
  ok(threw && /resolutie/i.test(threw.message || ""),
    `wide dag-resolutie: harde fout (${threw ? "geworpen" : "GEEN FOUT"})`);
}

wideTests().then(() => {
  console.log(`\n${pass} geslaagd, ${fail} mislukt`);
  if (fail === 0) console.log("PASS  test20_resolution");
  process.exit(fail === 0 ? 0 : 1);
}).catch(e => {
  console.error("FAIL  onverwachte fout:", e);
  process.exit(1);
});
