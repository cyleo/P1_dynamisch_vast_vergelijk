// Validatie-harnas: laadt de ECHTE app.js in een vm-context met gestubde DOM,
// en draait _simulateCore op gecontroleerde synthetische data.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appSrc = fs.readFileSync(path.join(__dirname, "..", "dist", "app.bundle.js"), "utf8");

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
})();
`;

vm.createContext(sandbox);
vm.runInContext(appSrc + driver, sandbox, { filename: "app.js" });

sandbox.computeBillForConfig = sandbox.window.computeBillForConfig;

module.exports = { RUN: sandbox.RUN, sandbox };
