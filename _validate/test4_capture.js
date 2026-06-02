// Bereken de ECHTE export-gewogen fallback-spot zoals het profiel hem werkelijk inzet.
const { sandbox } = require("./harness");
const { buildYear } = require("./profile");
const gfs = sandbox.getFallbackSpot;
const rows = buildYear(3500,3500);
let expSum=0, revSum=0, impSum=0, impCostSum=0;
rows.forEach(r=>{
  const dt=new Date(r.timestamp); const m=dt.getMonth()+1,h=dt.getHours();
  const sp=gfs(m,h);
  const exp=r.export_t1, imp=r.import_t1;
  expSum+=exp; revSum+=exp*sp;
  impSum+=imp; impCostSum+=imp*sp;
});
console.log(`Export totaal ${expSum.toFixed(0)} kWh, opbrengst €${revSum.toFixed(1)} -> capture €${(revSum/expSum).toFixed(4)}/kWh`);
console.log(`Import totaal ${impSum.toFixed(0)} kWh, kosten kale spot €${impCostSum.toFixed(1)} -> gem €${(impCostSum/impSum).toFixed(4)}/kWh`);
console.log("=> export-capture is veel lager dan import-prijs = solar cannibalisatie (zomermiddag negatief).");
