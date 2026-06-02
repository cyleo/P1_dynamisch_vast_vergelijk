// Tuner: meet jaargemiddelde, solar-capture (export-gewogen) en import-gewogen
// gemiddelde voor een kandidaat EPEX-profielset. Doel: capture ~0.045, jaargem ~0.09.
const { buildYear } = require("./profile");

function metrics(PROF) {
  const seasonOf = m => (m>=3&&m<=5)?'spring':(m>=6&&m<=8)?'summer':(m>=9&&m<=11)?'autumn':'winter';
  const spot = (m,h) => { const r = PROF[seasonOf(m)][h]; return r>=0 ? r*1.21 : r; };
  // vlak jaargemiddelde
  let s=0,n=0,neg=0;
  for(let m=1;m<=12;m++)for(let h=0;h<24;h++){const v=spot(m,h);s+=v;n++;if(v<0)neg++;}
  const flat=s/n;
  // export- en import-gewogen via echt jaarprofiel
  const rows=buildYear(3500,3500);
  let er=0,ee=0,ir=0,ie=0;
  rows.forEach(r=>{const dt=new Date(r.timestamp);const m=dt.getMonth()+1,h=dt.getHours();const v=spot(m,h);
    er+=r.export_t1*v; ee+=r.export_t1; ir+=r.import_t1*v; ie+=r.import_t1;});
  return { flat, capture: er/ee, impw: ir/ie, negFrac: neg/n, eveningPeak: Math.max(...[17,18,19,20].map(h=>spot(7,h))) };
}

// ── Huidige profielen (referentie) ──
const CURRENT = {
  winter:{0:0.08,1:0.07,2:0.07,3:0.07,4:0.07,5:0.08,6:0.11,7:0.14,8:0.16,9:0.14,10:0.12,11:0.10,12:0.10,13:0.10,14:0.11,15:0.12,16:0.14,17:0.18,18:0.16,19:0.14,20:0.12,21:0.10,22:0.09,23:0.08},
  spring:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.10,8:0.10,9:0.04,10:0.00,11:-0.02,12:-0.05,13:-0.06,14:-0.05,15:-0.02,16:0.02,17:0.08,18:0.12,19:0.14,20:0.12,21:0.10,22:0.08,23:0.07},
  summer:{0:0.04,1:0.03,2:0.03,3:0.02,4:0.02,5:0.04,6:0.06,7:0.08,8:0.08,9:0.04,10:0.00,11:-0.02,12:-0.04,13:-0.04,14:-0.03,15:0.00,16:0.04,17:0.08,18:0.11,19:0.13,20:0.12,21:0.10,22:0.08,23:0.06},
  autumn:{0:0.07,1:0.06,2:0.06,3:0.06,4:0.06,5:0.07,6:0.09,7:0.12,8:0.14,9:0.10,10:0.08,11:0.06,12:0.05,13:0.05,14:0.06,15:0.08,16:0.12,17:0.16,18:0.17,19:0.15,20:0.12,21:0.10,22:0.09,23:0.08},
};

// ── Kandidaat V2: middag minder diep negatief; ondiepe negatieve piek rond zon-noon;
//    schouders en avondpiek behouden. Doel capture ~0.045, jaargem ~0.09. ──
const V2 = {
  // winter: weinig zon, nauwelijks aangepast (licht verlaagd middag voor realisme)
  winter:{0:0.09,1:0.08,2:0.07,3:0.07,4:0.07,5:0.08,6:0.11,7:0.14,8:0.15,9:0.13,10:0.11,11:0.10,12:0.10,13:0.10,14:0.11,15:0.12,16:0.15,17:0.18,18:0.17,19:0.15,20:0.12,21:0.10,22:0.09,23:0.08},
  // spring: ondiepe dip i.p.v. -0.06; capture omhoog
  spring:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.11,8:0.10,9:0.07,10:0.04,11:0.02,12:0.00,13:-0.01,14:0.01,15:0.04,16:0.07,17:0.10,18:0.13,19:0.15,20:0.13,21:0.10,22:0.08,23:0.07},
  // summer: diepste seizoen maar gemiddeld licht positief overdag
  summer:{0:0.04,1:0.03,2:0.03,3:0.03,4:0.03,5:0.05,6:0.07,7:0.09,8:0.08,9:0.06,10:0.04,11:0.02,12:0.00,13:-0.01,14:0.00,15:0.03,16:0.06,17:0.09,18:0.12,19:0.14,20:0.13,21:0.10,22:0.08,23:0.06},
  // autumn: matig, lichte middag-dip
  autumn:{0:0.08,1:0.07,2:0.06,3:0.06,4:0.06,5:0.07,6:0.10,7:0.13,8:0.14,9:0.11,10:0.08,11:0.06,12:0.05,13:0.05,14:0.06,15:0.09,16:0.13,17:0.16,18:0.17,19:0.15,20:0.12,21:0.10,22:0.09,23:0.08},
};

// ── Kandidaat V3: zomer/lente-middag verder opgetild (capture→~0.045), winter/avond
//    iets teruggebracht zodat jaargemiddelde ~0.09 blijft. ──
const V3 = {
  winter:{0:0.08,1:0.07,2:0.07,3:0.07,4:0.07,5:0.08,6:0.11,7:0.14,8:0.15,9:0.13,10:0.11,11:0.10,12:0.10,13:0.10,14:0.11,15:0.12,16:0.14,17:0.17,18:0.16,19:0.14,20:0.12,21:0.10,22:0.09,23:0.08},
  spring:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.10,8:0.10,9:0.08,10:0.06,11:0.05,12:0.03,13:0.02,14:0.04,15:0.06,16:0.08,17:0.10,18:0.13,19:0.14,20:0.12,21:0.10,22:0.08,23:0.07},
  summer:{0:0.04,1:0.03,2:0.03,3:0.03,4:0.03,5:0.05,6:0.07,7:0.08,8:0.08,9:0.07,10:0.06,11:0.05,12:0.03,13:0.02,14:0.03,15:0.05,16:0.07,17:0.09,18:0.12,19:0.13,20:0.12,21:0.10,22:0.08,23:0.06},
  autumn:{0:0.07,1:0.06,2:0.06,3:0.06,4:0.06,5:0.07,6:0.09,7:0.12,8:0.14,9:0.11,10:0.08,11:0.07,12:0.06,13:0.06,14:0.07,15:0.09,16:0.13,17:0.16,18:0.16,19:0.14,20:0.12,21:0.10,22:0.09,23:0.08},
};

for (const [name, P] of [["CURRENT",CURRENT],["V2",V2],["V3",V3]]) {
  const m = metrics(P);
  console.log(`${name.padEnd(8)} jaargem €${m.flat.toFixed(4)} | solar-capture €${m.capture.toFixed(4)} | import-gew €${m.impw.toFixed(4)} | neg-uren ${(m.negFrac*100).toFixed(1)}% | avondpiek €${m.eveningPeak.toFixed(3)}`);
}
console.log("\nDoel: capture ~0.045 (52% van jaargem), jaargem ~0.085-0.095, import-gew ~0.10-0.12, avondpiek hoogste.");

// ── Genereer V3 minus offset (afgerond op 0.005) en meet ──
function shift(P, off) {
  const o = {};
  for (const s of Object.keys(P)) { o[s] = {}; for (let h=0;h<24;h++) o[s][h] = Math.round((P[s][h]-off)/0.005)*0.005; }
  return o;
}
console.log("\n--- V3 minus offset ---");
for (const off of [0.010, 0.013, 0.015, 0.018]) {
  const P = shift(V3, off);
  const m = metrics(P);
  console.log(`off ${off.toFixed(3)}: jaargem €${m.flat.toFixed(4)} | capture €${m.capture.toFixed(4)} (${(m.capture/m.flat*100).toFixed(0)}%) | import-gew €${m.impw.toFixed(4)} | neg ${(m.negFrac*100).toFixed(1)}% | avondpiek €${m.eveningPeak.toFixed(3)}`);
}

// ── V_FINAL: shift(V3,0.010) als basis, met carve van negatieve zon-noon-uren
//    en gecompenseerde schouders zodat capture ~0.045-0.05 en neg-uren ~4-6%. ──
const VF = {
  winter:{0:0.07,1:0.06,2:0.06,3:0.06,4:0.06,5:0.07,6:0.10,7:0.13,8:0.14,9:0.12,10:0.10,11:0.09,12:0.09,13:0.09,14:0.10,15:0.11,16:0.13,17:0.16,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
  spring:{0:0.05,1:0.04,2:0.04,3:0.04,4:0.04,5:0.05,6:0.07,7:0.09,8:0.09,9:0.07,10:0.06,11:0.04,12:0.00,13:-0.02,14:0.02,15:0.06,16:0.08,17:0.10,18:0.12,19:0.13,20:0.11,21:0.09,22:0.07,23:0.06},
  summer:{0:0.03,1:0.02,2:0.02,3:0.02,4:0.02,5:0.04,6:0.06,7:0.07,8:0.07,9:0.06,10:0.06,11:0.03,12:-0.02,13:-0.03,14:0.01,15:0.05,16:0.07,17:0.09,18:0.11,19:0.12,20:0.11,21:0.09,22:0.07,23:0.05},
  autumn:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.11,8:0.13,9:0.10,10:0.07,11:0.06,12:0.05,13:0.04,14:0.05,15:0.08,16:0.12,17:0.15,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
};
console.log("\n--- V_FINAL ---");
const mf = metrics(VF);
console.log(`V_FINAL : jaargem €${mf.flat.toFixed(4)} | capture €${mf.capture.toFixed(4)} (${(mf.capture/mf.flat*100).toFixed(0)}%) | import-gew €${mf.impw.toFixed(4)} | neg ${(mf.negFrac*100).toFixed(1)}% | avondpiek €${mf.eveningPeak.toFixed(3)}`);

const VF2 = {
  winter:{0:0.07,1:0.06,2:0.06,3:0.06,4:0.06,5:0.07,6:0.10,7:0.13,8:0.14,9:0.12,10:0.10,11:0.09,12:0.09,13:0.09,14:0.10,15:0.11,16:0.13,17:0.16,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
  spring:{0:0.05,1:0.04,2:0.04,3:0.04,4:0.04,5:0.05,6:0.07,7:0.09,8:0.09,9:0.07,10:0.06,11:0.05,12:0.01,13:-0.01,14:0.04,15:0.07,16:0.08,17:0.10,18:0.12,19:0.13,20:0.11,21:0.09,22:0.07,23:0.06},
  summer:{0:0.03,1:0.02,2:0.02,3:0.02,4:0.02,5:0.04,6:0.06,7:0.07,8:0.07,9:0.06,10:0.06,11:0.04,12:-0.01,13:-0.02,14:0.03,15:0.06,16:0.07,17:0.09,18:0.11,19:0.12,20:0.11,21:0.09,22:0.07,23:0.05},
  autumn:{0:0.06,1:0.05,2:0.05,3:0.05,4:0.05,5:0.06,6:0.08,7:0.11,8:0.13,9:0.10,10:0.07,11:0.06,12:0.05,13:0.04,14:0.05,15:0.08,16:0.12,17:0.15,18:0.15,19:0.13,20:0.11,21:0.09,22:0.08,23:0.07},
};
const m2 = metrics(VF2);
console.log(`V_FINAL2: jaargem €${m2.flat.toFixed(4)} | capture €${m2.capture.toFixed(4)} (${(m2.capture/m2.flat*100).toFixed(0)}%) | import-gew €${m2.impw.toFixed(4)} | neg ${(m2.negFrac*100).toFixed(1)}% | avondpiek €${m2.eveningPeak.toFixed(3)}`);
