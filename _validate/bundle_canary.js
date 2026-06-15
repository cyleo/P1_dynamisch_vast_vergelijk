// Bundle canary — runs right after `npm run build`, before the test suite.
//
// Waarom: esbuild bundelt src/ tot één platte IIFE in root app.js. Een
// cirkelimport in src/domain of src/ui kan esbuild's symbool-resolutie laten
// haperen waardoor gelijknamige functies in ANDERE modules STIL wegvallen uit
// de bundle (bv. renderChart/_updateSimHeader uit charts.js). Dat compileert,
// alle node-tests blijven groen, maar de browser crasht bij het tekenen.
//
// Deze canary faalt de build hard als een render-kritische functie ontbreekt.
// Zie docs/ENGINEERING_PRACTICES.md → "esbuild circular import".

const fs = require("fs");
const path = require("path");

const BUNDLE = path.join(__dirname, "..", "app.js");

// Functies die ALTIJD in de bundle moeten zitten. Als esbuild er één dropt door
// een cirkelimport, is dit de goedkoopste plek om dat te vangen.
const REQUIRED = [
  "function renderChart",
  "function _updateSimHeader",
  "function renderOverviewChart",
  "function renderSimChart",
  "function _simulateCore",
];

if (!fs.existsSync(BUNDLE)) {
  console.error("CANARY FAIL: app.js (bundle) ontbreekt — draai `npm run build` eerst.");
  process.exit(1);
}

const src = fs.readFileSync(BUNDLE, "utf8");
const missing = REQUIRED.filter((sig) => !src.includes(sig));

if (missing.length) {
  console.error("CANARY FAIL: deze functies zijn uit de bundle gevallen:");
  for (const m of missing) console.error("  - " + m);
  console.error(
    "\nWaarschijnlijke oorzaak: een nieuwe cirkelimport in src/domain of src/ui.\n" +
      "Zie docs/ENGINEERING_PRACTICES.md → 'esbuild circular import'.",
  );
  process.exit(1);
}

console.log(`CANARY OK: alle ${REQUIRED.length} render-kritische functies zitten in de bundle.`);
