// TEST 15b — Golden snapshot met synthetische demo-data (geen privacy-fixture nodig).
// Altijd actief op CI en verse clones; borgt engine-regressie op de CC-BY demo-data.
// Regenereer snapshot: UPDATE_SNAPSHOT=1 node _validate/test15b_snapshot_synth.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sandbox } = require("./harness");

const SNAPSHOT_FILE = path.join(__dirname, "snapshot_synthetic_golden.json");

// Laad de CC-BY demo-data en extraheer window.DEMO_PROFILE
const demoSrc = fs.readFileSync(path.join(__dirname, "..", "demo-year.js"), "utf8");
const demoCtx = { window: {} };
vm.runInNewContext(demoSrc, demoCtx);
const profile = demoCtx.window.DEMO_PROFILE;
if (!profile || !Array.isArray(profile.imp)) {
  console.error("FAIL  demo-year.js levert geen geldig DEMO_PROFILE op.");
  process.exitCode = 1;
  process.exit(1);
}

// Converteer arrays naar uurrecords (zelfde logica als expandDemoProfile in src/app.js)
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const p2 = n => (n < 10 ? "0" : "") + n;
const rows = [];
let idx = 0;
for (let m = 1; m <= 12 && idx < profile.hours; m++)
  for (let d = 1; d <= DAYS[m - 1] && idx < profile.hours; d++)
    for (let h = 0; h < 24 && idx < profile.hours; h++, idx++)
      rows.push({
        timestamp: `${profile.startYear}-${p2(m)}-${p2(d)}T${p2(h)}:00:00`,
        import_t1: profile.imp[idx], import_t2: 0,
        export_t1: profile.exp[idx], export_t2: 0,
        solar_yield: profile.sol[idx],
      });

// Vaste cfg: geen hardware, 2027-model (default), zodat de snapshot stabiel is.
const cfg = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.024, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "do_nothing",
  hasHeatPump: false, hasEv: false, hasBattery: false,
  fiscalYear: 2027,
};

const { sim } = sandbox.pipeline(rows, cfg);

if (process.env.UPDATE_SNAPSHOT) {
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(sim, null, 2));
  console.log(`Snapshot opgeslagen in ${SNAPSHOT_FILE}`);
  process.exit(0);
}

if (!fs.existsSync(SNAPSHOT_FILE)) {
  console.error("FAIL  snapshot_synthetic_golden.json ontbreekt. Run met UPDATE_SNAPSHOT=1 om hem te genereren.");
  process.exitCode = 1;
  process.exit(1);
}

const golden = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));

try {
  const assert = require("assert");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sim)), golden);
  console.log("PASS  test15b_snapshot_synth — golden master identiek (demo-jaar, geen hardware)");
} catch (e) {
  console.error("FAIL  test15b_snapshot_synth — snapshot mismatch:");
  console.error(e.message.slice(0, 400));
  process.exitCode = 1;
}
