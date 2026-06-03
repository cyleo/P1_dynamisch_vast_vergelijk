// TEST 10 — Diepgaande validatie van rekenfouten en aannames in app.js
const { RUN } = require("./harness");
const { buildYear, sum } = require("./profile");

const cfgBase = {
  fixedPeakRate: 0.27, fixedDalRate: 0.24, fixedFeedInRate: 0.07,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.00,
  dynamicMarkup: 0.018, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};

console.log("=== TEST 10: VALIDATIE VAN APP.JS BUGS EN AANNAMES ===");

// ---------------------------------------------------------
// VALIDATIE 1: De Thuisbatterij Laadvermogen Limiet Bug
// ---------------------------------------------------------
console.log("\n--- Deel 1: Thuisbatterij Laadvermogen Limiet Bug ---");
// We creëren een scenario met 1 uur waarin er 4 kWh zonne-export is én de accu mag laden van het net.
// De accu heeft een capaciteit van 10 kWh, en een max vermogen van 5 kW.
// We plannen dit uur als een 'charge' uur voor de accu.
const rowsBattery = [];
const epexBattery = new Map();
for (let h = 0; h < 24; h++) {
  const dt = new Date(2026, 5, 1, h, 0, 0);
  const p2 = n => (n < 10 ? "0" + n : "" + n);
  const key = `2026-06-01T${p2(h)}`;
  
  // Om 12 uur hebben we zonne-export en een negatieve prijs
  const isTarget = (h === 12);
  rowsBattery.push({
    timestamp: dt.toISOString(),
    import_t1: 0, import_t2: 0,
    export_t1: isTarget ? 4.0 : 0, export_t2: 0,
    solar_yield: isTarget ? 5.0 : 0
  });
  
  // We maken dit uur heel goedkoop (negatief) en de rest duurder, zodat dit uur gekozen wordt om te laden
  epexBattery.set(key, isTarget ? -0.10 : 0.20);
}

// We stubben de daggroepering zodat dit uur als charge hour wordt herkend
const cfgBattery = {
  ...cfgBase,
  hasBattery: true,
  batCapacity: 10,
  batPower: 5,
  batEfficiency: 0.90,
  batArbitrage: true,
  batGridExport: false
};

// We draaien de simulatie voor dit specifieke uur.
// Omdat harness.js de globals vult, moeten we zorgen dat we de charge hours correct stubben.
// In app.js wordt precomputeBatterySchedule() aangeroepen die de charge uren bepaalt op basis van de dag-tabel.
// Als we de beursprijs erg laag maken (-0.05) en dit is het enige uur, dan wordt het sowieso een charge uur.
// Laten we de simulatie runnen en kijken naar de eindrekening en het gedrag van de accu.
// In harness.js kunnen we de volledige simulation output terugkrijgen als we full=true sturen.
const resBat = RUN({
  rows: rowsBattery,
  epex: epexBattery,
  cfg: cfgBattery,
  eb: 0.11084,
  yearScale: 1.0
});

console.log("Huis oorspronkelijke import: 0.0 kWh | export: 4.0 kWh");
console.log(`Dynamische resultaten:`);
console.log(`  Bruto import kWh (inclusief acculaden): ${resBat.totalImportKwh.toFixed(2)} kWh`);
console.log(`  Bruto export kWh (na acculaden):       ${resBat.totalExportKwh.toFixed(2)} kWh`);

// Laten we analyseren wat er is gebeurd met de accu:
// 1. Zonoverschot opslaan:
//    c_solar = Math.min(expDyn, batPower, batCapacity - batSoC)
//    c_solar = Math.min(4.0, 5.0, 10 - 0) = 4.0 kW.
//    batSoC = 4.0 * 0.90 = 3.6 kWh.
//    expDyn = 4.0 - 4.0 = 0.0 kWh.
// 2. Arbitrage (van het net laden):
//    Omdat het een charge hour is, expDyn = 0 en batSoC (3.6) < batCapacity (10):
//    c_grid = Math.min(batPower, batCapacity - batSoC)
//    c_grid = Math.min(5.0, 10 - 3.6) = 5.0 kW.
//    batSoC = 3.6 + 5.0 * 0.90 = 8.1 kWh.
//    impDyn += 5.0 kWh.
// TOTAAL GELADEN IN DIT UUR: c_solar + c_grid = 4.0 + 5.0 = 9.0 kW!
// Dit overschrijdt het max vermogen (batPower = 5 kW) met 4.0 kW (80% overschrijding)!

if (resBat.totalImportKwh > 4.5) {
  console.log("BUG BEVESTIGD: De accu heeft in één uur 9.0 kW aan vermogen opgenomen (4.0 kW zon + 5.0 kW net),");
  console.log("terwijl het maximale laadvermogen (batPower) was gecapped op 5.0 kW.");
} else {
  console.log("Geen bug gedetecteerd.");
}


// ---------------------------------------------------------
// VALIDATIE 2: Btw-fout over teruggeleverde stroom
// ---------------------------------------------------------
console.log("\n--- Deel 2: Btw-fout over teruggeleverde stroom ---");
// In app.js is spot incl. BTW. De opbrengst van teruglevering is nu gecorrigeerd naar:
// dynExpRev = dynExp * (spot / 1.21)
// We controleren of de opbrengst nu inderdaad exclusief btw wordt berekend.
const rowsPV = buildYear(3500, 3500); // 3500 kWh verbruik, 3500 opwek
const resPVDyn = RUN({
  rows: rowsPV,
  epex: new Map(), // gebruikt fallback profiel (incl. btw)
  cfg: cfgBase,
  eb: 0.11084,
  yearScale: 1.0
});

const calculatedExportRevenue = resPVDyn.dynamicRawExportRevenue;
const expectedRevenueExclBtw = 77.58; // vooraf berekende referentiewaarde excl. BTW (93.87 / 1.21)
const expectedRevenueInclBtw = 93.87; // vooraf berekende referentiewaarde incl. BTW

console.log(`Voor een standaard huishouden (3500 kWh PV, 3500 kWh verbruik):`);
console.log(`  Berekende exportopbrengst in engine: €${calculatedExportRevenue.toFixed(2)}`);
if (Math.abs(calculatedExportRevenue - expectedRevenueExclBtw) < 0.10) {
  console.log(`  PASS: De engine berekent de opbrengst nu correct exclusief btw (€${calculatedExportRevenue.toFixed(2)}).`);
} else if (Math.abs(calculatedExportRevenue - expectedRevenueInclBtw) < 0.10) {
  console.log(`  FAIL: De engine berekent de opbrengst nog steeds inclusief btw (€${calculatedExportRevenue.toFixed(2)}).`);
} else {
  console.log(`  Resultaat: €${calculatedExportRevenue.toFixed(2)}`);
}


// ---------------------------------------------------------
// VALIDATIE 3: Energiebelasting slider en het vaste contract
// ---------------------------------------------------------
console.log("\n--- Deel 3: Energiebelasting slider en vaste contract ---");
// De energiebelasting-slider in de app beïnvloedt alleen het dynamische contract.
// Het vaste contract is invariant voor deze slider.
// Maar als de belasting stijgt in 2027, stijgt het vaste contract all-in tarief in werkelijkheid ook.
const resEB1 = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.11084, yearScale: 1.0 });
const resEB2 = RUN({ rows: rowsPV, epex: new Map(), cfg: cfgBase, eb: 0.15000, yearScale: 1.0 });

console.log("Vaste rekening bij EB = 0.11084: €" + resEB1.fixedTotalBill.toFixed(2));
console.log("Vaste rekening bij EB = 0.15000: €" + resEB2.fixedTotalBill.toFixed(2));
console.log("Discrepantie: Het vaste contract past zich niet aan aan de stijging van de energiebelasting,");
console.log("waardoor de vergelijking scheefgetrokken wordt als de gebruiker met toekomstige tarieven simuleert.");
