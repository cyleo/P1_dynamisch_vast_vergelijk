// TEST 3 — Diagnose: hoe negatief is de fallback midden-op-de-dag, en hoe reageert
// het model op realistische terugleverkosten (VTK) in het vaste contract.
const { RUN, sandbox } = require("./harness");
const { buildYear, sum } = require("./profile");

// 3a) Fallback-spot statistiek: jaargemiddelde en export-gewogen (zonuren)
const gfs = sandbox.getFallbackSpot;
let all=[], pos=0,neg=0;
for(let m=1;m<=12;m++) for(let h=0;h<24;h++){ const s=gfs(m,h); all.push(s); if(s>=0)pos++; else neg++; }
const avg = all.reduce((a,b)=>a+b,0)/all.length;
// export-gewogen: weeg met zon-bell (zelfde als profile.js)
function w(h){ if(h<5||h>21)return 0; const x=(h-13)/4.2; return Math.exp(-x*x); }
let num=0,den=0;
for(let m=1;m<=12;m++) for(let h=0;h<24;h++){ const ww=w(h); num+=gfs(m,h)*ww; den+=ww; }
console.log("=== 3a) Fallback-EPEX statistiek (incl BTW excl EB) ===");
console.log(`Vlak jaargemiddelde spot:      €${avg.toFixed(4)}/kWh`);
console.log(`Zon-gewogen (export) spot:     €${(num/den).toFixed(4)}/kWh   <-- wat PV-export oplevert`);
console.log(`Negatieve uren in profiel: ${neg}/${all.length}`);

// 3b) Realistische VTK in het vaste contract (Vattenfall-achtig: feedin 0.045, VTK 0.045)
const cfgVTK = {
  fixedPeakRate: 0.28, fixedDalRate: 0.25, fixedFeedInRate: 0.045,
  fixedVastrecht: 7.50, fixedFeedInFee: 0.045,   // <-- terugleverkosten per kWh export
  dynamicMarkup: 0.020, dynamicVastrecht: 6.00,
  stressMultiplier: 1.0, solarDimmingMode: "off",
  hasHeatPump: false, hasEv: false, hasBattery: false,
};
function report(title, rows, cfg) {
  const r = RUN({ rows, epex: new Map(), cfg, eb: 0.11084, yearScale: 1.0 });
  const gi=sum(rows,x=>x.import_t1+x.import_t2), ge=sum(rows,x=>x.export_t1+x.export_t2);
  console.log(`\n--- ${title} (imp ${gi.toFixed(0)} / exp ${ge.toFixed(0)} kWh) ---`);
  console.log(`  VAST €${r.fixedTotalBill.toFixed(0)}  (teruglever +€${r.fixedFeedInCredit.toFixed(0)} / VTK -€${r.fixedFeedInFee.toFixed(0)})`);
  console.log(`  DYN  €${r.dynamicTotalBill.toFixed(0)}  (exportopbrengst €${r.dynamicRawExportRevenue.toFixed(0)})`);
  console.log(`  ${r.totalSavings>=0?'DYNAMISCH wint':'VAST wint'} met €${Math.abs(r.totalSavings).toFixed(0)}`);
}
console.log("\n=== 3b) Mét realistische VTK €0.045/kWh in vast contract ===");
report("PV 3500/3500", buildYear(3500,3500), cfgVTK);
report("Groot overschot 3000 verbr / 6000 PV", buildYear(3000,6000), cfgVTK);

// 3c) Dezelfde scenario's maar met realistischer positieve export-prijs:
// injecteer een vlakke spot van €0.06 (jaargemiddelde NL day-ahead orde) i.p.v. fallback
function flatEpex(rows, val){ const m=new Map(); const p2=n=>n<10?"0"+n:""+n;
  rows.forEach(r=>{const dt=new Date(r.timestamp); m.set(`${dt.getFullYear()}-${p2(dt.getMonth()+1)}-${p2(dt.getDate())}T${p2(dt.getHours())}`,val);}); return m; }
function reportFlat(title, rows, cfg, spot){
  const r = RUN({ rows, epex: flatEpex(rows,spot), cfg, eb:0.11084, yearScale:1.0 });
  console.log(`\n--- ${title} @ vlakke spot €${spot} ---`);
  console.log(`  VAST €${r.fixedTotalBill.toFixed(0)} | DYN €${r.dynamicTotalBill.toFixed(0)} | ${r.totalSavings>=0?'DYN':'VAST'} wint €${Math.abs(r.totalSavings).toFixed(0)}`);
}
console.log("\n=== 3c) Vlakke spot €0.06 (orde jaargemiddelde), VTK-contract ===");
reportFlat("PV 3500/3500", buildYear(3500,3500), cfgVTK, 0.06);
reportFlat("Groot overschot 3000/6000", buildYear(3000,6000), cfgVTK, 0.06);
