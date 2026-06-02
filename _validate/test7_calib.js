const { sandbox } = require("./harness");
const p2 = n => n<10?"0"+n:""+n;
// Bouw "echte" historie: alleen ZOMER (jul) met een herkenbaar patroon, 10 dagen,
// plus te weinig samples in een winteruur (mag NIET kalibreren -> generiek blijven).
const hist = new Map();
for (let d=1; d<=10; d++) for (let h=0; h<24; h++) {
  // echte zomerprijs: vlak 0.20 's avonds, -0.10 om 13u (extremer dan generiek)
  const price = (h===13) ? -0.10 : (h>=18&&h<=20 ? 0.22 : 0.05);
  hist.set(`2025-07-${p2(d)}T${p2(h)}`, price);
}
// Slechts 2 winter-samples voor uur 3 (onder CALIB_MIN_SAMPLES=3)
hist.set(`2025-01-01T03`, 0.99); hist.set(`2025-01-02T03`, 0.99);

const { meta } = sandbox.calibrate(hist);
console.log("Calibratie-meta:", meta);

const genWinter3 = (() => { // generieke winter uur 3 (geen kalibratie) = 0.06*1.21
  return 0.06*1.21;
})();
console.log("\nVerificatie getFallbackSpot na calibratie:");
console.log(`  zomer 13u  -> €${sandbox.spotFor(7,13).toFixed(4)}  (verwacht ≈ -0.10 = echte gekalibreerde waarde)`);
console.log(`  zomer 19u  -> €${sandbox.spotFor(7,19).toFixed(4)}  (verwacht ≈ 0.22 = echte avondpiek)`);
console.log(`  zomer 13u via maand 8 (aug, zelfde seizoen) -> €${sandbox.spotFor(8,13).toFixed(4)} (deelt zomer-bucket)`);
console.log(`  winter 3u  -> €${sandbox.spotFor(1,3).toFixed(4)}  (verwacht generiek €${genWinter3.toFixed(4)}, want maar 2 samples < min 3)`);
console.log(`  lente 13u  -> €${sandbox.spotFor(4,13).toFixed(4)}  (verwacht generiek, geen lente-historie)`);
