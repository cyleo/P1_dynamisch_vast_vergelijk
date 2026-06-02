// Validatie-harnas: laadt de ECHTE app.js in een vm-context met gestubde DOM,
// en draait _simulateCore op gecontroleerde synthetische data.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

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
    energyData   = scenario.rows;
    fullYearData = scenario.fullYearData || null;
    epexHistory  = scenario.epex || new Map();
    liveEnergyTax= (scenario.eb !== undefined) ? scenario.eb : 0.11084;
    yearScale    = (scenario.yearScale !== undefined) ? scenario.yearScale : 1.0;
    // wis eventuele _meta cache
    energyData.forEach(r => { try { delete r._meta; } catch(e){} });
    return _simulateCore(scenario.cfg, true);
  };
  globalThis.getFallbackSpot = getFallbackSpot;
  globalThis.EPEX_PROFILES   = EPEX_PROFILES;
  globalThis.calibrate = function(hist){
    epexHistory = hist;
    buildCalibratedProfile();
    return { meta: calibrationMeta, profile: calibratedProfile };
  };
  globalThis.spotFor = (m,h) => getFallbackSpot(m,h);
})();
`;

vm.createContext(sandbox);
vm.runInContext(appSrc + driver, sandbox, { filename: "app.js" });

module.exports = { RUN: sandbox.RUN, sandbox };
