// TEST 12 — Digital Twin Baseline Ontwarring & Batterij Sanity Check (v=43)
// Borgt de kernregels voor het ontwarren van apparaten uit de P1 meter:
//   1. Zonnige uur: {rawImp: 0, rawExp: 0, ev: 3, solar: 4} -> baseImport: 0, baseExport: 3
//   2. Batterij ontladen uur: {rawImp: 0, rawExp: 0, batIn: 0, batOut: 2} -> baseImport: 2, baseExport: 0
//   3. Batterij laden uur: {rawImp: 2, rawExp: 0, batIn: 2, batOut: 0} -> baseImport: 0, baseExport: 0
//   4. Geen apparaten gekoppeld -> behoudt ruwe import/export ongewijzigd
//   5. batterySensorSuspect vlagged als cumulatieve ontlading > lading * 1.05

const { sandbox } = require("./harness");
const processHAStatistics = sandbox.processHAStatistics;

let pass = 0, fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS  " : "FAIL  ") + m);
  c ? pass++ : fail++;
};

console.log("=== TEST 12: DIGITAL TWIN BASELINE UNTANGLING ===\n");

const roleMap = {
  imp1: "sensor.p1_import_t1",
  imp2: "sensor.p1_import_t2",
  exp1: "sensor.p1_export_t1",
  exp2: "sensor.p1_export_t2",
  solar: "sensor.solar_prod",
  solarUnit: "kWh",
  ev: "sensor.ev_charge",
  evUnit: "kWh",
  hp: "sensor.hp_energy",
  hpUnit: "kWh",
  batIn: "sensor.battery_charge",
  batInUnit: "kWh",
  batOut: "sensor.battery_discharge",
  batOutUnit: "kWh"
};

function runUntangle(inputs, customRoleMap = roleMap) {
  const stats = {};
  const addEntity = (role, val) => {
    const entId = customRoleMap[role];
    if (!entId) return;
    // Omdat processHAStatistics de delta berekent tussen opeenvolgende uren,
    // vullen we de cumulatieve stand op t0 (0) en t1 (3600000 ms) in.
    stats[entId] = [
      { start: 0, sum: 0 },
      { start: 3600000, sum: val }
    ];
  };

  addEntity("imp1", inputs.rawImp ?? 0);
  addEntity("imp2", 0);
  addEntity("exp1", inputs.rawExp ?? 0);
  addEntity("exp2", 0);
  addEntity("ev", inputs.ev ?? 0);
  addEntity("hp", inputs.hp ?? 0);
  addEntity("batIn", inputs.batIn ?? 0);
  addEntity("batOut", inputs.batOut ?? 0);
  addEntity("solar", inputs.solar ?? 0);

  return processHAStatistics(stats, customRoleMap);
}

// Case 1: Sunny hour: {rawImp: 0, rawExp: 0, ev: 3, solar: 4} -> baseImport: 0, baseExport: 3
try {
  const res1 = runUntangle({ rawImp: 0, rawExp: 0, ev: 3, solar: 4 });
  ok(res1.length === 1, "Sunny hour res length is 1");
  const r1 = res1[0];
  ok(Math.abs(r1.import_t1 - 0) < 0.001, `Sunny hour import_t1: expected 0, got ${r1.import_t1}`);
  ok(Math.abs(r1.export_t1 - 3) < 0.001, `Sunny hour export_t1: expected 3, got ${r1.export_t1}`);
  ok(Math.abs(r1.solar_yield - 4) < 0.001, `Sunny hour solar_yield: expected 4, got ${r1.solar_yield}`);
  ok(res1.untangle.active === true, "Digital Twin is marked active");
  ok(res1.untangle.devices.ev === true, "EV is marked as active device");
  ok(res1.untangle.devices.battery === true, "Battery is marked as active device");
} catch (e) {
  ok(false, "Sunny hour crashed: " + e.message);
}

// Case 2: Battery-discharge hour: {rawImp: 0, rawExp: 0, batIn: 0, batOut: 2} -> baseImport: 2, baseExport: 0
try {
  const res2 = runUntangle({ rawImp: 0, rawExp: 0, batIn: 0, batOut: 2 });
  ok(res2.length === 1, "Battery-discharge res length is 1");
  const r2 = res2[0];
  ok(Math.abs(r2.import_t1 - 2) < 0.001, `Battery-discharge import_t1: expected 2, got ${r2.import_t1}`);
  ok(Math.abs(r2.export_t1 - 0) < 0.001, `Battery-discharge export_t1: expected 0, got ${r2.export_t1}`);
} catch (e) {
  ok(false, "Battery-discharge crashed: " + e.message);
}

// Case 3: Battery-charge hour: {rawImp: 2, rawExp: 0, batIn: 2, batOut: 0} -> baseImport: 0, baseExport: 0
try {
  const res3 = runUntangle({ rawImp: 2, rawExp: 0, batIn: 2, batOut: 0 });
  ok(res3.length === 1, "Battery-charge res length is 1");
  const r3 = res3[0];
  ok(Math.abs(r3.import_t1 - 0) < 0.001, `Battery-charge import_t1: expected 0, got ${r3.import_t1}`);
  ok(Math.abs(r3.export_t1 - 0) < 0.001, `Battery-charge export_t1: expected 0, got ${r3.export_t1}`);
} catch (e) {
  ok(false, "Battery-charge crashed: " + e.message);
}

// Case 4: No devices mapped -> returns raw import/export unmodified (net-space converted)
try {
  const emptyRoleMap = {
    imp1: "sensor.p1_import_t1",
    imp2: "sensor.p1_import_t2",
    exp1: "sensor.p1_export_t1",
    exp2: "sensor.p1_export_t2",
    solar: null,
    ev: null,
    hp: null,
    batIn: null,
    batOut: null
  };
  const res4 = runUntangle({ rawImp: 5, rawExp: 0 }, emptyRoleMap);
  ok(res4.length === 1, "No devices res length is 1");
  const r4 = res4[0];
  ok(Math.abs(r4.import_t1 - 5) < 0.001, `No devices import_t1: expected 5, got ${r4.import_t1}`);
  ok(Math.abs(r4.export_t1 - 0) < 0.001, `No devices export_t1: expected 0, got ${r4.export_t1}`);
  ok(res4.untangle.active === false, "Digital Twin is marked inactive when no devices mapped");
} catch (e) {
  ok(false, "No devices crashed: " + e.message);
}

// Case 5: batterySensorSuspect rules
try {
  // Case A: normal battery behavior (losses) -> discharge (9) < charge (10) * 1.05 -> suspect: false
  const res5A = runUntangle({ rawImp: 0, rawExp: 0, batIn: 10, batOut: 9 });
  ok(res5A.untangle.batterySensorSuspect === false, `Suspect expected false, got ${res5A.untangle.batterySensorSuspect}`);

  // Case B: suspect battery behavior -> discharge (11) > charge (10) * 1.05 -> suspect: true
  const res5B = runUntangle({ rawImp: 0, rawExp: 0, batIn: 10, batOut: 11 });
  ok(res5B.untangle.batterySensorSuspect === true, `Suspect expected true, got ${res5B.untangle.batterySensorSuspect}`);

  // Case C: battery not used/zero -> suspect: false
  const res5C = runUntangle({ rawImp: 0, rawExp: 0, batIn: 0, batOut: 0 });
  ok(res5C.untangle.batterySensorSuspect === false, `Suspect expected false when zero, got ${res5C.untangle.batterySensorSuspect}`);
} catch (e) {
  ok(false, "batterySensorSuspect check crashed: " + e.message);
}

// Case 6: Live power fallback (kW/W mean statistics)
try {
  const customRoleMap = {
    ...roleMap,
    evUnit: "kW",
    hpUnit: "W"
  };
  const stats = {};
  
  stats["sensor.p1_import_t1"] = [
    { start: 0, sum: 0 },
    { start: 3600000, sum: 5 }
  ];
  stats["sensor.p1_import_t2"] = [
    { start: 0, sum: 0 },
    { start: 3600000, sum: 0 }
  ];
  stats["sensor.p1_export_t1"] = [
    { start: 0, sum: 0 },
    { start: 3600000, sum: 0 }
  ];
  stats["sensor.p1_export_t2"] = [
    { start: 0, sum: 0 },
    { start: 3600000, sum: 0 }
  ];

  // EV: kW live power fallback (mean: 3.6 kW)
  stats["sensor.ev_charge"] = [
    { start: 0, mean: 0 },
    { start: 3600000, mean: 3.6 }
  ];

  // HP: W live power fallback (mean: 3600 W)
  stats["sensor.hp_energy"] = [
    { start: 0, mean: 0 },
    { start: 3600000, mean: 3600 }
  ];

  const res6 = processHAStatistics(stats, customRoleMap);
  ok(res6.length === 1, "Live power fallback res length is 1");
  const r6 = res6[0];
  ok(Math.abs(r6.import_t1 - 0) < 0.001, `Live power fallback import_t1: expected 0, got ${r6.import_t1}`);
  ok(Math.abs(r6.export_t1 - 2.2) < 0.001, `Live power fallback export_t1: expected 2.2, got ${r6.export_t1}`);
} catch (e) {
  ok(false, "Live power fallback check crashed: " + e.message);
}

console.log(`\n${fail === 0 ? "✅ ALLE" : "❌ " + fail + "/" + (pass + fail)} checks` + (fail === 0 ? " geslaagd" : " GEFAALD") + ` (${pass} pass)`);
if (fail > 0) process.exitCode = 1;
