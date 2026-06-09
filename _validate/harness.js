// Validatie-harnas: laadt de ECHTE app.js in een vm-context met gestubde DOM,
// en draait _simulateCore op gecontroleerde synthetische data.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// ── Auto-bundel (anti-stale-build-vangnet) ───────────────────────────────────
// De harness draait de GEBUNDELDE root-app.js (esbuild uit src/), niet src/ direct.
// Een veelvoorkomende valkuil: `node _validate/testX.js` draaien ná een src-wijziging
// test dan tegen een VEROUDERDE bundel → groen-vals of rood-vals dat niets met je
// wijziging te maken heeft. Daarom bouwt de harness de bundel zelf, tenzij de aanroeper
// (run_tests.js / `npm test`) al heeft gebouwd en BUNDLE_FRESH=1 heeft gezet — dan slaan
// we de ~15ms esbuild-stap over zodat de volledige suite maar één keer bouwt.
if (!process.env.BUNDLE_FRESH) {
  try {
    require("esbuild").buildSync({
      entryPoints: [path.join(ROOT, "src", "app.js")],
      bundle: true,
      outfile: path.join(ROOT, "app.js"),
    });
  } catch (e) {
    console.error("WARN: kon de bundel niet automatisch bouwen — test draait mogelijk tegen een verouderde app.js.\n" + e.message);
  }
}

const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// --- Stub DOM/window zodat app.js zonder crash laadt ---
const noop = () => {};
const fakeEl = { addEventListener: noop, value: "", textContent: "", style: {}, classList: { add: noop, remove: noop }, getBoundingClientRect: () => ({}), appendChild: noop, setAttribute: noop, querySelector: () => null, querySelectorAll: () => [] };
const document = {
  addEventListener: noop,
  getElementById: () => null,        // _simulateCore leest NOOIT DOM in de loop
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...fakeEl }),
  body: { ...fakeEl },
};
const windowStub = { addEventListener: noop };

const sandbox = {
  console, document, window: windowStub, navigator: { userAgent: "node" },
  Date, Math, JSON, Map, Set, Array, Object, Number, String, parseFloat, parseInt, isNaN,
  setTimeout: noop, fetch: () => Promise.reject("no-net"),
};
sandbox.globalThis = sandbox;

// Driver wordt aan dezelfde script-scope geplakt zodat hij de `let`-globals
// (energyData, fullYearData, epexHistory, liveEnergyTax, yearScale) kan zetten
// en _simulateCore via closure kan aanroepen.
const driver = `
;(function(){
  globalThis.RUN = function(scenario){
    window.__setTestState({
      energyData: scenario.rows,
      fullYearData: scenario.fullYearData || null,
      epexHistory: scenario.epex || new Map(),
      liveEnergyTax: (scenario.eb !== undefined) ? scenario.eb : 0.11084,
      yearScale: (scenario.yearScale !== undefined) ? scenario.yearScale : 1.0
    });
    // wis eventuele _meta cache
    const st = window.__getTestState();
    st.energyData.forEach(r => { try { delete r._meta; } catch(e){} });
    return window._simulateCore(scenario.cfg, true);
  };
  globalThis.getFallbackSpot = window.getFallbackSpot;
  globalThis.EPEX_PROFILES   = window.EPEX_PROFILES;
  globalThis.calibrate = function(hist){
    window.__setTestState({ epexHistory: hist });
    window.buildCalibratedProfile();
    const st = window.__getTestState();
    return { meta: st.calibrationMeta, profile: st.calibratedProfile };
  };
  globalThis.spotFor = (m,h) => window.getFallbackSpot(m,h);
  globalThis.cleanData = function(rows){
    window.__setTestState({ energyData: rows, _cleanedRef: null });
    window.ensureCleanData();
    const st = window.__getTestState();
    return { data: st.energyData, quality: st.dataQuality };
  };
  globalThis.pipeline = function(rows, cfg){
    window.__setTestState({
      energyData: rows, _cleanedRef: null, fullYearData: null, yearScale: 1.0,
      epexHistory: new Map(), calibratedProfile: null, liveEnergyTax: 0.11084
    });
    window.ensureCleanData();
    // we bypass ensureFullYearData if it's internal, but simulateCore calls it anyway if needed.
    window.buildCalibratedProfile();
    const sim = window._simulateCore(cfg, true);
    const st = window.__getTestState();
    return { sim, dataMeta: JSON.parse(JSON.stringify(st.dataMeta)), dataQuality: st.dataQuality, yearScale: st.yearScale,
      fullYearData: st.fullYearData, epexHistory: st.epexHistory, liveEnergyTax: st.liveEnergyTax };
  };
  globalThis.processHAStatistics = window.processHAStatistics;
  globalThis.parseHAHistoryExportCSV = window.parseHAHistoryExportCSV;
  globalThis.DEMO_ROLEMAP = window.DEMO_ROLEMAP;
})();
`;

vm.createContext(sandbox);
vm.runInContext(appSrc + driver, sandbox, { filename: "app.js" });

sandbox.computeBillForConfig = sandbox.window.computeBillForConfig;

module.exports = { RUN: sandbox.RUN, sandbox };
