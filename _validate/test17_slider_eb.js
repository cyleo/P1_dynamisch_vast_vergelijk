// TEST 17 — Slider→rekening integratie (regressie-borging voor bug B1).
//
// Bewijst end-to-end dat de #energy-tax schuif de DYNAMISCHE rekening daadwerkelijk
// beïnvloedt. Bug B1: runSimulation werkte alleen de lokale `liveEnergyTax`-mirror bij,
// niet de appStore — terwijl de engine (buildSimContext) zijn EB uit de store leest.
// Gevolg: de schuif had geen effect op de rekening. Vóór de fix zouden run1 en run2
// hier identieke EB geven → de assert "schuif moet EB veranderen" faalt.
//
// We draaien de ECHTE window.runSimulation() (inclusief readSimConfig + alle render-
// aanroepen) tegen een veilige fake-DOM, en lezen het resultaat terug uit de appStore
// via window.__getTestState().activeSimulation.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// ── Fake-DOM ─────────────────────────────────────────────────────────────────
// Sliderwaarden die readSimConfig + runSimulation uitlezen.
const elValues = {
  "fixed-peak": "0.27", "fixed-dal": "0.24", "fixed-feedin-rate": "0.07",
  "fixed-vastrecht": "7.50", "fixed-feedin-fee": "0.00",
  "dynamic-markup": "0.018", "dynamic-export-markup": "0.020", "dynamic-vastrecht": "6.00",
  "stress-multiplier": "1.0", "solar-dimming-mode": "do_nothing",
  "hp-baseload": "0", "ev-dist": "0", "ev-cons": "18", "ev-profile": "home",
  "bat-cap": "0", "bat-power": "0", "bat-eff": "90", "bat-mode": "zelf", "bat-cost": "450",
  "energy-tax": "0.10",
};
const elChecks = {
  "has-heatpump": false, "has-ev": false, "has-battery": false,
  "ev-solar-match": false, "prognose-toggle": true,
};

const noop = () => {};
const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
function makeEl(id) {
  return {
    id,
    get value() { return elValues[id] !== undefined ? elValues[id] : ""; },
    set value(v) { elValues[id] = String(v); },
    get checked() { return !!elChecks[id]; },
    set checked(v) { elChecks[id] = !!v; },
    textContent: "", innerHTML: "", title: "", dataset: {}, style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], childNodes: [], firstChild: null, parentNode: null,
    appendChild: noop, removeChild: noop, insertBefore: noop, remove: noop, replaceChildren: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, hasAttribute: () => false,
    addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ ...ZERO_RECT }), getBBox: () => ({ ...ZERO_RECT }),
    cloneNode: () => makeEl(id),
  };
}
const elCache = {};
const getEl = (id) => (elCache[id] || (elCache[id] = makeEl(id)));

const documentStub = {
  addEventListener: noop, removeEventListener: noop,
  getElementById: getEl, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl("_dyn"), createElementNS: () => makeEl("_dynNS"),
  body: makeEl("body"),
};
const windowStub = { addEventListener: noop, innerWidth: 1200, location: { reload: noop } };

const realGlobal = {
  console, document: documentStub, window: windowStub, navigator: { userAgent: "node" },
  localStorage: { getItem: () => null, setItem: noop },
  requestAnimationFrame: (cb) => { cb(); return 1; },
  requestIdleCallback: (cb) => { cb({ timeRemaining: () => 0, didTimeout: false }); return 1; },
  cancelAnimationFrame: noop, cancelIdleCallback: noop,
  Date, Math, JSON, Map, Set, Array, Object, Number, String, Boolean, RegExp, Symbol, Error,
  parseFloat, parseInt, isNaN, isFinite, Intl, encodeURIComponent, decodeURIComponent,
  setTimeout: (cb) => { if (typeof cb === "function") cb(); return 1; }, clearTimeout: noop,
  fetch: () => Promise.reject("no-net"), Promise, URL, Blob: function () {},
  // Dismissal-vlaggen op true: charts.js leest deze app.js-mirrors als vrije globals (esbuild
  // hernoemt de app.js-locals bij het flatten → ze landen in global scope). true = sla de
  // waarschuwings-/bannertakken over zodat de incidentele render-code niet struikelt.
  epexWarnDismissed: true, prognosisDismissed: true, dataQualityDismissed: true,
};
realGlobal.globalThis = realGlobal;
windowStub.requestAnimationFrame = realGlobal.requestAnimationFrame;
windowStub.requestIdleCallback = realGlobal.requestIdleCallback;

// Proxy-global: `has: () => true` zorgt dat ELKE vrije identifier "in scope" lijkt, zodat
// onverwachte vrije variabelen (cross-module globals in de UI-render-code) `undefined`
// teruggeven i.p.v. een ReferenceError te gooien. We testen de rekenkern, niet de charts.
const sandbox = new Proxy(realGlobal, {
  has: () => true,
  get: (t, k) => (k in t ? t[k] : undefined),
});

vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "app.js" });
const W = realGlobal.window;

// Skip de battery-optimizer her-run aan het eind van runSimulation.
getEl("battery-optimization-result").style.display = "none";

// ── Scenario: constante 1 kWh/u import, geen export/hardware, 20 dagen → jaarprojectie ──
function buildRows(days) {
  const rows = [], start = new Date(2026, 0, 1, 0, 0, 0);
  for (let h = 0; h < days * 24; h++) {
    const dt = new Date(start.getTime() + h * 3600 * 1000);
    rows.push({ timestamp: dt.toISOString(), import_t1: 1, import_t2: 0, export_t1: 0, export_t2: 0, solar_yield: 0 });
  }
  return rows;
}

const renderErrors = [];
function runWithTax(tax) {
  getEl("energy-tax").value = tax;
  W.__setTestState({
    energyData: buildRows(20), _cleanedRef: null, fullYearData: null, yearScale: 1.0,
    epexHistory: new Map(), calibratedProfile: null, liveEnergyTax: 0.11084,
  });
  // runSimulation berekent de rekening en legt 'm via appStore.setState({activeSimulation})
  // vast vóór het de SVG-charts tekent. Die charts hebben echte DOM-afmetingen/Canvas nodig
  // die deze headless stub niet biedt → we negeren uitsluitend render-fouten en lezen de
  // reeds-berekende rekening terug. Een rekenfout (vóór de setState) zou alsnog opvallen.
  try { W.runSimulation(); }
  catch (e) { renderErrors.push(String(e && e.message || e)); }
  const sim = W.__getTestState().activeSimulation;
  if (!sim || sim.dynamicNetTax === undefined) {
    throw new Error("runSimulation zette geen activeSimulation (rekenfout, niet slechts render): "
      + (renderErrors[renderErrors.length - 1] || "onbekend"));
  }
  return sim;
}

// ── Asserts ────────────────────────────────────────────────────────────────────
let fails = 0;
function chk(name, cond, detail = "") {
  if (cond) { console.log(`PASS  ${name}`); }
  else { console.log(`FAIL  ${name}  ${detail}`); fails++; }
}
const close = (a, b, tol = 1e-3) => Math.abs(a - b) < tol;

console.log("=== TEST 17: #energy-tax schuif → dynamische rekening (B1-regressie) ===");

let r1, r2;
try {
  r1 = runWithTax(0.10);
  r2 = runWithTax(0.20);
} catch (e) {
  console.log(`FAIL  runSimulation wierp een fout: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}

const imp1 = r1.totalImportKwh, imp2 = r2.totalImportKwh;
console.log(`import run1=${imp1.toFixed(1)} kWh · EB@0.10=€${r1.dynamicNetTax.toFixed(2)} · EB@0.20=€${r2.dynamicNetTax.toFixed(2)}`);

chk("import is identiek tussen beide runs", close(imp1, imp2, 1e-6), `${imp1} vs ${imp2}`);
chk("EB run1 = import × 0.10 (engine gebruikt schuifwaarde)", close(r1.dynamicNetTax, imp1 * 0.10, 0.05), `${r1.dynamicNetTax} vs ${imp1 * 0.10}`);
chk("EB run2 = import × 0.20 (engine gebruikt schuifwaarde)", close(r2.dynamicNetTax, imp2 * 0.20, 0.05), `${r2.dynamicNetTax} vs ${imp2 * 0.20}`);
// De kernregressie: bij bug B1 zou de engine beide keren 0.11084 gebruiken → GELIJK.
chk("schuif HEEFT effect: EB@0.20 > EB@0.10", r2.dynamicNetTax > r1.dynamicNetTax + 1, `${r2.dynamicNetTax} !> ${r1.dynamicNetTax}`);
chk("EB schaalt exact 2× met verdubbelde schuif", close(r2.dynamicNetTax / r1.dynamicNetTax, 2.0, 1e-3), `ratio=${(r2.dynamicNetTax / r1.dynamicNetTax).toFixed(4)}`);
chk("dynBill-delta == EB-delta (schuif raakt alléén EB-component)", close(r2.dynamicTotalBill - r1.dynamicTotalBill, r2.dynamicNetTax - r1.dynamicNetTax, 0.05),
  `${(r2.dynamicTotalBill - r1.dynamicTotalBill).toFixed(2)} vs ${(r2.dynamicNetTax - r1.dynamicNetTax).toFixed(2)}`);
// Vast contract is EB-onafhankelijk → mag NIET meebewegen.
chk("vast contract ongewijzigd door EB-schuif", close(r1.fixedTotalBill, r2.fixedTotalBill, 0.01), `${r1.fixedTotalBill} vs ${r2.fixedTotalBill}`);

console.log(fails === 0 ? "\nAlle slider-asserts geslaagd." : `\n${fails} assert(s) GEFAALD.`);
process.exit(fails > 0 ? 1 : 0);
