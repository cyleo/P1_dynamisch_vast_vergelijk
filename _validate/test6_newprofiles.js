const { RUN, sandbox } = require("./harness");
const { buildYear, sum } = require("./profile");
// Injecteer V_FINAL2 in de echte engine (muteer het EPEX_PROFILES-object in place)
const VF2 = {
  winter:{0:0.07,1:0.06,2:0.06,3:0.06,4:0.06,5:0.07,6:0.10,7:0.13,8:0.14,9:0.12,10:0.10,11:0.09,12:0.09,13:0.09,14:0.10,15:0.11,16:0.13,17:0.16,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
  spring:{0:0.05,1:0.04,2:0.04,3:0.04,4:0.04,5:0.05,6:0.07,7:0.09,8:0.09,9:0.07,10:0.06,11:0.05,12:0.01,13:-0.01,14:0.04,15:0.07,16:0.08,17:0.10,18:0.12,19:0.13,20:0.11,21:0.09,22:0.07,23:0.06},
  summer:{0:0.03,1:0.02,2:0.02,3:0.02,4:0.02,5:0.04,6:0.06,7:0.07,8:0.07,9:0.06,10:0.06,11:0.04,12:-0.01,13:-0.02,14:0.03,15:0.06,16:0.07,17:0.09,18:0.11,19:0.12,20:0.11,21:0.09,22:0.07,23:0.05},
  autumn:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.11,8:0.13,9:0.10,10:0.07,11:0.06,12:0.05,13:0.04,14:0.05,15:0.08,16:0.12,17:0.15,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
};
Object.keys(VF2).forEach(s => Object.assign(sandbox.EPEX_PROFILES[s], VF2[s]));

function rep(t, rows, cfg){
  const r = RUN({rows,epex:new Map(),cfg,eb:0.11084,yearScale:1.0});
  const ge=sum(rows,x=>x.export_t1);
  console.log(`${t.padEnd(34)} VAST €${r.fixedTotalBill.toFixed(0).padStart(4)} | DYN €${r.dynamicTotalBill.toFixed(0).padStart(4)} | ${r.totalSavings>=0?'DYN ':'VAST'} wint €${Math.abs(r.totalSavings).toFixed(0).padStart(3)} | dyn exportopbr €${r.dynamicRawExportRevenue.toFixed(0)}`);
}
const noVTK = {fixedPeakRate:0.27,fixedDalRate:0.24,fixedFeedInRate:0.07,fixedVastrecht:7.5,fixedFeedInFee:0.0,dynamicMarkup:0.018,dynamicVastrecht:6.0,stressMultiplier:1.0,solarDimmingMode:"off",hasHeatPump:false,hasEv:false,hasBattery:false};
const vtk   = {...noVTK, fixedPeakRate:0.28,fixedDalRate:0.25,fixedFeedInRate:0.045,fixedFeedInFee:0.045,dynamicMarkup:0.020};
console.log("=== NIEUWE PROFIELEN (V_FINAL2) door de echte engine ===");
console.log("-- Optimistisch vast contract (VTK €0) --");
rep("Geen PV 2900 kWh", buildYear(2900,0), noVTK);
rep("PV 3500/3500", buildYear(3500,3500), noVTK);
rep("Groot overschot 3000/6000", buildYear(3000,6000), noVTK);
console.log("-- Realistisch 2027 vast contract (VTK €0.045) --");
rep("PV 3500/3500 + VTK", buildYear(3500,3500), vtk);
rep("Groot overschot 3000/6000 + VTK", buildYear(3000,6000), vtk);
