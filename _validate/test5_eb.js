const { RUN } = require("./harness");
const { buildYear } = require("./profile");
const cfg = { fixedPeakRate:0.27,fixedDalRate:0.24,fixedFeedInRate:0.07,fixedVastrecht:7.5,fixedFeedInFee:0.0,
  dynamicMarkup:0.018,dynamicVastrecht:6.0,stressMultiplier:1.0,solarDimmingMode:"off",
  hasHeatPump:false,hasEv:false,hasBattery:false };
const rows = buildYear(2900,0);
console.log("EB-slidergevoeligheid (geen PV, 2900 kWh) — moet BEIDE contracten verhogen:");
[0.05, 0.11084, 0.15].forEach(eb=>{
  const r=RUN({rows,epex:new Map(),cfg,eb,yearScale:1.0});
  console.log(`  EB €${eb}: vast €${r.fixedTotalBill.toFixed(0)}  dyn €${r.dynamicTotalBill.toFixed(0)}`);
});
console.log("\nRandgeval: piektarief €0.10 < EB €0.11084 (reconstructie clamp):");
const cfgLow={...cfg,fixedPeakRate:0.10,fixedDalRate:0.10};
const rl=RUN({rows,epex:new Map(),cfg:cfgLow,eb:0.11084,yearScale:1.0});
console.log(`  ingevoerd all-in €0.10/kWh -> effectieve vaste importkosten/kWh = €${(rl.fixedImportCost/2900).toFixed(4)} (let op: > 0.10 door clamp)`);
