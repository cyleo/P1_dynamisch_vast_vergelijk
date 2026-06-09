
/**
 * Parses a Home Assistant CSV history export (long format).
 * Returns processed hourly records for the digital twin simulation.
 */
export function parseHAHistoryExportCSV(lines, sep, headers, roleMap, dtEnabled) {
  const entityIdx = 0;
  const stateIdx = 1;
  const tsIdx = 2;

  const hourlyData = {}; 

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim());
    if (cols.length < 3) continue;
    
    const entity = cols[entityIdx];
    const val = parseFloat(cols[stateIdx]);
    if (isNaN(val)) continue;
    
    const ms = new Date(cols[tsIdx]).getTime();
    if (isNaN(ms)) continue;
    
    const hourMs = Math.floor(ms / (3600 * 1000)) * (3600 * 1000);
    
    if (!hourlyData[entity]) hourlyData[entity] = {};
    if (!hourlyData[entity][hourMs] || hourlyData[entity][hourMs].ms < ms) {
      hourlyData[entity][hourMs] = { ms, val };
    }
  }

  const stats = {};
  for (const [entity, hours] of Object.entries(hourlyData)) {
    stats[entity] = Object.entries(hours)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([hourMs, data]) => ({
        start: Number(hourMs),
        sum: data.val
      }));
  }

  return processHAStatistics(stats, roleMap, dtEnabled);
}

/**
 * Parses a wide-format CSV (each entity is a column).
 * Asks the user via modal to map columns to simulation roles, then processes it.
 */
export async function parseHAStatisticsWideCSVAsync(lines, sep, headers, showCsvMapModal) {
  const timestamps = headers.slice(3).map(h => new Date(h.trim()));
  if (timestamps.some(d => isNaN(d.getTime()))) {
    throw new Error("Ongeldige tijdstempels in CSV-header. Controleer het bestand.");
  }

  const sensorMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    if (cols.length < 4) continue;
    const entityId = cols[0].trim();
    const unit = cols[2]?.trim() || "kWh";
    const values = cols.slice(3).map(v => {
      const n = parseFloat(v.trim());
      return isNaN(n) || n < 0 ? 0 : n;
    });
    sensorMap[entityId] = { values, unit };
  }

  const entities = Object.keys(sensorMap);
  if (entities.length === 0) {
    throw new Error("Geen sensoren gevonden in het CSV-bestand.");
  }

  function findSensor(patterns) {
    for (const p of patterns) {
      const key = entities.find(k => k.toLowerCase().includes(p));
      if (key) return { id: key, values: sensorMap[key].values };
    }
    return null;
  }

  const imp1Match = findSensor(["import_tariff_1", "import_t1", "afname_tarief_1", "delivery_tariff_1"]);
  const imp2Match = findSensor(["import_tariff_2", "import_t2", "afname_tarief_2", "delivery_tariff_2"]);
  const exp1Match = findSensor(["export_tariff_1", "export_t1", "return_tariff_1", "teruglevering_tariff_1"]);
  const exp2Match = findSensor(["export_tariff_2", "export_t2", "return_tariff_2", "teruglevering_tariff_2"]);
  const solarMatch = findSensor(["solar", "sol", "zon", "opwek", "pv", "inverter"]);
  const evMatch = findSensor(["ev", "charger", "laadpaal", "auto", "wallbox"]);
  const hpMatch = findSensor(["hp", "heatpump", "warmtepomp", "nibe", "compressor"]);
  const batInMatch = findSensor(["bat_in", "battery_charge", "batterij_laden", "powerwall_charge"]);
  const batOutMatch = findSensor(["bat_out", "battery_discharge", "batterij_ontladen", "powerwall_discharge"]);

  const selection = await showCsvMapModal(entities, {
    imp1: imp1Match?.id || "",
    imp2: imp2Match?.id || "",
    exp1: exp1Match?.id || "",
    exp2: exp2Match?.id || "",
    solar: solarMatch?.id || "",
    ev: evMatch?.id || "",
    hp: hpMatch?.id || "",
    batIn: batInMatch?.id || "",
    batOut: batOutMatch?.id || ""
  });

  const getSensorValuesKwh = (entityId) => {
    if (!entityId || !sensorMap[entityId]) return null;
    const { values, unit } = sensorMap[entityId];
    const isWattBased = unit.toLowerCase() === "wh" || unit.toLowerCase() === "w";
    if (isWattBased) {
      return values.map(v => v / 1000);
    }
    return values;
  };

  const imp1 = getSensorValuesKwh(selection.imp1);
  const imp2 = getSensorValuesKwh(selection.imp2);
  const exp1 = getSensorValuesKwh(selection.exp1);
  const exp2 = getSensorValuesKwh(selection.exp2);
  const solar = getSensorValuesKwh(selection.solar);
  const ev = getSensorValuesKwh(selection.ev);
  const hp = getSensorValuesKwh(selection.hp);
  const batIn = getSensorValuesKwh(selection.batIn);
  const batOut = getSensorValuesKwh(selection.batOut);

  let resolution = "day";
  if (timestamps.length > 1) {
    const gapMs = timestamps[1] - timestamps[0];
    if (gapMs <= 60 * 60 * 1000) resolution = "hour"; // ≤ 1 hour gap = hourly data
    else if (gapMs <= 15 * 60 * 1000) resolution = "15min";
  }

  // Build output records
  const records = [];
  for (let i = 0; i < timestamps.length; i++) {
    records.push({
      timestamp: timestamps[i].toISOString(),
      import_t1: imp1 ? (imp1[i] || 0) : 0,
      import_t2: imp2 ? (imp2[i] || 0) : 0,
      export_t1: exp1 ? (exp1[i] || 0) : 0,
      export_t2: exp2 ? (exp2[i] || 0) : 0,
    });
  }

  console.info(`HA Statistics CSV: ${resolution} resolution, ${records.length} records, sensors selected/found:`,
    { imp1: !!imp1, imp2: !!imp2, exp1: !!exp1, exp2: !!exp2 });

  return records;
}

// ─── Tidy-CSV helpers (netbeheerder / HomeWizard / custom exports) ────────────

/** Strips unit suffixes like "(kWh)" and lowercases a CSV header. */
function normHeader(h) {
  return h.toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
}

/** Parses a number that may use a Dutch comma as decimal separator. */
function parseDutchFloat(s) {
  if (!s) return 0;
  return Math.max(0, parseFloat(String(s).trim().replace(",", ".")) || 0);
}

/**
 * Parses a date string that may be ISO 8601 or Dutch DD-MM-YYYY.
 * Accepts an optional separate time part (e.g. from a "Van"-column).
 */
function parseFlexDate(datePart, timePart = "") {
  const s = (datePart + (timePart ? " " + timePart : "")).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // DD-MM-YYYY[( |T)HH:MM[:SS]]
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
      parseInt(m[4] || 0), parseInt(m[5] || 0), parseInt(m[6] || 0)
    );
  }
  return null;
}

/**
 * Resamples sub-hourly records (e.g. 15-min kwartierwaarden) to hourly by summing.
 * Input records must have a `.ts` Date and import_t1/t2, export_t1/t2 fields.
 */
function resampleToHourly(raw) {
  if (raw.length === 0) return [];
  const HOUR_MS = 3_600_000;
  const isSubHourly = raw.length >= 2 && (raw[1].ts - raw[0].ts) < HOUR_MS;
  if (!isSubHourly) {
    return raw.map(r => ({
      timestamp: r.ts.toISOString(),
      import_t1: r.import_t1, import_t2: r.import_t2,
      export_t1: r.export_t1, export_t2: r.export_t2,
    }));
  }
  const buckets = new Map();
  for (const r of raw) {
    const key = Math.floor(r.ts.getTime() / HOUR_MS) * HOUR_MS;
    if (!buckets.has(key)) buckets.set(key, { import_t1: 0, import_t2: 0, export_t1: 0, export_t2: 0 });
    const b = buckets.get(key);
    b.import_t1 += r.import_t1; b.import_t2 += r.import_t2;
    b.export_t1 += r.export_t1; b.export_t2 += r.export_t2;
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a - b)
    .map(([ms, v]) => ({ timestamp: new Date(ms).toISOString(), ...v }));
}

/**
 * Column name vocabularies for each role.
 * Covers Enexis, Liander, Stedin, HomeWizard, and the existing HA tidy-CSV format.
 */
const COLUMN_PATTERNS = {
  imp1: [
    "import_t1", "afname_t1", "verbruik_piek", "delivery_t1",
    "verbruik hoog", "afname hoog", "levering hoog", "stroom verbruik t1", "afname t1", "verbruik t1",
    "import high", "import-high", "consumption t1", "consumption high",
  ],
  imp2: [
    "import_t2", "afname_t2", "verbruik_dal", "delivery_t2",
    "verbruik laag", "afname laag", "levering laag", "stroom verbruik t2", "afname t2", "verbruik t2",
    "import low", "import-low", "consumption t2", "consumption low",
  ],
  exp1: [
    "export_t1", "teruglevering_t1", "return_t1",
    "teruglevering hoog", "retour hoog", "stroom teruglever t1", "teruglevering t1", "productie t1",
    "export high", "export-high", "production t1", "production high",
  ],
  exp2: [
    "export_t2", "teruglevering_t2", "return_t2",
    "teruglevering laag", "retour laag", "stroom teruglever t2", "teruglevering t2", "productie t2",
    "export low", "export-low", "production t2", "production low",
  ],
};

/**
 * Resolves column indices from normalized headers.
 * Returns { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx } or null when
 * no timestamp or no import column is found (caller should show fallback modal).
 */
function detectColumnIndices(norm) {
  const find = (names) => { for (const n of names) { const i = norm.indexOf(n); if (i !== -1) return i; } return -1; };
  const tsIdx = find(["timestamp", "datetime", "datum", "date"]);
  if (tsIdx === -1) return null;
  const timeIdx = find(["van", "from", "start", "start time", "starttijd"]);
  const i1Idx = find(COLUMN_PATTERNS.imp1);
  const i2Idx = find(COLUMN_PATTERNS.imp2);
  if (i1Idx === -1 && i2Idx === -1) return null;
  const e1Idx = find(COLUMN_PATTERNS.exp1);
  const e2Idx = find(COLUMN_PATTERNS.exp2);
  return { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx };
}

/** Core row parser shared by auto-detect and manual-mapping paths. */
function parseLongCSVCore(lines, sep, { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx }) {
  const pf = (cols, i) => i !== -1 ? parseDutchFloat(cols[i]) : 0;
  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim());
    if (!cols[tsIdx]) continue;
    const ts = parseFlexDate(cols[tsIdx], timeIdx !== -1 ? (cols[timeIdx] || "") : "");
    if (!ts) continue;
    raw.push({ ts, import_t1: pf(cols, i1Idx), import_t2: pf(cols, i2Idx),
                   export_t1: pf(cols, e1Idx), export_t2: pf(cols, e2Idx) });
  }
  return resampleToHourly(raw);
}

/**
 * Guesses column roles from raw header strings.
 * Exported so parseAutoCSVAsync can pre-fill the mapping modal.
 */
export function guessColumnRoles(headers) {
  const norm = headers.map(normHeader);
  const find = (patterns) => { for (const p of patterns) { const i = norm.indexOf(p); if (i !== -1) return headers[i]; } return ""; };
  return {
    imp1: find(COLUMN_PATTERNS.imp1), imp2: find(COLUMN_PATTERNS.imp2),
    exp1: find(COLUMN_PATTERNS.exp1), exp2: find(COLUMN_PATTERNS.exp2),
    solar: find(["solar", "zon", "opwek", "pv", "zonnepanelen"]),
    ev: find(["ev", "charger", "laadpaal"]),
    hp: find(["hp", "heatpump", "warmtepomp"]),
    batIn: find(["bat_in", "battery_charge", "batterij_laden"]),
    batOut: find(["bat_out", "battery_discharge", "batterij_ontladen"]),
  };
}

/**
 * Parses a standard tidy-CSV (netbeheerder, HomeWizard, or custom P1 export) with
 * auto-detected column names. Returns hourly records, or null when columns cannot
 * be resolved — caller should then show the mapping modal and use parseLongCSVWithMapping.
 * Handles DD-MM-YYYY dates, Dutch comma decimals, and 15-min kwartierwaarden.
 */
export function parseLongCSV(lines, sep, headers) {
  const norm = headers.map(normHeader);
  const colIndices = detectColumnIndices(norm);
  if (!colIndices) return null;
  return parseLongCSVCore(lines, sep, colIndices);
}

/**
 * Parses a tidy-CSV using an explicit column mapping supplied by the user via modal.
 * mapping = { imp1: "column header", imp2: ..., exp1: ..., exp2: ... }
 */
export function parseLongCSVWithMapping(lines, sep, headers, mapping) {
  const norm = headers.map(normHeader);
  const findIdx = (name) => { if (!name) return -1; return norm.indexOf(normHeader(name)); };
  const tsIdx = norm.findIndex(h => ["timestamp", "datetime", "datum", "date"].includes(h));
  if (tsIdx === -1) throw new Error("Geen tijdstempelkolom gevonden.");
  const timeIdx = norm.findIndex(h => ["van", "from", "start", "start time"].includes(h));
  const i1Idx = findIdx(mapping.imp1), i2Idx = findIdx(mapping.imp2);
  const e1Idx = findIdx(mapping.exp1), e2Idx = findIdx(mapping.exp2);
  if (i1Idx === -1 && i2Idx === -1) throw new Error("Geen import-kolom geselecteerd.");
  return parseLongCSVCore(lines, sep, { tsIdx, timeIdx, i1Idx, i2Idx, e1Idx, e2Idx });
}

/**
 * Core transformer for Home Assistant statistics. 
 * Converts cumulative (or mean) entity data into strict hourly delta records
 * and resolves net/gross overlap using the digital twin mapping.
 */
export function processHAStatistics(stats, roleMap, dtEnabled = true) {
  // stats: { entity_id: [ { start: epochMs, sum: float, mean: float }, ... ] }
  const hourlySum = {};
  const hourlyMean = {};
  for (const [entId, rows] of Object.entries(stats)) {
    const sumMap = new Map();
    const meanMap = new Map();
    for (const row of rows) {
      if (row.sum != null) sumMap.set(row.start, row.sum);
      if (row.mean != null) meanMap.set(row.start, row.mean);
    }
    if (sumMap.size > 0) hourlySum[entId] = sumMap;
    if (meanMap.size > 0) hourlyMean[entId] = meanMap;
  }

  const usedEntities = Object.values(roleMap).filter(Boolean);
  if (usedEntities.every(e => !hourlySum[e] && !hourlyMean[e])) return [];

  const allTs = new Set();
  usedEntities.forEach(e => {
    if (hourlySum[e]) hourlySum[e].forEach((_, t) => allTs.add(t));
    if (hourlyMean[e]) hourlyMean[e].forEach((_, t) => allTs.add(t));
  });
  const timestamps = Array.from(allTs).sort((a, b) => a - b);

  let totBatIn = 0, totBatOut = 0;
  // Eénmalig: zijn er apparaten gekoppeld én is Digital Twin ingeschakeld?
  // dtEnabled=false → bewaar ruwe meterstanden 1-op-1 (gebruiker koos voor uitschakelen).
  const anyDevice = dtEnabled && !!(roleMap.ev || roleMap.hp || roleMap.batIn || roleMap.batOut);

  const highWaterMarks = {};

  const records = [];
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1];
    const curr = timestamps[i];
    if (curr - prev > 2 * 3600 * 1000) continue; // skip gaps > 2h

    const delta = (ent, maxVal = 100) => {
      if (!ent) return 0;
      // 1. Probeer eerst cumulatieve sum (tellerstand)
      if (hourlySum[ent]) {
        let a = highWaterMarks[ent];
        if (a === undefined) {
           a = hourlySum[ent].get(prev) ?? null;
           if (a !== null) highWaterMarks[ent] = a;
        }
        const b = hourlySum[ent].get(curr) ?? null;
        if (a === null || b === null) return 0;

        let d = b - a;
        if (d < 0) {
           // Bij daling: was het een meter-reset of een glitch?
           if (b >= 0 && b < maxVal * 2) { 
              d = b; // Reset: nieuwe basis
              highWaterMarks[ent] = b;
           } else {
              // Glitch: behoud oude highWaterMark, voeg niks toe totdat we hersteld zijn
              return 0;
           }
        } else {
           highWaterMarks[ent] = b;
        }
        return (d >= 0 && d <= maxVal) ? d : 0;
      }
      // 2. Fallback: probeer mean (live vermogen in W/kW)
      if (hourlyMean[ent]) {
        const val = hourlyMean[ent].get(curr) ?? null;
        if (val === null) return 0;
        return (val > 0 && val <= maxVal) ? val : 0;
      }
      return 0;
    };

    // Solar: gebruik deltaSolar (juiste maxVal voor Wh/W vs kWh/kW)
    const deltaSolar = (ent) => {
      const isWattBased = roleMap.solarUnit === "Wh" || roleMap.solarUnit === "W";
      return isWattBased ? delta(ent, 20000) : delta(ent, 100);
    };

    // Solar: gebruik deltaSolar
    const rawSolarDelta = roleMap.solar ? deltaSolar(roleMap.solar) : null;
    const solarYieldKwh = rawSolarDelta !== null
      ? ((roleMap.solarUnit === "Wh" || roleMap.solarUnit === "W") ? rawSolarDelta / 1000 : rawSolarDelta)
      : null;

    // kWh delta voor apparaat, Wh/W-bewust
    const deviceKwh = (ent, unit) => {
      if (!ent) return 0;
      const isWattBased = unit === "Wh" || unit === "W";
      const d = delta(ent, isWattBased ? 20000 : 100);
      return isWattBased ? d / 1000 : d;
    };

    const evLoad  = deviceKwh(roleMap.ev,     roleMap.evUnit);
    const hpLoad  = deviceKwh(roleMap.hp,     roleMap.hpUnit);
    const batIn   = deviceKwh(roleMap.batIn,  roleMap.batInUnit);
    const batOut  = deviceKwh(roleMap.batOut, roleMap.batOutUnit);

    const imp1 = delta(roleMap.imp1), imp2 = delta(roleMap.imp2);
    const exp1 = delta(roleMap.exp1), exp2 = delta(roleMap.exp2);

    // Accumulate for the battery-boundary sanity check
    totBatIn  += batIn;
    totBatOut += batOut;

    let rec;
    if (anyDevice) {
      // Digital Twin: ontwar in NET-DEMAND space en hersplits naar import/export.
      // Dit collapset het sub-uur import/export-overlap (onvermijdelijk: HA-uurstatistiek
      // verliest timing) én de t1/t2-registers (de engine leidt piek/dal af uit de
      // timestamp, niet uit het register — zie _simulateCore).
      const baseNet = (imp1 + imp2 - exp1 - exp2) - evLoad - hpLoad - batIn + batOut;
      rec = { import_t1: Math.max(0, baseNet), import_t2: 0,
              export_t1: Math.max(0, -baseNet), export_t2: 0 };
    } else {
      // Geen apparaten gekoppeld → bewaar de ruwe meterstanden 1-op-1 (byte-identiek aan
      // het pre-Digital-Twin gedrag). NIET salderen: een uur met gelijktijdige import én
      // export (sub-uur, bv. wolkenflarden) moet bruto blijven, anders onderschatten we de
      // bruto import/export en daarmee de energiebelasting (2027 = EB op bruto afname).
      rec = { import_t1: imp1, import_t2: imp2, export_t1: exp1, export_t2: exp2 };
    }
    rec.timestamp = new Date(curr).toISOString();
    rec.solar_yield = solarYieldKwh;
    records.push(rec);
  }

  // Battery boundary sanity check
  records.untangle = {
    active: anyDevice,
    batIn: totBatIn, batOut: totBatOut,
    batterySensorSuspect: (totBatIn > 0 || totBatOut > 0) && totBatOut > totBatIn * 1.05,
    devices: {
      ev: !!roleMap.ev, hp: !!roleMap.hp,
      battery: !!(roleMap.batIn || roleMap.batOut),
    },
  };

  return records;
}
