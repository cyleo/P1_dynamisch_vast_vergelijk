// TEST 8 — Importcheck: opschonen + gaten vullen. Schone UTC-uurgenerator.
const { sandbox } = require("./harness");

const H = 3600000;
const START = Date.UTC(2026, 0, 1, 0, 0, 0);   // 1 jan 2026 00:00 UTC
const TOTAL = 8760;                              // niet-schrikkeljaar

// Genereer een compleet, gatenloos jaar met een simpel realistisch dagprofiel.
function gen() {
  const rows = [];
  for (let i = 0; i < TOTAL; i++) {
    const ms = START + i * H;
    const d = new Date(ms), h = d.getUTCHours(), mo = d.getUTCMonth() + 1;
    const base = h >= 17 && h <= 21 ? 0.9 : (h >= 0 && h < 6 ? 0.15 : 0.4);
    const solFactor = [0.1,0.2,0.4,0.65,0.85,1,0.95,0.85,0.6,0.35,0.15,0.08][mo-1];
    const sol = (h >= 7 && h <= 19) ? Math.max(0, Math.sin(Math.PI*(h-7)/12)) * 1.2 * solFactor : 0;
    const imp = Math.max(0, base - sol), exp = Math.max(0, sol - base);
    rows.push({ timestamp: new Date(ms).toISOString(), import_t1: imp, import_t2: 0, export_t1: exp, export_t2: 0, solar_yield: sol });
  }
  return rows;
}

const byTs = new Map(gen().map(r => [r.timestamp, r]));
const rm = (fromI, hours) => { for (let i=0;i<hours;i++) byTs.delete(new Date(START + (fromI+i)*H).toISOString()); };

// Knip: klein gat (3u), grote periode 5 dagen, grote periode 10 dagen.
const idxMar10_02 = Math.round((Date.UTC(2026,2,10,2) - START)/H);
const idxJul05 = Math.round((Date.UTC(2026,6,5,0) - START)/H);
const idxNov12 = Math.round((Date.UTC(2026,10,12,0) - START)/H);
rm(idxMar10_02, 3);
rm(idxJul05, 5*24);
rm(idxNov12, 10*24);

let rows = [...byTs.values()];
rows[1000] = { ...rows[1000], import_t1: 9999 };   // anomalie
rows.push({ ...rows[500] });                        // duplicaat

const before = rows.length;
const { data, quality } = sandbox.cleanData(rows);

const fillSmall = data.filter(r => r._fill === "interp").length;
const fillProfile = data.filter(r => r._fill === "profile").length;
const gaplessOk = data.length === quality.expectedHours && quality.expectedHours === TOTAL;
const monotonic = data.every((r,i)=> i===0 || new Date(r.timestamp) > new Date(data[i-1].timestamp));
const noDupes = new Set(data.map(r=>r.timestamp)).size === data.length;
const anomalyGone = !data.some(r => (r.import_t1+r.import_t2) > 100);
const julyFill = data.filter(r => r._fill==="profile" && r.timestamp.startsWith("2026-07"));
const avgFillImp = julyFill.reduce((s,r)=>s+r.import_t1,0)/julyFill.length;

const P = (b)=> b ? "PASS" : "FAIL";
console.log("=== TEST 8: importcheck + gaten vullen ===");
console.log(`Ruw in ${before} rijen (incl. dup+anomalie) → ${data.length} na opschonen`);
console.log(`completeness ${quality.completenessPct}% · interp ${quality.interpHours} · profiel ${quality.profileHours} · grote periodes ${quality.largePeriods.length}`);
console.log(`${P(gaplessOk)}  Gatenloos & exact ${TOTAL}u`);
console.log(`${P(monotonic && noDupes)}  Chronologisch + geen duplicaten`);
console.log(`${P(fillSmall===4)}  Klein gat (3u) + anomalie-uur geïnterpoleerd → ${fillSmall} (3 + 1 anomalie)`);
console.log(`${P(fillProfile===(5+10)*24)}  Grote periodes via standaardprofiel → ${fillProfile} (verwacht ${(5+10)*24})`);
console.log(`${P(quality.largePeriods.length===2)}  Precies 2 grote periodes gemeld`);
console.log(`${P(quality.realHours===TOTAL-3-(5+10)*24-1)}  realHours klopt (incl. -1 anomalie) → ${quality.realHours}`);
console.log(`${P(anomalyGone)}  Anomalie (9999) verwijderd & gevuld`);
console.log(`${P(avgFillImp>0.05 && avgFillImp<1.5)}  Plausibele ingevulde juli-afname: ${avgFillImp.toFixed(3)} kWh`);
