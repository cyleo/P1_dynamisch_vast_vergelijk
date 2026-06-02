// TEST 2 — Realistisch zonnepanelen-huishouden, fallback-EPEX (geen live), 2027-model.
const { RUN, sandbox } = require("./harness");
const { buildYear, sum } = require("./profile");

const cfgBase = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};

function report(title, rows, cfg, opts={}) {
  const r = RUN({ rows, epex: new Map(), cfg, eb: 0.11084, yearScale: 1.0 });
  const grossImp = sum(rows, x=>x.import_t1+x.import_t2);
  const grossExp = sum(rows, x=>x.export_t1+x.export_t2);
  console.log(`\n=== ${title} ===`);
  console.log(`Bruto import ${grossImp.toFixed(0)} kWh | bruto export ${grossExp.toFixed(0)} kWh | netto ${(grossImp-grossExp).toFixed(0)} kWh`);
  console.log(`  VAST    : import €${r.fixedImportCost.toFixed(0)}  - teruglever €${r.fixedFeedInCredit.toFixed(0)}  + VTK €${r.fixedFeedInFee.toFixed(0)}  + vastrecht €${r.fixedSubscription.toFixed(0)}  = €${r.fixedTotalBill.toFixed(0)}`);
  console.log(`  DYNAMISCH: rawimp €${r.dynamicRawImportCost.toFixed(0)}  - rawexp €${r.dynamicRawExportRevenue.toFixed(0)}  + EB(bruto) €${r.dynamicNetTax.toFixed(0)}  + vastrecht €${r.dynamicSubscription.toFixed(0)}  = €${r.dynamicTotalBill.toFixed(0)}`);
  console.log(`  Verschil (vast - dyn) = €${(r.fixedTotalBill - r.dynamicTotalBill).toFixed(0)}  (${r.savingsPct.toFixed(1)}% ${r.totalSavings>=0?'voordeel dynamisch':'voordeel vast'})`);
  console.log(`  EPEX-dekking: ${r.epexPct}% live (rest fallback)`);
  return r;
}

console.log("################ Fallback-EPEX seizoensprofielen, energiebelasting €0.11084 ################");

// Scenario 1: geen panelen, gemiddeld huishouden
report("A) Geen PV — 2900 kWh verbruik", buildYear(2900, 0), cfgBase);

// Scenario 2: gemiddeld huishouden met 10 panelen (~3500 kWh PV)
const rowsPV = buildYear(3500, 3500);
report("B) PV 3500 kWh prod, 3500 kWh verbruik (geen accu)", rowsPV, cfgBase);

// Scenario 3: zelfde PV-huis met thuisbatterij 10 kWh
report("C) PV-huis + thuisbatterij 10 kWh (5 kW)", rowsPV, {
  ...cfgBase, hasBattery: true, batCapacity: 10, batPower: 5, batEfficiency: 0.90, batArbitrage: true, batGridExport: false,
});

// Scenario 4: groot PV-overschot (warmtepomp-loos), veel teruglevering -> toets VTK-effect vast
report("D) Veel PV-overschot — 6000 kWh PV, 3000 kWh verbruik", buildYear(3000, 6000), cfgBase);
