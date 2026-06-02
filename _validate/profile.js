// Realistische synthetische jaardata-generator (8760 u) — losse import/export per uur
// zoals een P1-meter ze registreert (bruto, geen uur-saldering).
const YEAR = 2026;

// Maandelijkse zon-opbrengstverdeling NL (% van jaartotaal), bron: typische PVGIS/zonatlas curve
const SOLAR_MONTH_FRAC = [0.030,0.050,0.085,0.115,0.135,0.135,0.140,0.120,0.090,0.058,0.028,0.014];
// Genormaliseerd hieronder.

function solarHourWeight(hour) {
  // klok-bell rond 13u, nul buiten 5-21
  if (hour < 5 || hour > 21) return 0;
  const x = (hour - 13) / 4.2;
  return Math.exp(-x * x);
}

// Basislast-vorm per uur (relatief), avondpiek koken/verlichting
const LOAD_SHAPE = [
  0.45,0.40,0.38,0.37,0.38,0.45, // 0-5
  0.60,0.85,0.80,0.65,0.60,0.62, // 6-11
  0.65,0.60,0.55,0.58,0.70,0.95, // 12-17
  1.25,1.30,1.15,0.95,0.75,0.55  // 18-23
];

function daysInMonth(m){ return new Date(YEAR, m, 0).getDate(); }

/**
 * @param {number} annualLoadKwh  jaarverbruik huis (achter de meter, incl. zelfconsumptie)
 * @param {number} annualSolarKwh  jaar PV-opbrengst (0 = geen panelen)
 */
function buildYear(annualLoadKwh, annualSolarKwh) {
  // Normaliseer load-shape over hele jaar
  const loadShapeSum = LOAD_SHAPE.reduce((a,b)=>a+b,0) * 365; // ~const per dag
  const loadPerUnit = annualLoadKwh / loadShapeSum;

  // Solar: per maand fractie × per-uur weight
  const monFracSum = SOLAR_MONTH_FRAC.reduce((a,b)=>a+b,0);
  const solarWeightDay = []; for(let h=0;h<24;h++) solarWeightDay.push(solarHourWeight(h));
  const solarWeightDaySum = solarWeightDay.reduce((a,b)=>a+b,0);

  const rows = [];
  const start = new Date(YEAR,0,1,0,0,0);
  for (let m=0;m<12;m++){
    const dim = daysInMonth(m);
    const monthSolar = annualSolarKwh * (SOLAR_MONTH_FRAC[m]/monFracSum);
    const solarPerDay = monthSolar / dim;
    for (let d=1; d<=dim; d++){
      for (let h=0;h<24;h++){
        const dt = new Date(YEAR, m, d, h, 0, 0);
        const load = LOAD_SHAPE[h] * loadPerUnit;
        const solar = solarWeightDaySum>0 ? solarPerDay * (solarWeightDay[h]/solarWeightDaySum) : 0;
        const imp = Math.max(0, load - solar);
        const exp = Math.max(0, solar - load);
        rows.push({
          timestamp: dt.toISOString(),
          import_t1: imp, import_t2: 0,
          export_t1: exp, export_t2: 0,
          solar_yield: solar,
        });
      }
    }
  }
  return rows;
}

function sum(rows, f){ return rows.reduce((a,r)=>a+f(r),0); }

module.exports = { buildYear, sum, YEAR };
