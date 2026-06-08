const fs = require('fs');
const path = require('path');
const { RUN, sandbox } = require('./harness');

const CSV_FILE = path.join(__dirname, '..', 'home_assistant_export.csv');
const SNAPSHOT_FILE = path.join(__dirname, 'snapshot_golden.json');

const lines = fs.readFileSync(CSV_FILE, 'utf8').trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
const entityIdx = headers.indexOf('entity_id');
const stateIdx = headers.indexOf('state');
const tsIdx = headers.indexOf('last_changed');

const hourlyData = {}; 

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',').map(c => c.trim());
  if (cols.length < 3) continue;
  
  const entity = cols[entityIdx];
  const stateStr = cols[stateIdx];
  const tsStr = cols[tsIdx];
  
  const val = parseFloat(stateStr);
  if (isNaN(val)) continue;
  
  const ms = new Date(tsStr).getTime();
  if (isNaN(ms)) continue;
  
  const hourMs = Math.floor(ms / (3600 * 1000)) * (3600 * 1000);
  
  if (!hourlyData[entity]) hourlyData[entity] = {};
  if (!hourlyData[entity][hourMs] || hourlyData[entity][hourMs].ms < ms) {
    hourlyData[entity][hourMs] = { ms, val };
  }
}

const stats = {};
for (const [entity, hours] of Object.entries(hourlyData)) {
  stats[entity] = Object.entries(hours)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([hourMs, data]) => ({
      start: Number(hourMs),
      sum: data.val
    }));
}

const roleMap = {
  "sensor.p1_meter_energy_import_tariff_1": "imp1",
  "sensor.p1_meter_energy_import_tariff_2": "imp2",
  "sensor.p1_meter_energy_export_tariff_1": "exp1",
  "sensor.p1_meter_energy_export_tariff_2": "exp2",
  "sensor.home_battery_ac_aggr_charge": "batIn",
  "sensor.home_battery_ac_aggr_discharge": "batOut",
  "sensor.solar_inverter_lifetime_energy_production": "solar",
  "sensor.ev_charger_charge_added_session": "ev",
  "sensor.heat_pump_energy_consumption": "hp" 
};

// Map inverted roles for processHAStatistics
const invertedRoleMap = {};
for (const [key, val] of Object.entries(roleMap)) {
  invertedRoleMap[val] = key;
}

const rawRows = sandbox.processHAStatistics(stats, invertedRoleMap, true);
const { data } = sandbox.cleanData(rawRows);

const cfg = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: true, hpWinterBaseload: 10,
  hasEv: true, evWeeklyDist: 100, evConsumption: 0.18, evSolarMatch: true, evProfile: "home",
  hasBattery: true, batCapacity: 5, batPower: 2.5, batEfficiency: 0.9, batMode: "winst",
};

sandbox.pipeline(data, cfg);

const result = RUN({
  rows: data,
  fullYearData: sandbox.fullYearData,
  epex: sandbox.epexHistory,
  cfg: cfg,
  eb: sandbox.liveEnergyTax,
  yearScale: sandbox.yearScale
});

if (process.env.UPDATE_SNAPSHOT) {
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(result, null, 2));
  console.log(`Snapshot saved to ${SNAPSHOT_FILE}`);
  process.exit(0);
}

if (!fs.existsSync(SNAPSHOT_FILE)) {
  console.error("FAIL  No golden snapshot found. Run with UPDATE_SNAPSHOT=1 to generate it.");
  process.exit(1);
}

const golden = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));

try {
  const assert = require('assert');
  const resultJSON = JSON.parse(JSON.stringify(result));
  assert.deepStrictEqual(resultJSON, golden);
  console.log("PASS  test15_snapshot_golden_master");
} catch (e) {
  console.error("FAIL  test15_snapshot_golden_master");
  console.error("Snapshot mismatch!");
  process.exitCode = 1;
}
