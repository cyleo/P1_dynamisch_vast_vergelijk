/* Core Dashboard Logic & Simulation Engine */

// Global state
let energyData = [];
let overviewMode = "day"; // "day" | "week"
let simMode = "day";  // "day" | "week"
let simDrillDay = null;   // YYYY-MM-DD — drill-down naar uurweergave voor die dag
let activeSimulation = {};
let epexHistory = new Map(); // isoHour (floored) → price incl. BTW (€/kWh)
let liveEnergyTax = 0.11084;   // updated by fetchTarieven()

// ── Data-ingest & jaarprojectie ─────────────────────────────────────────────
let isDemoData = true;   // demo/voorbeeld actief? eerste upload vervangt i.p.v. mergt
let fullYearData = null;   // 8760-uurs jaarprojectie (echte + gesynthetiseerde uren); null = geen synthese
let fullYearStamp = "";     // cache-stempel: vermijdt herbouw als energyData/toggle ongewijzigd is
let yearScale = 1.0;    // normaliseert de som van de loop naar exact één jaar (8760u / #uren)
let dataMeta = { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 };

// ── Simulatie-constanten (voorheen verspreide magic numbers) ─────────────────
const EV_MAX_CHARGE_KW = 11.0;   // max laadvermogen EV per uur (kWh)
const BATTERY_C_RATE = 0.5;    // laad/ontlaadvermogen = capaciteit × C-rate
const BATTERY_ARBITRAGE_SPOTMAX = 0.01;   // accu koopt van net wanneer spot ≤ dit (€/kWh)
const BATTERY_DISCHARGE_ALLIN = 0.25;   // accu ontlaadt wanneer all-in prijs > dit (€/kWh)
const EVENING_PEAK_MULT = 3.0;    // koken/verlichting: synthetische avond × baseload (17–21u)

// Cacht per rij de afgeleide lokale tijdvelden (één Date-parse i.p.v. tig in de 8760-loops).
// Lokale dayKey houdt de daggroepering consistent met getHours()/getDay() (geen UTC-drift).
function rowMeta(row) {
  if (row._meta) return row._meta;
  const dt = new Date(row.timestamp);
  const p2 = n => (n < 10 ? "0" + n : "" + n);
  const mo = dt.getMonth() + 1, da = dt.getDate(), h = dt.getHours();
  const dayKey = `${dt.getFullYear()}-${p2(mo)}-${p2(da)}`;
  const meta = { hour: h, date: da, month: mo, dow: dt.getDay(), dayKey, epexKey: `${dayKey}T${p2(h)}` };
  Object.defineProperty(row, "_meta", { value: meta, enumerable: false, configurable: true });
  return meta;
}

// Constant market prices & taxes (fallback if live fetch fails)
const ENERGY_TAX_2026 = 0.11084; // €/kWh (including VAT)

// Lokale datum+uur sleutel voor epexHistory (vermijdt UTC/lokaal-tijdzone verwarring)
function epexKey(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}T${String(dt.getHours()).padStart(2, '0')}`;
}

// CORRECTIE: Consumentenprijs berekening
function toConsumerPrice(spot) {
  const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.02;
  // spot is bij Frank/EnergyZero vaak al incl. BTW op de kale energie.
  // We zorgen hier dat de opslag + BTW en de energiebelasting er zuiver bij komen.
  return spot + (markup * 1.21) + liveEnergyTax;
}

// Seizoensgebonden EPEX-fallbackprofielen (ruwe beursprijzen €/kWh, excl. BTW, excl. EB, excl. opslag)
// Gebaseerd op typische Nederlandse EPEX-patronen per seizoen.
// getFallbackSpot() past automatisch BTW toe (×1.21) op positieve uren.
const EPEX_PROFILES = {
  // Dec · Jan · Feb — hoge nachten/avonden, koude pieken, zelden negatief
  winter: {
    0: 0.08, 1: 0.07, 2: 0.07, 3: 0.07, 4: 0.07, 5: 0.08,
    6: 0.11, 7: 0.14, 8: 0.16, 9: 0.14, 10: 0.12, 11: 0.10,
    12: 0.10, 13: 0.10, 14: 0.11, 15: 0.12, 16: 0.14, 17: 0.18,
    18: 0.16, 19: 0.14, 20: 0.12, 21: 0.10, 22: 0.09, 23: 0.08
  },
  // Mrt · Apr · Mei — zonnepanelen drukken middag sterk negatief
  spring: {
    0: 0.06, 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.06,
    6: 0.08, 7: 0.10, 8: 0.10, 9: 0.04, 10: 0.00, 11: -0.02,
    12: -0.05, 13: -0.06, 14: -0.05, 15: -0.02, 16: 0.02, 17: 0.08,
    18: 0.12, 19: 0.14, 20: 0.12, 21: 0.10, 22: 0.08, 23: 0.07
  },
  // Jun · Jul · Aug — diepe negatieve middagen, zeer goedkope nachten
  summer: {
    0: 0.04, 1: 0.03, 2: 0.03, 3: 0.02, 4: 0.02, 5: 0.04,
    6: 0.06, 7: 0.08, 8: 0.08, 9: 0.04, 10: 0.00, 11: -0.02,
    12: -0.04, 13: -0.04, 14: -0.03, 15: 0.00, 16: 0.04, 17: 0.08,
    18: 0.11, 19: 0.13, 20: 0.12, 21: 0.10, 22: 0.08, 23: 0.06
  },
  // Sep · Okt · Nov — mix, loopt op richting winter
  autumn: {
    0: 0.07, 1: 0.06, 2: 0.06, 3: 0.06, 4: 0.06, 5: 0.07,
    6: 0.09, 7: 0.12, 8: 0.14, 9: 0.10, 10: 0.08, 11: 0.06,
    12: 0.05, 13: 0.05, 14: 0.06, 15: 0.08, 16: 0.12, 17: 0.16,
    18: 0.17, 19: 0.15, 20: 0.12, 21: 0.10, 22: 0.09, 23: 0.08
  }
};

/**
 * Geeft de fallback EPEX-spotprijs voor een specifieke maand + uur.
 * Retourneert de ruwe beursprijs × 1.21 (BTW) voor positieve uren;
 * negatieve uren worden niet met BTW verhoogd (leverancier vergoedt de negatieve prijs 1-op-1).
 * @param {number} month  1–12
 * @param {number} hour   0–23
 * @returns {number} spot in €/kWh, incl. BTW, excl. EB en opslag
 */
function getFallbackSpot(month, hour) {
  let season;
  if (month >= 3 && month <= 5) season = 'spring';
  else if (month >= 6 && month <= 8) season = 'summer';
  else if (month >= 9 && month <= 11) season = 'autumn';
  else season = 'winter';
  const raw = EPEX_PROFILES[season][hour];
  return raw >= 0 ? raw * 1.21 : raw;
}

// ─── Leverancier-presets (indicatieve waarden 2025/2026 — controleer eigen contract) ──
// Vult de tariefschuiven; teruglevertarief/VTK volgens gevonden marktcijfers, piek/dal
// en opslag als typische NL-marktbenadering. Stappen sluiten aan op de slider-steps.
const SUPPLIER_PRESETS = {
  vattenfall: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.045, "dynamic-markup": 0.025 },
  eneco: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.040, "fixed-feedin-fee": 0.030, "dynamic-markup": 0.025 },
  greenchoice: { "fixed-peak": 0.29, "fixed-dal": 0.26, "fixed-feedin-rate": 0.040, "fixed-feedin-fee": 0.010, "dynamic-markup": 0.020 },
  budgetthuis: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.020, "dynamic-markup": 0.020 },
  anwb: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.050, "fixed-feedin-fee": 0.000, "dynamic-markup": 0.020 },
  zonneplan: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.050, "fixed-feedin-fee": 0.000, "dynamic-markup": 0.015 },
};

// Aangeroepen vanuit de leverancier-dropdown (inline onchange). setSlider() (verderop,
// gehoist) zet de waarde + badge in hetzelfde "€ x.xx"-format als de live-fetch.
function applySupplierPreset(key) {
  const preset = SUPPLIER_PRESETS[key];
  if (!preset) return;   // lege keuze → niets doen
  for (const [id, val] of Object.entries(preset)) setSlider(id, val);
  runSimulation();
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  restoreHACredentials();
  loadDemoData();
});

// Setup Events
function setupEventListeners() {
  // Slider input reactive badges
  const sliders = document.querySelectorAll('input[type="range"]');
  sliders.forEach(slider => {
    slider.addEventListener("input", (e) => {
      const badge = document.getElementById(`${e.target.id}-val`);
      if (badge) {
        let suffix = e.target.dataset.suffix || "";
        badge.textContent = `${e.target.value}${suffix}`;
      }
      runSimulation();
    });
  });

  // Toggles for EV, Battery, Heat Pump
  const toggles = ["has-ev", "has-battery", "has-heatpump"];
  toggles.forEach(toggleId => {
    const el = document.getElementById(toggleId);
    el.addEventListener("change", (e) => {
      const panel = document.getElementById(`${toggleId}-panel`);
      if (panel) {
        if (e.target.checked) {
          panel.classList.add("open");
        } else {
          panel.classList.remove("open");
        }
      }
      runSimulation();
    });
  });

  // Selector toggles
  document.getElementById("ev-solar-match").addEventListener("change", runSimulation);
  document.getElementById("ev-profile")?.addEventListener("change", runSimulation);
  document.getElementById("bat-arbitrage").addEventListener("change", runSimulation);
  document.getElementById("bat-grid-export")?.addEventListener("change", runSimulation);
  // solar-dimming-mode: onchange al in HTML, hier alleen uitleg-tekst tonen
  const solarModeEl = document.getElementById("solar-dimming-mode");
  if (solarModeEl) {
    const updateDimmingExplain = () => {
      const v = solarModeEl.value;
      const el = document.getElementById("solar-dimming-explain");
      if (!el) return;
      const hasSensor = (document.getElementById("sel-solar")?.value || "") !== "";
      const sensorNote = hasSensor
        ? "✓ Omvormer-sensor gekoppeld — nauwkeurige berekening."
        : "⚠ Geen omvormer-sensor — schatting op basis van P1-meterdata.";
      if (v === "off") { el.style.display = "none"; return; }
      el.style.display = "block";
      if (v === "dim") {
        el.innerHTML = `<strong>Dimmen</strong>: de omvormer regelt automatisch af tot het momentele huisverbruik. Zonne-energie voedt nog steeds het huis — alleen het <em>overschot</em> dat naar het net zou gaan, wordt onderdrukt.<br>Effect op dynamisch: <strong>export = 0, import ≈ 0</strong> wanneer zonneopwek ≥ huisverbruik.<br><em>${sensorNote}</em>`;
      } else {
        el.innerHTML = `<strong>Uitschakelen</strong>: omvormer compleet uit. Het huis trekt in die uren <em>alles</em> van het net, inclusief wat de panelen normaal zelf opwekten.<br>Effect op dynamisch: <strong>export = 0, import = volledig huisverbruik</strong> van het net.<br>${hasSensor ? `✓ Met sensor kan echt huisverbruik berekend worden.` : `⚠ Zonder omvormer-sensor is de berekening minder nauwkeurig (zelf-verbruik van zonne is onbekend).`}`;
      }
    };
    solarModeEl.addEventListener("change", updateDimmingExplain);
    updateDimmingExplain();
  }

  // File Dropzone setup
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileSelect);

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files || []);
    for (const f of files) await processFile(f);
  });

  // Home Assistant: step 1 = connect & discover sensors, step 2 = import data
  document.getElementById("ha-connect-btn").addEventListener("click", handleHAConnect);
  document.getElementById("ha-import-btn").addEventListener("click", handleHAImport);

  // Live tarieven ophalen
  document.getElementById("fetch-tarieven-btn").addEventListener("click", fetchTarieven);

  // Sweet Spot Finder: optimale accu-grootte berekenen
  document.getElementById("optimize-battery-btn")?.addEventListener("click", optimizeBatterySize);

  // Setup Modal
  document.getElementById("show-setup-btn").addEventListener("click", showSetupModal);
  document.getElementById("modal-close").addEventListener("click", closeSetupModal);
  document.getElementById("modal-backdrop").addEventListener("click", closeSetupModal);
}

// Restore saved HA credentials from localStorage
function restoreHACredentials() {
  const savedUrl = localStorage.getItem("ha_url");
  const savedToken = localStorage.getItem("ha_token");
  if (savedUrl) document.getElementById("ha-url").value = savedUrl;
  if (savedToken) document.getElementById("ha-token").value = savedToken;
}

// Load Personalized HA Demo Data
async function loadDemoData() {
  try {
    const response = await fetch("p1_sample.json");
    if (!response.ok) throw new Error("Sample file missing");
    energyData = await response.json();
    isDemoData = true;   // markeer als demo zodat de eerste upload deze vervangt
    document.getElementById("data-status").textContent = "Voorbeelddata geladen — koppel jouw HA voor persoonlijke data";
    runSimulation();
  } catch (error) {
    console.error("Failed to load demo data:", error);
    document.getElementById("data-status").textContent = "Upload je eigen P1 bestand om te starten";
  }
}

// Setup Modal: show CORS instructions dynamically
function showSetupModal(tab) {
  const isFile = window.location.protocol === "file:";
  const origin = isFile ? "http://localhost:8080" : window.location.origin;

  document.getElementById("modal-cors-snippet").textContent =
    `http:\n  cors_allowed_origins:\n    - ${origin}`;

  // Fill nginx origin placeholders
  document.querySelectorAll("#nginx-origin, #nginx-origin2").forEach(el => el.textContent = origin);

  document.getElementById("modal-backdrop").style.display = "flex";

  // Auto-open nginx tab if coming from a reverse-proxy error
  if (typeof showModalTab === "function") showModalTab(tab || "direct");
}

function closeSetupModal() {
  document.getElementById("modal-backdrop").style.display = "none";
}

function copySetupSnippet() {
  const origin = window.location.origin;
  const snippet = `http:\n  cors_allowed_origins:\n    - ${origin}`;
  navigator.clipboard.writeText(snippet).then(() => {
    const btn = document.getElementById("copy-snippet-btn");
    btn.textContent = "Gekopieerd! ✓";
    setTimeout(() => btn.textContent = "Kopieer naar klembord", 2000);
  });
}

// Handle P1 File Uploads — meerdere bestanden sequentieel mergen
async function handleFileSelect(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  for (const f of files) await processFile(f);
  e.target.value = "";   // reset zodat hetzelfde bestand opnieuw gekozen kan worden
}

function processFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    document.getElementById("data-status").textContent = "Bezig met verwerken…";

    reader.onload = function (event) {
      try {
        let parsed = [];
        if (file.name.endsWith(".json")) {
          const raw = JSON.parse(event.target.result);
          // Support both our native format and HA's JSON statistics export
          if (Array.isArray(raw) && raw[0]?.timestamp !== undefined) {
            parsed = raw; // native format
          } else if (Array.isArray(raw) && raw[0]?.entity_id !== undefined) {
            parsed = parseHAStatisticsJSON(raw);
          } else {
            throw new Error("Onbekend JSON-formaat. Gebruik een HA statistieken export of onze eigen export.");
          }
        } else if (file.name.endsWith(".csv")) {
          parsed = parseAutoCSV(event.target.result);
        } else {
          throw new Error("Ongeldig bestandstype. Selecteer een .json of .csv bestand.");
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Geen geldige P1-stroomgegevens gevonden. Controleer of het bestand import/export sensor data bevat.");
        }

        // Demo-data wordt door de eerste echte upload vervangen; daarna mergen we erbij.
        if (isDemoData) { energyData = []; isDemoData = false; }

        // ── Merge + dedup op timestamp (nieuw overschrijft oud) + chronologisch ──
        const merged = new Map();
        for (const r of energyData) merged.set(r.timestamp, r);
        for (const r of parsed) merged.set(r.timestamp, r);
        energyData = Array.from(merged.values())
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const span = energyData.length > 0
          ? ` (${new Date(energyData[0].timestamp).toLocaleDateString("nl-NL")} t/m ${new Date(energyData[energyData.length - 1].timestamp).toLocaleDateString("nl-NL")})`
          : "";
        document.getElementById("data-status").textContent =
          `✓ ${file.name} — ${parsed.length} records · ${energyData.length} totaal${span}`;
        runSimulation();
      } catch (error) {
        console.error("Parse error:", error);
        showUploadError(error.message);
      } finally {
        resolve();
      }
    };
    reader.onerror = () => { showUploadError("Bestand kon niet gelezen worden."); resolve(); };
    reader.readAsText(file);
  });
}

function showUploadError(msg) {
  document.getElementById("data-status").textContent = "Upload mislukt";
  // Show inline error below the dropzone instead of a blocking alert
  let errEl = document.getElementById("upload-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.id = "upload-error";
    errEl.style.cssText = "color:var(--accent-orange);font-size:0.8rem;margin-top:0.6rem;";
    document.getElementById("dropzone").after(errEl);
  }
  errEl.textContent = "⚠ " + msg;
  setTimeout(() => { errEl.textContent = ""; }, 8000);
}

// ─── Auto-detect CSV format and dispatch to the right parser ────────────────
function parseAutoCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV is leeg of heeft slechts één rij.");

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim());

  // Detect HA Statistics Export: first three headers are entity_id, type, unit
  if (headers[0].toLowerCase() === "entity_id" &&
    headers[1].toLowerCase() === "type" &&
    headers[2].toLowerCase() === "unit") {
    return parseHAStatisticsWideCSV(lines, sep, headers);
  }

  // Detect long/tidy format (has a timestamp column)
  if (headers.some(h => ["timestamp", "datetime", "datum", "date"].includes(h.toLowerCase()))) {
    return parseLongCSV(lines, sep, headers);
  }

  throw new Error(
    "CSV-formaat niet herkend. Exporteer vanuit HA via Instellingen → Statistieken → Exporteer, " +
    "of gebruik onze eigen .json export."
  );
}

// ─── Parser for HA Statistics Export (wide/pivoted format) ──────────────────
// Format: entity_id | type | unit | 2025-01-01T00:00Z | 2025-01-01T01:00Z | …
// Each value is the change (kWh) for that period.
function parseHAStatisticsWideCSV(lines, sep, headers) {
  // Date timestamps start at column index 3
  const timestamps = headers.slice(3).map(h => new Date(h.trim()));
  if (timestamps.some(d => isNaN(d.getTime()))) {
    throw new Error("Ongeldige tijdstempels in CSV-header. Controleer het bestand.");
  }

  // Parse all sensor rows into a map: entity_id → [values]
  const sensorMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    if (cols.length < 4) continue;
    const entityId = cols[0].trim();
    const values = cols.slice(3).map(v => {
      const n = parseFloat(v.trim());
      return isNaN(n) || n < 0 ? 0 : n;
    });
    sensorMap[entityId] = values;
  }

  // Flexible matching: find best match for each of the 4 P1 sensors
  function findSensor(patterns) {
    for (const p of patterns) {
      const key = Object.keys(sensorMap).find(k => k.toLowerCase().includes(p));
      if (key) return sensorMap[key];
    }
    return null;
  }

  const imp1 = findSensor(["import_tariff_1", "import_t1", "afname_tarief_1", "delivery_tariff_1"]);
  const imp2 = findSensor(["import_tariff_2", "import_t2", "afname_tarief_2", "delivery_tariff_2"]);
  const exp1 = findSensor(["export_tariff_1", "export_t1", "return_tariff_1", "teruglevering_tariff_1"]);
  const exp2 = findSensor(["export_tariff_2", "export_t2", "return_tariff_2", "teruglevering_tariff_2"]);

  // Require at least import sensors
  if (!imp1 && !imp2) {
    const found = Object.keys(sensorMap).slice(0, 5).join(", ");
    throw new Error(
      `Geen P1 import sensoren gevonden in CSV. ` +
      `Gevonden rijen: ${found}. ` +
      `Zorg dat het bestand 'p1_meter_energy_import_tariff_1' en/of '_tariff_2' bevat.`
    );
  }

  // Detect resolution from first timestamp gap
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

  console.info(`HA Statistics CSV: ${resolution} resolution, ${records.length} records, sensors found:`,
    { imp1: !!imp1, imp2: !!imp2, exp1: !!exp1, exp2: !!exp2 });

  return records;
}

// ─── Parser for long/tidy CSV format ────────────────────────────────────────
// Expected columns: timestamp, import_t1, import_t2, export_t1, export_t2
function parseLongCSV(lines, sep, headers) {
  const idx = (names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.toLowerCase() === n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const tsIdx = idx(["timestamp", "datetime", "datum", "date"]);
  const i1Idx = idx(["import_t1", "afname_t1", "verbruik_piek", "delivery_t1"]);
  const i2Idx = idx(["import_t2", "afname_t2", "verbruik_dal", "delivery_t2"]);
  const e1Idx = idx(["export_t1", "teruglevering_t1", "return_t1"]);
  const e2Idx = idx(["export_t2", "teruglevering_t2", "return_t2"]);

  if (tsIdx === -1) throw new Error("Geen tijdstempelkolom gevonden in CSV.");
  if (i1Idx === -1 && i2Idx === -1) throw new Error("Geen import-kolommen gevonden in CSV.");

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim());
    if (!cols[tsIdx]) continue;
    const pf = (idx) => idx !== -1 ? Math.max(0, parseFloat(cols[idx]) || 0) : 0;
    records.push({
      timestamp: new Date(cols[tsIdx]).toISOString(),
      import_t1: pf(i1Idx),
      import_t2: pf(i2Idx),
      export_t1: pf(e1Idx),
      export_t2: pf(e2Idx),
    });
  }
  return records;
}

// ─── Parser for HA JSON statistics export (array of entity objects) ──────────
function parseHAStatisticsJSON(raw) {
  // HA JSON export: [{ entity_id, type, unit, start, end, mean, min, max, sum, state, change }]
  // or similar. Convert to our format.
  const sensorMap = {};
  raw.forEach(entry => {
    if (!entry.entity_id || entry.change === undefined) return;
    if (!sensorMap[entry.entity_id]) sensorMap[entry.entity_id] = {};
    sensorMap[entry.entity_id][entry.start || entry.timestamp] = Math.max(0, parseFloat(entry.change) || 0);
  });

  // same flexible sensor matching as wide CSV
  function findSensor(patterns) {
    for (const p of patterns) {
      const key = Object.keys(sensorMap).find(k => k.toLowerCase().includes(p));
      if (key) return sensorMap[key];
    }
    return {};
  }

  const imp1 = findSensor(["import_tariff_1", "import_t1"]);
  const imp2 = findSensor(["import_tariff_2", "import_t2"]);
  const exp1 = findSensor(["export_tariff_1", "export_t1"]);
  const exp2 = findSensor(["export_tariff_2", "export_t2"]);

  const allTs = [...new Set([
    ...Object.keys(imp1), ...Object.keys(imp2),
    ...Object.keys(exp1), ...Object.keys(exp2)
  ])].sort();

  return allTs.map(ts => ({
    timestamp: new Date(ts).toISOString(),
    import_t1: imp1[ts] || 0,
    import_t2: imp2[ts] || 0,
    export_t1: exp1[ts] || 0,
    export_t2: exp2[ts] || 0,
  }));
}

// ── Stap 1: verbinden en energiesensoren ophalen ─────────────────────────────
async function handleHAConnect() {
  const urlInput = document.getElementById("ha-url").value.trim();
  const tokenInput = document.getElementById("ha-token").value.trim();
  const statusEl = document.getElementById("ha-sync-status");

  if (!urlInput || !tokenInput) {
    statusEl.innerHTML = "Vul a.u.b. beide velden in.";
    statusEl.style.color = "var(--accent-orange)";
    return;
  }

  // file:// check
  if (window.location.protocol === "file:") {
    statusEl.innerHTML =
      `⚠ Pagina geopend als bestand. Start een lokale server:<br>` +
      `<code style="display:block;margin:0.3rem 0;padding:0.3rem 0.5rem;background:rgba(0,0,0,0.4);border-radius:4px;">python3 -m http.server 8080</code>` +
      `Voeg <strong>http://localhost:8080</strong> toe aan <code>cors_allowed_origins</code> in HA.`;
    statusEl.style.color = "var(--accent-orange)";
    return;
  }

  statusEl.textContent = "Verbinding testen…";
  statusEl.style.color = "var(--accent-cyan)";
  document.getElementById("ha-sensor-picker").style.display = "none";

  const cleanUrl = urlInput.replace(/\/$/, "");

  try {
    // Auth check
    let apiResp;
    try {
      apiResp = await fetch(`${cleanUrl}/api/`, {
        headers: { "Authorization": `Bearer ${tokenInput}` }
      });
    } catch {
      statusEl.innerHTML =
        `⚠ Verbinding mislukt (CORS preflight geweigerd).<br>` +
        `Voeg <code>${window.location.origin}</code> toe aan <code>cors_allowed_origins</code> in HA en herstart. ` +
        `<a href="#" onclick="showSetupModal('direct'); return false;" style="color:var(--accent-cyan);">Gids →</a>`;
      statusEl.style.color = "var(--accent-orange)";
      return;
    }
    if (apiResp.status === 401) {
      statusEl.textContent = "Ongeldige token — controleer je Long-Lived Access Token.";
      statusEl.style.color = "var(--accent-orange)";
      return;
    }

    // Fetch all states to find energy sensors
    statusEl.textContent = "Sensoren ophalen…";
    const statesResp = await fetch(`${cleanUrl}/api/states`, {
      headers: { "Authorization": `Bearer ${tokenInput}` }
    });
    const allStates = await statesResp.json();

    // Filter: kWh-sensoren (voor P1 import/export én solar)
    const kwhSensors = allStates
      .filter(s => s.attributes?.unit_of_measurement === "kWh")
      .map(s => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "kWh", unavailable };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // Wh-sensoren: omvormers (Enphase, SolarEdge, Fronius…) rapporteren vaak in Wh.
    // Deze zijn alleen beschikbaar voor de solar-sensor — bij verwerking ÷ 1000.
    const whSensors = allStates
      .filter(s => s.attributes?.unit_of_measurement === "Wh")
      .map(s => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "Wh", unavailable };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (kwhSensors.length === 0) {
      statusEl.textContent = "Geen kWh sensoren gevonden in deze HA.";
      statusEl.style.color = "var(--accent-orange)";
      return;
    }

    // Auto-detect best candidates per role
    const guess = (patterns) =>
      (kwhSensors.find(s => patterns.some(p => s.id.toLowerCase().includes(p))) || {}).id || "";

    const savedSensors = JSON.parse(localStorage.getItem("ha_sensors") || "{}");

    populateSensorSelect("sel-imp1", kwhSensors,
      savedSensors.imp1 || guess(["import_tariff_1", "import_t1", "afname_tariff_1", "energy_import_tariff_1"]));
    populateSensorSelect("sel-imp2", kwhSensors,
      savedSensors.imp2 || guess(["import_tariff_2", "import_t2", "afname_tariff_2", "energy_import_tariff_2"]));
    populateSensorSelect("sel-exp1", kwhSensors,
      savedSensors.exp1 || guess(["export_tariff_1", "export_t1", "return_tariff_1", "energy_export_tariff_1"]));
    populateSensorSelect("sel-exp2", kwhSensors,
      savedSensors.exp2 || guess(["export_tariff_2", "export_t2", "return_tariff_2", "energy_export_tariff_2"]));

    // Solar yield sensor (optioneel — omvormer productiesensor)
    // Inclusief Wh-sensoren (Enphase/SolarEdge/Fronius rapporteren in Wh — worden ÷ 1000 omgezet).
    const allSolarSensors = [...kwhSensors, ...whSensors]; // kWh eerst, dan Wh
    const solarGuessId = savedSensors.solar ||
      (allSolarSensors.find(s => ["solar", "yield", "opwek", "pv_energy", "inverter", "omvormer", "production", "lifetime_energy"].some(p => s.id.toLowerCase().includes(p))) || {}).id || "";

    // Sla eenheid op zodat processHAStatistics de juiste conversie kan doen
    const sensorUnitMap = {};
    allSolarSensors.forEach(s => { sensorUnitMap[s.id] = s.unit; });
    window._solarSensorUnitMap = sensorUnitMap;  // globale lookup

    const selSolar = document.getElementById("sel-solar");
    const makeOpt = (s) => {
      const label = s.unit === "Wh"
        ? `${s.id} [Wh → wordt omgezet naar kWh]${s.unavailable ? " ⚠ offline" : ""}`
        : `${s.id}${s.unavailable ? " ⚠ offline" : ""}`;
      return `<option value="${s.id}" data-unit="${s.unit}"${s.id === solarGuessId ? " selected" : ""}>${label}</option>`;
    };
    selSolar.innerHTML =
      `<option value="">— Niet koppelen (export-gebaseerde schatting) —</option>` +
      (kwhSensors.length ? `<optgroup label="kWh sensoren">` + kwhSensors.map(makeOpt).join("") + `</optgroup>` : "") +
      (whSensors.length ? `<optgroup label="Wh sensoren (omvormers — Enphase, SolarEdge, Fronius…)">` + whSensors.map(makeOpt).join("") + `</optgroup>` : "");


    localStorage.setItem("ha_url", urlInput);
    localStorage.setItem("ha_token", tokenInput);

    const offlineCount = kwhSensors.filter(s => s.unavailable).length;
    const offlineNote = offlineCount > 0 ? ` (${offlineCount} offline)` : "";
    const whNote = whSensors.length > 0 ? ` · ${whSensors.length} Wh-sensoren (omvormers) voor zonne-meting` : "";
    statusEl.textContent = `✓ Verbonden — ${kwhSensors.length} kWh sensoren${offlineNote}${whNote}. Kies de juiste P1 sensoren hieronder.`;
    statusEl.style.color = "var(--accent-green)";
    document.getElementById("ha-sensor-picker").style.display = "block";

  } catch (err) {
    console.error(err);
    statusEl.textContent = `Fout: ${err.message}`;
    statusEl.style.color = "var(--accent-orange)";
  }
}

function populateSensorSelect(selectId, options, selectedValue) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">— Niet gebruiken —</option>` +
    options.map(s =>
      `<option value="${s.id}"${s.id === selectedValue ? " selected" : ""}>` +
      `${s.id}${s.unavailable ? " ⚠ offline" : ""}` +
      `</option>`
    ).join("");
}

// ── Stap 2: data importeren met gekozen sensoren ──────────────────────────────
async function handleHAImport() {
  const urlInput = document.getElementById("ha-url").value.trim();
  const tokenInput = document.getElementById("ha-token").value.trim();
  const statusEl = document.getElementById("ha-sync-status");
  const days = parseInt(document.getElementById("ha-days").value) || 90;

  const solarSensor = document.getElementById("sel-solar")?.value || "";
  // Bepaal eenheid van de gekozen solar-sensor (kWh of Wh).
  // Volgorde: (1) unit-map van de huidige verbinding, (2) data-unit attribuut op de option,
  // (3) eerder opgeslagen waarde in localStorage, (4) fallback kWh.
  const savedSensorsForUnit = JSON.parse(localStorage.getItem("ha_sensors") || "{}");
  const solarUnit = (window._solarSensorUnitMap?.[solarSensor]) ||
    document.querySelector(`#sel-solar option[value="${CSS.escape(solarSensor)}"]`)?.dataset?.unit ||
    (savedSensorsForUnit.solar === solarSensor ? savedSensorsForUnit.solarUnit : null) ||
    "kWh";

  const entities = [
    document.getElementById("sel-imp1").value,
    document.getElementById("sel-imp2").value,
    document.getElementById("sel-exp1").value,
    document.getElementById("sel-exp2").value,
    solarSensor,
  ].filter(Boolean); // remove empty (not selected)

  if (entities.length === 0) {
    statusEl.textContent = "Selecteer minimaal één sensor.";
    statusEl.style.color = "var(--accent-orange)";
    return;
  }

  // Save sensor choices
  localStorage.setItem("ha_sensors", JSON.stringify({
    imp1: document.getElementById("sel-imp1").value,
    imp2: document.getElementById("sel-imp2").value,
    exp1: document.getElementById("sel-exp1").value,
    exp2: document.getElementById("sel-exp2").value,
    solar: document.getElementById("sel-solar")?.value || "",
    solarUnit,   // onthoud of het Wh of kWh was
  }));

  statusEl.textContent = "Verbinding via WebSocket…";
  statusEl.style.color = "var(--accent-cyan)";

  const cleanUrl = urlInput.replace(/\/$/, "");
  const wsUrl = cleanUrl.replace(/^http/, "ws") + "/api/websocket";

  const roleMap = {
    imp1: document.getElementById("sel-imp1").value,
    imp2: document.getElementById("sel-imp2").value,
    exp1: document.getElementById("sel-exp1").value,
    exp2: document.getElementById("sel-exp2").value,
    solar: document.getElementById("sel-solar")?.value || "",
    solarUnit,   // "kWh" of "Wh" — voor automatische conversie in processHAStatistics
  };

  try {
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    const stats = await fetchHAStatisticsWS(wsUrl, tokenInput, entities, startTime, endTime, statusEl);

    energyData = processHAStatistics(stats, roleMap);
    isDemoData = false;   // echte HA-data: verdere uploads mergen erbij

    if (energyData.length === 0) {
      throw new Error(
        "Statistieken ontvangen maar geen uurrecords gegenereerd. " +
        "Controleer of de geselecteerde sensoren langetermijnstatistieken bijhouden in HA."
      );
    }

    statusEl.textContent = `✓ ${energyData.length} uurrecords geladen · EPEX prijzen ophalen…`;
    statusEl.style.color = "var(--accent-cyan)";

    // Fetch real EPEX prices for the loaded period in the background
    try {
      await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
      statusEl.textContent = `✓ ${energyData.length} uurrecords + ${epexHistory.size} echte EPEX-prijzen geladen (${days} dagen)`;
    } catch (_) {
      statusEl.textContent = `✓ ${energyData.length} uurrecords geladen (EPEX-prijzen niet beschikbaar)`;
    }
    statusEl.style.color = "var(--accent-green)";
    document.getElementById("data-status").textContent =
      `HA statistieken — ${energyData.length} uurrecords (${days}d)`;
    localStorage.setItem("ha_url", urlInput);
    localStorage.setItem("ha_token", tokenInput);
    runSimulation();

  } catch (err) {
    console.error(err);
    statusEl.textContent = `Fout: ${err.message}`;
    statusEl.style.color = "var(--accent-orange)";
  }
}

// ── WebSocket helper: fetch long-term statistics from HA ────────────────────
function fetchHAStatisticsWS(wsUrl, token, statIds, startTime, endTime, statusEl) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl); }
    catch (e) { return reject(new Error("Ongeldig WebSocket-adres: " + wsUrl)); }

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket timeout — controleer het HA-adres."));
    }, 15000);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));

      } else if (msg.type === "auth_ok") {
        if (statusEl) statusEl.textContent = "Statistieken ophalen…";
        ws.send(JSON.stringify({
          id: 1,
          type: "recorder/statistics_during_period",
          start_time: startTime,
          end_time: endTime,
          statistic_ids: statIds,
          period: "hour",
          types: ["sum"]
        }));

      } else if (msg.type === "auth_invalid") {
        clearTimeout(timeout); ws.close();
        reject(new Error("Ongeldige token — controleer je Long-Lived Access Token."));

      } else if (msg.type === "result" && msg.id === 1) {
        clearTimeout(timeout); ws.close();
        if (!msg.success) reject(new Error("HA statistieken-fout: " + JSON.stringify(msg.error)));
        else resolve(msg.result || {});
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket verbinding mislukt — controleer HA-adres."));
    };
  });
}

// ── Convert HA statistics (cumulative sum per hour) to hourly P1 records ───
function processHAStatistics(stats, roleMap) {
  // stats: { entity_id: [ { start: epochMs, sum: float }, ... ] }
  const hourlySum = {};
  for (const [entId, rows] of Object.entries(stats)) {
    const m = new Map();
    for (const row of rows) {
      if (row.sum == null) continue;
      m.set(row.start, row.sum);
    }
    if (m.size > 0) hourlySum[entId] = m;
  }

  const usedEntities = Object.values(roleMap).filter(Boolean);
  if (usedEntities.every(e => !hourlySum[e])) return [];

  const allTs = new Set();
  usedEntities.forEach(e => { if (hourlySum[e]) hourlySum[e].forEach((_, t) => allTs.add(t)); });
  const timestamps = Array.from(allTs).sort((a, b) => a - b);

  const records = [];
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1];
    const curr = timestamps[i];
    if (curr - prev > 2 * 3600 * 1000) continue; // skip gaps > 2h

    const delta = (ent, maxVal = 100) => {
      if (!ent || !hourlySum[ent]) return 0;
      const a = hourlySum[ent].get(prev) ?? null;
      const b = hourlySum[ent].get(curr) ?? null;
      if (a === null || b === null) return 0;
      const d = b - a;
      // Negatief = meter-reset of fout; boven maxVal = absurde piek of reset
      return (d > 0 && d < maxVal) ? d : 0;
    };
    // Voor Wh-sensoren is een uurproductie van 20.000 Wh (20 kWh) realistisch max
    const deltaSolar = (ent) => roleMap.solarUnit === "Wh" ? delta(ent, 20000) : delta(ent, 100);

    // Solar: gebruik deltaSolar (juiste maxVal voor Wh vs kWh)
    const rawSolarDelta = roleMap.solar ? deltaSolar(roleMap.solar) : null;
    const solarYieldKwh = rawSolarDelta !== null
      ? (roleMap.solarUnit === "Wh" ? rawSolarDelta / 1000 : rawSolarDelta)
      : null;

    records.push({
      timestamp: new Date(curr).toISOString(),
      import_t1: delta(roleMap.imp1),
      import_t2: delta(roleMap.imp2),
      export_t1: delta(roleMap.exp1),
      export_t2: delta(roleMap.exp2),
      solar_yield: solarYieldKwh,
    });
  }
  return records;
}

// Convert HA History output to aligned hourly P1 records
// roleMap: { imp1, imp2, exp1, exp2 } — entity_id per rol (leeg = niet gebruikt)
function processHAHistoryToP1(historyArray, roleMap) {

  // ── 1. Build sparse hourly map per entity: hour-ISO → last known cumulative value ──
  const sparse = {}; // entity_id → Map<hourISO, float>
  historyArray.forEach(entityList => {
    if (!entityList || entityList.length === 0) return;
    const entId = entityList[0].entity_id;
    const m = new Map();
    entityList.forEach(s => {
      const val = parseFloat(s.state);
      if (isNaN(val)) return;
      const dt = new Date(s.last_changed);
      dt.setMinutes(0, 0, 0, 0);
      m.set(dt.getTime(), val); // keep last value per epoch-hour
    });
    if (m.size > 0) sparse[entId] = m;
  });

  const usedEntities = Object.values(roleMap).filter(Boolean);
  if (usedEntities.every(e => !sparse[e])) return [];

  // ── 2. Find global time range across all used entities ──
  let globalMin = Infinity, globalMax = -Infinity;
  usedEntities.forEach(ent => {
    if (!sparse[ent]) return;
    sparse[ent].forEach((_, t) => {
      if (t < globalMin) globalMin = t;
      if (t > globalMax) globalMax = t;
    });
  });

  // ── 3. Forward-fill each entity over the complete hour grid ──
  // This fills gaps (HA offline, irregular reporting) with the last known meter value.
  const HOUR_MS = 3600 * 1000;
  const filled = {}; // entity_id → Float64Array indexed by hour offset

  usedEntities.forEach(ent => {
    if (!sparse[ent]) return;
    const nHours = Math.round((globalMax - globalMin) / HOUR_MS) + 1;
    const arr = new Float64Array(nHours).fill(NaN);

    // Place known values
    sparse[ent].forEach((val, t) => {
      const idx = Math.round((t - globalMin) / HOUR_MS);
      if (idx >= 0 && idx < nHours) arr[idx] = val;
    });

    // Forward-fill NaN gaps
    let last = NaN;
    for (let i = 0; i < nHours; i++) {
      if (!isNaN(arr[i])) { last = arr[i]; }
      else if (!isNaN(last)) { arr[i] = last; }
    }
    // Backward-fill leading NaNs (beginning of period)
    let first = NaN;
    for (let i = nHours - 1; i >= 0; i--) {
      if (!isNaN(arr[i])) { first = arr[i]; }
      else if (!isNaN(first)) { arr[i] = first; }
    }

    filled[ent] = arr;
  });

  // ── 4. Generate hourly records from consecutive filled values ──
  const nHours = Math.round((globalMax - globalMin) / HOUR_MS) + 1;

  const hourDelta = (ent, i) => {
    if (!ent || !filled[ent]) return 0;
    const a = filled[ent][i - 1];
    const b = filled[ent][i];
    if (isNaN(a) || isNaN(b)) return 0;
    const d = b - a;
    // Sanity-check: ignore resets (meter replacement) or absurd spikes > 100 kWh/h
    return (d > 0 && d < 100) ? d : 0;
  };

  const records = [];
  for (let i = 1; i < nHours; i++) {
    const ts = new Date(globalMin + i * HOUR_MS).toISOString();
    records.push({
      timestamp: ts,
      import_t1: hourDelta(roleMap.imp1, i),
      import_t2: hourDelta(roleMap.imp2, i),
      export_t1: hourDelta(roleMap.exp1, i),
      export_t2: hourDelta(roleMap.exp2, i),
    });
  }

  return records;
}

// ── Live tarieven ophalen (Frank Energie + energyzero) ───────────────────────
async function fetchTarieven() {
  const btn = document.getElementById("fetch-tarieven-btn");
  const status = document.getElementById("tarieven-status");
  btn.disabled = true;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Ophalen…`;
  status.style.display = "block";
  status.style.color = "var(--text-muted)";
  status.textContent = "Frank Energie prijzen ophalen…";

  try {
    // ── 1. Frank Energie: vandaag's prijzen + tariefcomponenten ──────────────
    const today = new Date().toISOString().slice(0, 10);
    const frankResp = await fetch("https://frank-graphql-prod.graphcdn.app/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ marketPrices(date: "${today}") { electricityPrices { from marketPrice marketPriceTax sourcingMarkupPrice energyTaxPrice } } }` })
    });
    const frankData = await frankResp.json();
    const prices = frankData?.data?.marketPrices?.electricityPrices || [];

    if (prices.length > 0) {
      // Energiebelasting is constant across hours — take from first entry
      const eb = prices[0].energyTaxPrice;
      liveEnergyTax = eb;
      setSlider("energy-tax", eb);   // schuif = single source of truth voor runSimulation

      // Average inkoop opslag (constant at Frank, but average across hours)
      const avgOpslag = prices.reduce((s, p) => s + p.sourcingMarkupPrice, 0) / prices.length;

      // Update sliders
      setSlider("dynamic-markup", avgOpslag.toFixed(4));

      // Store today's Frank prices in epexHistory (prices incl BTW excl EB+opslag = market+tax)
      prices.forEach(p => {
        const dt = new Date(p.from);
        const marketInclBtw = p.marketPrice + p.marketPriceTax;
        epexHistory.set(epexKey(dt), marketInclBtw);
      });

      status.textContent = `✓ Frank: EB = €${eb.toFixed(5)}/kWh · opslag = €${avgOpslag.toFixed(4)}/kWh · ${prices.length} uurprijzen geladen`;
    }

    // ── 2. EnergyZero: historische EPEX voor geladen energieperiode ──────────
    if (energyData.length > 0) {
      status.textContent += " · historische EPEX ophalen…";
      const fromISO = energyData[0].timestamp;
      const tillISO = energyData[energyData.length - 1].timestamp;
      await fetchEPEXHistory(fromISO, tillISO);
      status.textContent += ` · ${epexHistory.size} uurprijzen totaal`;
    }

    status.style.color = "var(--accent-green)";
    runSimulation(); // herbereken met actuele tarieven

  } catch (err) {
    console.error("fetchTarieven:", err);
    status.textContent = "Ophalen mislukt: " + err.message;
    status.style.color = "var(--accent-orange)";
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Ophalen`;
  }
}

// ── EnergyZero: uurprijzen incl. BTW voor een periode ───────────────────────
async function fetchEPEXHistory(fromISO, tillISO) {
  const url = `https://api.energyzero.nl/v1/energyprices` +
    `?fromDate=${encodeURIComponent(fromISO)}` +
    `&tillDate=${encodeURIComponent(tillISO)}` +
    `&interval=4&usageType=1&inclBtw=true`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`energyzero HTTP ${resp.status}`);
  const data = await resp.json();

  (data.Prices || []).forEach(p => {
    const dt = new Date(p.readingDate);
    // FIX: EnergyZero levert de prijs incl. BTW, maar EXCLUSIEF Energiebelasting.
    // We mogen de belasting er dus niet vanaf trekken, anders verdwijnt hij uit de hele rekensom!
    const pureEpex = p.price;
    epexHistory.set(epexKey(dt), pureEpex);
  });
}

// Helper: update slider + badge atomically
function setSlider(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  const badge = document.getElementById(`${id}-val`);
  if (badge) {
    const suffix = el.dataset.suffix || "";
    const num = parseFloat(value);
    badge.textContent = `€ ${num.toFixed(num < 0.1 ? 3 : 2)}${suffix}`;
  }
}

// =============================================================================
// SMART SEASON FILLER — synthese van een volledig kalenderjaar (8760 uur)
// Vult ontbrekende maanden/uren aan met een slim seizoensprofiel zodat de
// jaarrekening klopt i.p.v. een naïeve pro-rata-extrapolatie. Cfg-onafhankelijk:
// alleen ruwe baseload + synthetische zon; hardware (WP/EV/accu) wordt door de
// loop bovenop elke rij toegepast — net als bij echte data, zonder dubbeltelling.
// =============================================================================

// Mediaan-helper (robuuster dan gemiddelde voor uitschieters).
function _median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Maandelijkse zon-schaalfactor (1.0 = piek juni, 0.08 = diepste winter).
const SOLAR_MONTH_FACTOR = {
  1: 0.10, 2: 0.20, 3: 0.40, 4: 0.65, 5: 0.85, 6: 1.00,
  7: 0.95, 8: 0.85, 9: 0.60, 10: 0.35, 11: 0.15, 12: 0.08,
};

// Daglicht-curve: 0 'snachts, piek (~1.0) rond 13:30, 0 buiten 06–21u.
function _daylightShape(hour) {
  if (hour < 6 || hour > 21) return 0;
  return Math.max(0, Math.sin(Math.PI * (hour - 6) / 15));
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Bepaalt hoe de loop een vol jaar krijgt. Drie modi (jaarbasis blijft altijd):
 *  - "full"     ≥365 dagen data → geen synthese; energie genormaliseerd naar 1 jaar.
 *  - "seasonal" <365 dagen + prognose AAN → 8760-uurs projectie met seizoensprofiel.
 *  - "linear"   <365 dagen + prognose UIT → gemeten periode lineair → jaar (geen seizoenscorrectie).
 * `yearScale` (8760 / #uren) normaliseert de loop-som naar exact één jaar; voor de
 * seizoensprojectie is dat 1.0 (de array is al 8760u). Gecachet op data + togglestand.
 */
function ensureFullYearData() {
  const prognose = document.getElementById("prognose-toggle")?.checked ?? true;

  if (energyData.length === 0) {
    fullYearData = null; yearScale = 1.0;
    dataMeta = { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 };
    return;
  }

  // Cache-stempel: togglestand + lengte + eerste/laatste timestamp. Sliders → geen herbouw.
  const stamp = `${prognose}|${energyData.length}|${energyData[0].timestamp}|${energyData[energyData.length - 1].timestamp}`;
  if (stamp === fullYearStamp) return;
  fullYearStamp = stamp;

  // Spanwijdte in dagen (lokale tijd) bepaalt of synthese nodig is.
  const firstMs = new Date(energyData[0].timestamp).getTime();
  const lastMs = new Date(energyData[energyData.length - 1].timestamp).getTime();
  const spanDays = (lastMs - firstMs) / DAY_MS;
  const realHoursTot = energyData.length;

  // Tel unieke kalenderdagen (lokaal) voor de prognose-badge.
  const daySet = new Set();
  energyData.forEach(r => daySet.add(rowMeta(r).dayKey));
  const realDays = daySet.size;

  if (spanDays >= 365) {
    // Genoeg data: geen synthese, energie genormaliseerd naar exact één jaar.
    fullYearData = null;
    yearScale = 8760 / realHoursTot;
    dataMeta = { mode: "full", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale };
    return;
  }

  if (!prognose) {
    // Prognose UIT: geen synthese, gemeten periode lineair doorrekenen naar een jaar.
    fullYearData = null;
    yearScale = 8760 / realHoursTot;
    dataMeta = { mode: "linear", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale };
    return;
  }

  // ── 1. Baseload: mediaan import tijdens nachturen 02:00–04:00 (standby) ──
  const nightImports = [];
  const allImports = [];
  let peakSolar = 0;
  let hasSolar = false;
  energyData.forEach(r => {
    const imp = (r.import_t1 || 0) + (r.import_t2 || 0);
    allImports.push(imp);
    const h = rowMeta(r).hour;
    if (h >= 2 && h <= 4) nightImports.push(imp);
    if (r.solar_yield != null) { hasSolar = true; if (r.solar_yield > peakSolar) peakSolar = r.solar_yield; }
  });
  const baseload = nightImports.length ? _median(nightImports)
    : (allImports.length ? _median(allImports) : 0.2);   // fallback ~0.2 kW standby

  // ── 2. Index echte uren op (maand,dag,uur) zodat we ze kunnen hergebruiken ──
  // Schrikkeldag (29 feb) heeft geen 8760-slot → vouw op 28 feb, anders ging die data verloren.
  const realByMDH = new Map();
  energyData.forEach(r => {
    const { month, date, hour } = rowMeta(r);
    const d = (month === 2 && date === 29) ? 28 : date;
    realByMDH.set(`${month}-${d}-${hour}`, r);
  });

  // ── 3. Genereer het volledige jaar (referentiejaar = jaar van laatste record) ──
  const year = new Date(energyData[energyData.length - 1].timestamp).getFullYear();
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // niet-schrikkel → 8760u
  const out = [];
  let realHours = 0, synthHours = 0;

  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= DAYS_IN_MONTH[month - 1]; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const real = realByMDH.get(`${month}-${day}-${hour}`);
        if (real) { out.push(real); realHours++; continue; }

        // Synthetische rij: ruwe baseload + seizoens-zon (hardware komt in de loop).
        const synthSolar = hasSolar
          ? peakSolar * (SOLAR_MONTH_FACTOR[month] || 0) * _daylightShape(hour)
          : 0;
        // Avondpiek (17–21u): koken/verlichting/activiteit → × standby-baseload.
        const activeBaseload = (hour >= 17 && hour <= 21) ? (baseload * EVENING_PEAK_MULT) : baseload;
        const net = activeBaseload - synthSolar;          // >0 = afname, <0 = teruglevering
        const mm = String(month).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        const hh = String(hour).padStart(2, "0");
        out.push({
          timestamp: `${year}-${mm}-${dd}T${hh}:00:00`,  // lokaal-naïef → getHours() klopt
          import_t1: Math.max(0, net),
          import_t2: 0,
          export_t1: Math.max(0, -net),
          export_t2: 0,
          solar_yield: synthSolar,
          _synth: true,
        });
        synthHours++;
      }
    }
  }

  fullYearData = out;
  yearScale = 1.0;   // de projectie is al exact 8760u — geen extra normalisatie
  dataMeta = { mode: "seasonal", synthesized: true, realDays, realHours, synthHours, yearScale: 1 };
}

// =============================================================================
// UNIFORME SIMULATIE-ENGINE
// Eén pure kernfunctie — geen DOM-reads inside de loop.
// Aangeroepen door zowel runSimulation() (full=true) als computeBillForConfig() (full=false).
// =============================================================================

/**
 * Voert de simulatie uit over `energyData` met de gegeven configuratie.
 *
 * @param {object}  cfg  - Alle contract- en hardware-parameters (DOM-vrij, zie runSimulation).
 * @param {boolean} full - true  → bouw ook grafiekprofielen (hourlyProfile, perDayTotals, enz.)
 *                         false → geef alleen { fixedBill, dynBill } terug (snel pad voor hw-deltas).
 * @returns {object} Simulatieresultaat.
 */
function _simulateCore(cfg, full = false) {
  const {
    fixedPeakRate, fixedDalRate, fixedFeedInRate, fixedVastrecht, fixedFeedInFee,
    dynamicMarkup, dynamicVastrecht, stressMultiplier = 1.0,
    solarDimmingMode,
    hasHeatPump, hpWinterBaseload,
    hasEv, evWeeklyDist, evConsumption, evSolarMatch, evProfile = "home",
    hasBattery, batCapacity, batPower, batEfficiency, batArbitrage, batGridExport = false,
  } = cfg;

  const markupBtw = dynamicMarkup * 1.21;
  const eb = liveEnergyTax;
  const dimmingActive = solarDimmingMode && solarDimmingMode !== "off";
  const simData = fullYearData || energyData;

  // ── PRE-COMPUTATION CAPTURE: Bereken EV Profielen ÉÉNMAAL (Vector 3 & 5 Fix) ──
  const dayRows = {};
  simData.forEach(r => { (dayRows[rowMeta(r).dayKey] ||= []).push(r); });

  const evScheduleCacheDyn = {};
  const evScheduleCacheFx = {};

  function precomputeEVSchedules() {
    if (!hasEv) return;
    const evDailyKwh = (evWeeklyDist * evConsumption) / 7.0;
    if (evDailyKwh <= 0) return;

    Object.keys(dayRows).forEach(dk => {
      const rowsOfDay = dayRows[dk];

      const unavailable = r => {
        if (evProfile !== "commuter") return false;
        const { dow, hour } = rowMeta(r);
        return dow > 0 && dow < 6 && hour >= 8 && hour <= 17;
      };

      // Helper om basis zonne-allocatie op te zetten
      const baseSched = () => {
        const s = Array.from({ length: 24 }, () => ({ grid: 0, solar: 0 }));
        let remNeed = evDailyKwh;
        if (evSolarMatch) {
          for (const r of rowsOfDay) {
            if (remNeed <= 0) break;
            if (unavailable(r)) continue;
            const h = rowMeta(r).hour;
            if (h < 10 || h > 16) continue;
            const rawExpH = (r.export_t1 || 0) + (r.export_t2 || 0);
            const charge = Math.min(rawExpH, EV_MAX_CHARGE_KW, remNeed);
            if (charge > 0) { s[h].solar += charge; remNeed -= charge; }
          }
        }
        return { s, remNeed };
      };

      // DYNAMISCHE EV ALLOCATIE (Spot-geoptimaliseerd)
      const dynTarget = baseSched();
      if (dynTarget.remNeed > 0) {
        const sortedDyn = rowsOfDay.filter(r => !unavailable(r)).map(r => {
          const { hour, month, epexKey: k } = rowMeta(r);
          let sp = epexHistory.has(k) ? epexHistory.get(k) : getFallbackSpot(month, hour);
          if (sp > 0 && stressMultiplier !== 1.0) sp *= stressMultiplier;
          return { h: hour, cost: sp + markupBtw + eb };
        }).sort((a, b) => a.cost - b.cost);

        for (const { h } of sortedDyn) {
          if (dynTarget.remNeed <= 0) break;
          const room = EV_MAX_CHARGE_KW - (dynTarget.s[h].solar + dynTarget.s[h].grid);
          const charge = Math.min(dynTarget.remNeed, room);
          if (charge > 0) { dynTarget.s[h].grid += charge; dynTarget.remNeed -= charge; }
        }
      }
      evScheduleCacheDyn[dk] = dynTarget.s;

      // VASTE EV ALLOCATIE (Daluren-geoptimaliseerd)
      const fxTarget = baseSched();
      if (fxTarget.remNeed > 0) {
        const sortedFx = rowsOfDay.filter(r => !unavailable(r)).map(r => {
          const { hour, dow } = rowMeta(r);
          const isPeakHour = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
          return { h: hour, cost: isPeakHour ? fixedPeakRate : fixedDalRate };
        }).sort((a, b) => a.cost - b.cost);

        for (const { h } of sortedFx) {
          if (fxTarget.remNeed <= 0) break;
          const room = EV_MAX_CHARGE_KW - (fxTarget.s[h].solar + fxTarget.s[h].grid);
          const charge = Math.min(fxTarget.remNeed, room);
          if (charge > 0) { fxTarget.s[h].grid += charge; fxTarget.remNeed -= charge; }
        }
      }
      evScheduleCacheFx[dk] = fxTarget.s;
    });
  }
  precomputeEVSchedules();

  // Accumulatoren
  let fxPeakImp = 0, fxDalImp = 0, fxPeakExp = 0, fxDalExp = 0;
  let dynImpCost = 0, dynExpRev = 0, dynImpKwh = 0, dynExpKwh = 0;
  let batSoC = 0, batSoCFx = 0;
  let epexReal = 0, epexFall = 0;

  // Profiel-arrays (wanneer full=true)
  const hourly = full ? Array.from({ length: 24 }, () => ({ imports: [], exports: [], spots: [], dynCosts: [], fixedCosts: [] })) : null;
  const weekly = full ? Array.from({ length: 7 }, () => ({ dynCosts: [], fixedCosts: [] })) : null;
  const dayTot = full ? {} : null;
  const dayHour = full ? {} : null;

  // ── HOOFDLOOP (8760 UUR REEKS) ──
  simData.forEach(row => {
    const { hour, month, dow, dayKey, epexKey: tsKey } = rowMeta(row);
    const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;

    const rawImp = row.import_t1 + row.import_t2;
    const rawExp = row.export_t1 + row.export_t2;

    let spot = epexHistory.has(tsKey) ? epexHistory.get(tsKey) : getFallbackSpot(month, hour);
    if (epexHistory.has(tsKey)) epexReal++; else epexFall++;
    if (spot > 0 && stressMultiplier !== 1.0) spot *= stressMultiplier;

    if (full) {
      hourly[hour].imports.push(rawImp);
      hourly[hour].exports.push(rawExp);
      hourly[hour].spots.push(spot);
    }

    // Thermische stooklast (Warmtepomp)
    let hpLoad = 0;
    if (hasHeatPump) {
      const sf = month >= 5 && month <= 9 ? 0.15 : (month >= 11 || month <= 2 ? 1.3 : 0.7);
      const tf = (hour >= 22 || hour < 7) ? 1.2 : 0.9;
      hpLoad = hpWinterBaseload * sf * tf;
    }

    // ── STRATEGIE SPLIT: DYNAMISCH VS VAST APPARAATGEDRAG ──
    let impDyn = rawImp + hpLoad;
    let expDyn = rawExp;
    let impFx = rawImp + hpLoad;
    let expFx = rawExp;

    // EV verbruik injecteren vanuit gescheiden dagschemas
    if (hasEv) {
      const evD = evScheduleCacheDyn[dayKey]?.[hour];
      if (evD) { impDyn += evD.grid; expDyn = Math.max(0, expDyn - evD.solar); }

      const evF = evScheduleCacheFx[dayKey]?.[hour];
      if (evF) { impFx += evF.grid; expFx = Math.max(0, expFx - evF.solar); }
    }

    // Thuisaccu processing (Volledig lineair, Vector 2 Fix)
    if (hasBattery) {
      // Dynamisch circuit
      if (expDyn > 0 && batSoC < batCapacity) {
        const c = Math.min(expDyn, batPower, batCapacity - batSoC);
        batSoC += c * batEfficiency; expDyn = Math.max(0, expDyn - c);
      }
      if (batArbitrage && spot <= BATTERY_ARBITRAGE_SPOTMAX && batSoC < batCapacity && expDyn === 0) {
        const c = Math.min(batPower, batCapacity - batSoC);
        batSoC += c * batEfficiency; impDyn += c;
      }
      if ((spot + markupBtw + eb) > BATTERY_DISCHARGE_ALLIN && batSoC > 0 && expDyn === 0) {
        let d = Math.min(batPower, batSoC);
        const toHouse = Math.min(impDyn, d);
        impDyn -= toHouse; batSoC -= toHouse; d -= toHouse;
        if (batGridExport && d > 0 && spot > 0) { expDyn += d; batSoC -= d; }
      }

      // Vast circuit
      if (expFx > 0 && batSoCFx < batCapacity) {
        const c = Math.min(expFx, batPower, batCapacity - batSoCFx);
        batSoCFx += c * batEfficiency; expFx = Math.max(0, expFx - c);
      }
      if (impFx > 0 && batSoCFx > 0 && expFx === 0) {
        const d = Math.min(impFx, batPower, batSoCFx);
        batSoCFx -= d; impFx = Math.max(0, impFx - d);
      }
    }

    // Accumuleer Vast Contract Volumes
    if (isPeak) { fxPeakImp += impFx; fxPeakExp += expFx; }
    else { fxDalImp += impFx; fxDalExp += expFx; }

    // ── Slimme Omvormer Interventie bij Negatieve Spot (Vector 1 Fix) ──
    let dynImp = impDyn;
    let dynExp = expDyn;

    if (dimmingActive && spot < 0) {
      const solar = row.solar_yield ?? null;
      if (solar !== null) {
        const localSolarConsumed = Math.max(0, solar - expDyn);
        const currentHouseLoad = impDyn + localSolarConsumed;
        const brutoOverschot = solar - currentHouseLoad;

        if (solarDimmingMode === "dim") {
          dynImp = brutoOverschot < 0 ? Math.abs(brutoOverschot) : 0;
          dynExp = 0;
        } else if (solarDimmingMode === "uit") {
          dynImp = currentHouseLoad;
          dynExp = 0;
        }
      } else {
        dynExp = 0;
        if (solarDimmingMode === "uit") dynImp = impDyn;
      }
    }

    // Accumuleer Dynamische Resultaten
    const basePrice = spot + markupBtw;
    dynImpCost += dynImp * basePrice;
    dynExpRev += dynExp * spot;
    dynImpKwh += dynImp;
    dynExpKwh += dynExp;

    if (full) {
      const allIn = basePrice + eb;
      const dynHrCost = dynImp * allIn - dynExp * spot;
      const tariff = isPeak ? fixedPeakRate : fixedDalRate;
      const fxHrCost = impFx * tariff - expFx * fixedFeedInRate + expFx * fixedFeedInFee;

      hourly[hour].dynCosts.push(dynHrCost);
      hourly[hour].fixedCosts.push(fxHrCost);
      weekly[dow].dynCosts.push(dynHrCost);
      weekly[dow].fixedCosts.push(fxHrCost);

      if (!dayTot[dayKey]) dayTot[dayKey] = { dynCost: 0, fixedCost: 0, impKwh: 0, expKwh: 0, spotSum: 0, spotN: 0 };
      const pd = dayTot[dayKey];
      pd.dynCost += dynHrCost; pd.fixedCost += fxHrCost;
      pd.impKwh += dynImp; pd.expKwh += dynExp;
      if (dynImp > 0) { pd.spotSum += spot * dynImp; pd.spotN += dynImp; }

      if (!dayHour[dayKey]) dayHour[dayKey] = Array.from({ length: 24 }, () => null);
      dayHour[dayKey][hour] = { dynCost: dynHrCost, fixedCost: fxHrCost, spot, impKwh: dynImp, expKwh: dynExp };
    }
  });

  // Jaarnormalisatie-schaling
  fxPeakImp *= yearScale; fxDalImp *= yearScale; fxPeakExp *= yearScale; fxDalExp *= yearScale;
  dynImpCost *= yearScale; dynExpRev *= yearScale; dynImpKwh *= yearScale; dynExpKwh *= yearScale;

  // ── EINDTOTALEN REKENING (Fiscaal Zuiver Model 2027, Vector 4 Fix) ──
  const standardEB2026 = 0.11084;
  const fixedPeakBase = Math.max(0, fixedPeakRate - standardEB2026);
  const fixedDalBase = Math.max(0, fixedDalRate - standardEB2026);

  const fxImpCost = fxPeakImp * (fixedPeakBase + eb) + fxDalImp * (fixedDalBase + eb);
  const fxFeedCredit = (fxPeakExp + fxDalExp) * fixedFeedInRate;
  const fxFeedPenalt = (fxPeakExp + fxDalExp) * fixedFeedInFee;
  const fxSub = fixedVastrecht * 12.0;
  const fixedBill = fxImpCost - fxFeedCredit + fxFeedPenalt + fxSub;

  const dynEB = dynImpKwh * eb; // Gross energy tax charging rule
  const dynSub = dynamicVastrecht * 12.0;
  const dynBill = (dynImpCost - dynExpRev) + dynEB + dynSub;

  const out = { fixedBill, dynBill };

  if (full) {
    Object.assign(out, {
      totalImportKwh: dynImpKwh, totalExportKwh: dynExpKwh,
      netDynamicKwh: Math.max(0, dynImpKwh - dynExpKwh),
      dynamicRawImportCost: dynImpCost, dynamicRawExportRevenue: dynExpRev,
      dynamicNetTax: dynEB, dynamicSubscription: dynSub, dynamicTotalBill: dynBill,
      fixedPeakImport: fxPeakImp, fixedPeakExport: fxPeakExp,
      fixedDalImport: fxDalImp, fixedDalExport: fxDalExp,
      fixedImportCost: fxImpCost, fixedFeedInCredit: fxFeedCredit,
      fixedFeedInFee: fxFeedPenalt, fixedSubscription: fxSub, fixedTotalBill: fixedBill,
      totalSavings: fixedBill - dynBill,
      savingsPct: fixedBill !== 0 ? ((fixedBill - dynBill) / fixedBill) * 100 : 0,
      hourlyProfile: hourly, weekdayProfile: weekly, perDayTotals: dayTot, perDayHourly: dayHour,
      epexPct: (epexReal + epexFall) > 0 ? Math.round(epexReal / (epexReal + epexFall) * 100) : 0,
    });
  }
  return out;
}

/** Hardware-delta berekening: dun wrapper — geen profielen nodig. */
function computeBillForConfig(cfg) {
  return _simulateCore(cfg, false);
}

/** Leest alle contract-/hardware-instellingen eenmalig uit de DOM tot één cfg-object. */
function readSimConfig() {
  return {
    fixedPeakRate: parseFloat(document.getElementById("fixed-peak").value),
    fixedDalRate: parseFloat(document.getElementById("fixed-dal").value),
    fixedFeedInRate: parseFloat(document.getElementById("fixed-feedin-rate").value),
    fixedVastrecht: parseFloat(document.getElementById("fixed-vastrecht").value),
    fixedFeedInFee: parseFloat(document.getElementById("fixed-feedin-fee")?.value) || 0,
    dynamicMarkup: parseFloat(document.getElementById("dynamic-markup").value),
    dynamicVastrecht: parseFloat(document.getElementById("dynamic-vastrecht").value),
    stressMultiplier: parseFloat(document.getElementById("stress-multiplier")?.value) || 1.0,
    solarDimmingMode: document.getElementById("solar-dimming-mode")?.value || "off",
    hasHeatPump: document.getElementById("has-heatpump").checked,
    hpWinterBaseload: parseFloat(document.getElementById("hp-baseload").value),
    hasEv: document.getElementById("has-ev").checked,
    evWeeklyDist: parseFloat(document.getElementById("ev-dist").value),
    evConsumption: parseFloat(document.getElementById("ev-cons").value) / 100.0,
    evSolarMatch: document.getElementById("ev-solar-match").checked,
    evProfile: document.getElementById("ev-profile")?.value || "home",
    hasBattery: document.getElementById("has-battery").checked,
    batCapacity: parseFloat(document.getElementById("bat-cap").value),
    batPower: parseFloat(document.getElementById("bat-power").value),
    batEfficiency: parseFloat(document.getElementById("bat-eff").value) / 100.0,
    batArbitrage: document.getElementById("bat-arbitrage").checked,
    batGridExport: document.getElementById("bat-grid-export")?.checked || false,
  };
}

// =============================================================================
// SWEET SPOT FINDER — automatische accu-grootte optimalisatie (ROI)
// Veegt een reeks capaciteiten door, berekent de jaarbesparing en terugverdientijd,
// en markeert de "sweet spot". Raakt activeSimulation NIET aan (pure achtergrond-runs).
// =============================================================================
const BATTERY_SWEEP_CAPS = [2, 5, 10, 15, 20];   // kWh
const BATTERY_COST_PER_KWH = 450;                // €/kWh investering (industriestandaard)

function optimizeBatterySize() {
  const resEl = document.getElementById("battery-optimization-result");
  if (!resEl) return;
  if (energyData.length === 0) {
    resEl.style.display = "";
    resEl.innerHTML = "Laad eerst data om de optimale accu te berekenen.";
    return;
  }

  // EB + jaarprojectie synchroon met de hoofdsimulatie (read-only voor activeSimulation).
  const ebEl = document.getElementById("energy-tax");
  if (ebEl) liveEnergyTax = parseFloat(ebEl.value);
  ensureFullYearData();

  const baseCfg = readSimConfig();

  // Referentie ZONDER accu: zelfde scenario, batterij uit. Levert het vaste-contract-
  // bedrag (baseline) én het dynamische bedrag zonder accu (voor de meerwaarde-berekening).
  const noBat = computeBillForConfig({ ...baseCfg, hasBattery: false });
  const baselineFix = noBat.fixedBill;     // vast contract = referentie voor "besparing"
  const baselineDyn = noBat.dynBill;       // dynamisch zónder accu

  const rows = BATTERY_SWEEP_CAPS.map(cap => {
    const r = computeBillForConfig({
      ...baseCfg,
      hasBattery: true,
      batCapacity: cap,
      batPower: cap * 0.5,              // gulden-ratio: 0,5C laad/ontlaadvermogen
      batEfficiency: baseCfg.batEfficiency, // UI-instelling
      batArbitrage: baseCfg.batArbitrage,  // UI-instelling
    });
    const savingsVsFixed = baselineFix - r.dynBill;   // dynamisch+accu t.o.v. vast contract
    const extra = baselineDyn - r.dynBill;   // meerwaarde van de accu zelf (€/jaar)
    const cost = cap * BATTERY_COST_PER_KWH;
    const payback = extra > 0 ? cost / extra : Infinity;
    return { cap, power: cap * 0.5, dynBill: r.dynBill, savingsVsFixed, extra, cost, payback };
  });

  // Sweet spot = kortste (eindige) terugverdientijd; anders hoogste jaarbesparing.
  let sweetIdx = -1, bestPayback = Infinity;
  rows.forEach((r, i) => { if (r.payback < bestPayback) { bestPayback = r.payback; sweetIdx = i; } });
  if (sweetIdx === -1) rows.forEach((r, i) => { if (sweetIdx === -1 || r.savingsVsFixed > rows[sweetIdx].savingsVsFixed) sweetIdx = i; });

  renderBatteryOptimization(rows, sweetIdx, resEl);
}

function renderBatteryOptimization(rows, sweetIdx, resEl) {
  const eur = v => (v >= 0 ? "" : "−") + "€" + Math.abs(v).toFixed(0);
  const yrs = p => Number.isFinite(p) ? `${p.toFixed(1)} jr` : "—";

  const body = rows.map((r, i) => {
    const sweet = i === sweetIdx;
    const bg = sweet ? "background:rgba(56,239,125,0.14);" : "";
    const star = sweet ? " ⭐" : "";
    return `<tr style="${bg}">
      <td style="padding:0.25rem 0.4rem;">${r.cap} kWh${star}</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${r.power.toFixed(1)} kW</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;color:var(--accent-green);">${eur(r.extra)}/jr</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${yrs(r.payback)}</td>
    </tr>`;
  }).join("");

  const sweet = rows[sweetIdx];
  const verdict = sweet && Number.isFinite(sweet.payback)
    ? `<strong style="color:var(--accent-green);">Sweet spot: ${sweet.cap} kWh</strong> — accu-meerwaarde ${eur(sweet.extra)}/jaar, terugverdiend in ${yrs(sweet.payback)} (bij €${BATTERY_COST_PER_KWH}/kWh).`
    : `Binnen dit scenario verdient geen enkele accu zichzelf terug (meerwaarde ≤ €0/jaar). Een dynamisch contract levert hier vooral op zonder accu.`;

  resEl.style.display = "";
  resEl.innerHTML = `
    <div style="margin-bottom:0.5rem;">${verdict}</div>
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead><tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.12);">
        <th style="padding:0.25rem 0.4rem;text-align:left;">Accu</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Vermogen</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Meerwaarde</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Terugverdientijd</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.45rem;">
      Meerwaarde = besparing op het dynamische jaarbedrag t.o.v. dezelfde opstelling zónder accu.
      Vermogen = 0,5× capaciteit. Investering €${BATTERY_COST_PER_KWH}/kWh (indicatief).
    </p>`;
}

// =============================================================================
// HOOFD-SIMULATIE: leest DOM eenmalig, bouwt cfg, roept _simulateCore aan.
// =============================================================================
function runSimulation() {
  if (energyData.length === 0) return;

  // ── Energiebelasting uit de schuif lezen (live-fetch werkt deze schuif bij) ──
  const ebEl = document.getElementById("energy-tax");
  if (ebEl) liveEnergyTax = parseFloat(ebEl.value);

  // ── Jaarprojectie (8760u) opbouwen/cachen vóór de simulatie ──────────────
  ensureFullYearData();

  // ── Alle DOM-reads EENMALIG voor de loop ─────────────────────────────────
  const cfg = readSimConfig();

  // ── Hoofdsimulatie + hardware-deltas (5 x _simulateCore) ─────────────────
  const sim = _simulateCore(cfg, true);

  const base0 = {
    ...cfg,
    hasHeatPump: false, hpWinterBaseload: 0,
    hasEv: false, evWeeklyDist: 0, evConsumption: 0, evSolarMatch: false,
    hasBattery: false, batCapacity: 0, batPower: 0, batEfficiency: 1, batArbitrage: false,
  };
  const base = _simulateCore(base0, false);
  const withHp = _simulateCore({ ...base0, hasHeatPump: true, hpWinterBaseload: cfg.hpWinterBaseload }, false);
  const withEv = _simulateCore({ ...base0, hasEv: true, evWeeklyDist: cfg.evWeeklyDist, evConsumption: cfg.evConsumption, evSolarMatch: cfg.evSolarMatch }, false);
  const withBat = _simulateCore({ ...base0, hasBattery: true, batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency, batArbitrage: cfg.batArbitrage }, false);

  // ── activeSimulation bijwerken ────────────────────────────────────────────
  activeSimulation = {
    ...sim,
    hwEffects: {
      base,
      hp: { fixed: withHp.fixedBill - base.fixedBill, dyn: withHp.dynBill - base.dynBill, enabled: cfg.hasHeatPump, cfg: { hpWinterBaseload: cfg.hpWinterBaseload } },
      ev: { fixed: withEv.fixedBill - base.fixedBill, dyn: withEv.dynBill - base.dynBill, enabled: cfg.hasEv, cfg: { evDist: cfg.evWeeklyDist, evCons: cfg.evConsumption, evSolar: cfg.evSolarMatch } },
      bat: { fixed: withBat.fixedBill - base.fixedBill, dyn: withBat.dynBill - base.dynBill, enabled: cfg.hasBattery, cfg: { batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency * 100, batArbitrage: cfg.batArbitrage } },
    },
  };

  // ── EPEX-noot in tabel zetten ─────────────────────────────────────────────
  const pct = sim.epexPct;
  const taxEl = document.getElementById("tbl-dyn-tax-vol");
  if (taxEl) {
    taxEl.title = pct === 100 ? "✓ 100% echte EPEX uurprijzen"
      : pct > 0 ? `${pct}% echte EPEX, ${100 - pct}% seizoensprofiel`
        : "⚠ Geen echte EPEX — klik 'Ophalen' voor actuele tarieven";
  }

  updateUIElements();
  renderChart();
  renderOverviewChart();
  renderMonthlyChart();
  renderSimChart();
  renderHwChart();
}



// Update the DOM Elements with calculated values
function updateUIElements() {
  const sim = activeSimulation;

  // ── Prognose-badge: toelichting op de jaarbasis afhankelijk van de modus ──
  const badge = document.getElementById("prognosis-badge");
  const extrapolated = dataMeta.mode === "seasonal" || dataMeta.mode === "linear";
  if (badge) {
    if (dataMeta.mode === "seasonal") {
      badge.style.display = "";
      document.getElementById("prognosis-text").innerHTML =
        `${dataMeta.realDays} dagen eigen data aangevuld tot een volledig jaarverbruik via slimme seizoensprofielen.`;
    } else if (dataMeta.mode === "linear") {
      badge.style.display = "";
      document.getElementById("prognosis-text").innerHTML =
        `${dataMeta.realDays} dagen eigen data <strong>lineair</strong> doorgerekend naar een jaar (×${dataMeta.yearScale.toFixed(1)}, géén seizoenscorrectie). Zet <em>Jaarprognose</em> aan voor een seizoensgewogen schatting.`;
    } else {
      badge.style.display = "none";
    }
  }
  const synthTag = extrapolated
    ? ` <span style="color:var(--accent-cyan);font-size:0.7rem;" title="Geëxtrapoleerd naar jaarbasis">· prognose</span>`
    : "";

  // Header and stats
  document.getElementById("stat-savings-val").textContent = `${sim.totalSavings.toFixed(2)}`;
  document.getElementById("stat-savings-pct").textContent = `${sim.savingsPct.toFixed(1)}%`;
  document.getElementById("stat-fixed-val").textContent = `${sim.fixedTotalBill.toFixed(2)}`;
  document.getElementById("stat-dynamic-val").textContent = `${sim.dynamicTotalBill.toFixed(2)}`;

  // Fixed breakdown table — show gross costs AND saldering credits separately
  const fixedPeakRate = parseFloat(document.getElementById("fixed-peak").value);
  const fixedDalRate = parseFloat(document.getElementById("fixed-dal").value);
  const peakImpCost = sim.fixedPeakImport * fixedPeakRate;
  const dalImpCost = sim.fixedDalImport * fixedDalRate;

  const totalFixedExp = sim.fixedPeakExport + sim.fixedDalExport;
  const feedRate = parseFloat(document.getElementById("fixed-feedin-rate").value);

  document.getElementById("tbl-fixed-peak-imp").innerHTML = `${sim.fixedPeakImport.toFixed(1)} kWh × €${fixedPeakRate.toFixed(2)}${synthTag}`;
  document.getElementById("tbl-fixed-peak-cost").textContent = `€ ${peakImpCost.toFixed(2)}`;
  document.getElementById("tbl-fixed-dal-imp").textContent = `${sim.fixedDalImport.toFixed(1)} kWh × €${fixedDalRate.toFixed(2)}`;
  document.getElementById("tbl-fixed-dal-cost").textContent = `€ ${dalImpCost.toFixed(2)}`;
  document.getElementById("tbl-fixed-exp").textContent = `${totalFixedExp.toFixed(1)} kWh × €${feedRate.toFixed(3)}`;
  document.getElementById("tbl-fixed-feedin-credit").textContent = `− € ${sim.fixedFeedInCredit.toFixed(2)}`;
  document.getElementById("tbl-fixed-net-energy").textContent = `€ ${(sim.fixedImportCost - sim.fixedFeedInCredit).toFixed(2)}`;
  document.getElementById("tbl-fixed-subcost").textContent = `€ ${sim.fixedSubscription.toFixed(2)}`;
  document.getElementById("tbl-fixed-total").textContent = `€ ${sim.fixedTotalBill.toFixed(2)}`;

  // Dynamic breakdown table
  const dynNetCost = sim.dynamicRawImportCost - sim.dynamicRawExportRevenue;
  document.getElementById("tbl-dyn-imp-kwh").innerHTML = `${sim.totalImportKwh.toFixed(1)} kWh${synthTag}`;
  document.getElementById("tbl-dyn-raw-imp").textContent = `€ ${sim.dynamicRawImportCost.toFixed(2)}`;
  document.getElementById("tbl-dyn-exp-kwh").textContent = `${sim.totalExportKwh.toFixed(1)} kWh`;
  // Export revenue: negative = you pay during negative EPEX hours (solar glut)
  const expRev = sim.dynamicRawExportRevenue;
  const expEl = document.getElementById("tbl-dyn-raw-exp");
  expEl.textContent = expRev >= 0 ? `− € ${expRev.toFixed(2)}` : `+ € ${Math.abs(expRev).toFixed(2)} ⚠`;
  expEl.style.color = expRev >= 0 ? "var(--accent-green)" : "var(--accent-orange)";
  expEl.title = expRev < 0 ? "Negatief: export tijdens uren met negatieve EPEX-prijs kost geld" : "";
  document.getElementById("tbl-dyn-net-kwh").textContent = `${sim.netDynamicKwh.toFixed(1)} kWh`;
  document.getElementById("tbl-dyn-net-cost").textContent = `€ ${dynNetCost.toFixed(2)}`;
  // EB 2027: over BRUTO afname van het net (geen saldering) — volume = totale import,
  // zodat volume × tarief exact gelijk is aan het getoonde bedrag.
  document.getElementById("tbl-dyn-tax-vol").textContent = `${sim.totalImportKwh.toFixed(1)} kWh × €${liveEnergyTax.toFixed(5)}`;
  document.getElementById("tbl-dyn-tax").textContent = `€ ${sim.dynamicNetTax.toFixed(2)}`;
  document.getElementById("tbl-dyn-subcost").textContent = `€ ${sim.dynamicSubscription.toFixed(2)}`;
  document.getElementById("tbl-dyn-total").textContent = `€ ${sim.dynamicTotalBill.toFixed(2)}`;
}

// Custom responsive SVG Chart Renderer
function renderChart() {
  const container = document.getElementById("chart-svg-container");
  const svg = document.getElementById("chart-svg");
  const tooltip = document.getElementById("chart-tooltip");

  const width = container.clientWidth;
  const height = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Clear previous drawing contents
  svg.innerHTML = "";

  const profile = activeSimulation.hourlyProfile;

  // Layout boundaries
  const paddingLeft = 40;
  const paddingRight = 45;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Helper: median of an array
  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Pre-compute per-hour medians for import, export and spot price
  const hourMedians = profile.map(h => ({
    imp: median(h.imports),
    exp: median(h.exports),
    spot: median(h.spots)
  }));

  // Max values to scale chart axis
  let maxEnergy = 0.1; // lower floor so small values are visible
  hourMedians.forEach(h => {
    if (h.imp > maxEnergy) maxEnergy = h.imp;
    if (h.exp > maxEnergy) maxEnergy = h.exp;
  });
  maxEnergy *= 1.15; // Give headroom

  // Show all-in consumer price in chart: pure EPEX + EB + markup + 21% BTW on (EPEX+markup)
  const minPrice = 0;
  const maxPrice = 0.40;

  // Axis projection formulas
  const getX = (hour) => paddingLeft + (hour / 23.0) * chartWidth;
  const getYEnergy = (val) => paddingTop + chartHeight - (val / maxEnergy) * chartHeight;
  const getYPrice = (val) => paddingTop + chartHeight - ((val - minPrice) / (maxPrice - minPrice)) * chartHeight;

  // 1. Draw Grid lines and Y labels (Energy on Left, Price on Right)
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const ratio = i / gridLines;
    const y = paddingTop + chartHeight - ratio * chartHeight;

    // Horizontal gridline
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", paddingLeft);
    line.setAttribute("y1", y);
    line.setAttribute("x2", width - paddingRight);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(255,255,255,0.04)");
    svg.appendChild(line);

    // Left Y label (Energy)
    const labelEnergy = document.createElementNS("http://www.w3.org/2000/svg", "text");
    labelEnergy.setAttribute("x", paddingLeft - 8);
    labelEnergy.setAttribute("y", y + 4);
    labelEnergy.setAttribute("text-anchor", "end");
    labelEnergy.setAttribute("fill", "var(--text-muted)");
    labelEnergy.setAttribute("font-size", "9");
    labelEnergy.textContent = `${(ratio * maxEnergy).toFixed(1)} kW`;
    svg.appendChild(labelEnergy);

    // Right Y label (Price)
    const labelPrice = document.createElementNS("http://www.w3.org/2000/svg", "text");
    labelPrice.setAttribute("x", width - paddingRight + 8);
    labelPrice.setAttribute("y", y + 4);
    labelPrice.setAttribute("text-anchor", "start");
    labelPrice.setAttribute("fill", "var(--accent-yellow)");
    labelPrice.setAttribute("font-size", "9");
    const priceVal = minPrice + ratio * (maxPrice - minPrice);
    labelPrice.textContent = `€ ${priceVal.toFixed(2)}/kWh`;
    svg.appendChild(labelPrice);
  }

  // 2. Draw Hour labels on X-axis
  for (let h = 0; h < 24; h += 4) {
    const x = getX(h);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    text.setAttribute("y", height - 10);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "var(--text-muted)");
    text.setAttribute("font-size", "10");
    text.textContent = `${h.toString().padStart(2, '0')}:00`;
    svg.appendChild(text);
  }

  // 3. Build SVG Paths
  let importPathPoints = [];
  let exportPathPoints = [];
  let pricePathPoints = [];

  for (let h = 0; h < 24; h++) {
    const hm = hourMedians[h];
    importPathPoints.push(`${getX(h)},${getYEnergy(hm.imp)}`);
    exportPathPoints.push(`${getX(h)},${getYEnergy(hm.exp)}`);
    pricePathPoints.push(`${getX(h)},${getYPrice(toConsumerPrice(hm.spot))}`);
  }

  // Draw Area for Import
  const importArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
  importArea.setAttribute("d", `M ${getX(0)},${getYEnergy(0)} L ${importPathPoints.join(" L ")} L ${getX(23)},${getYEnergy(0)} Z`);
  importArea.setAttribute("fill", "url(#import-grad)");
  svg.appendChild(importArea);

  // Draw Area for Export
  const exportArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
  exportArea.setAttribute("d", `M ${getX(0)},${getYEnergy(0)} L ${exportPathPoints.join(" L ")} L ${getX(23)},${getYEnergy(0)} Z`);
  exportArea.setAttribute("fill", "url(#export-grad)");
  svg.appendChild(exportArea);

  // Draw Line for Import
  const importLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  importLine.setAttribute("d", `M ${importPathPoints.join(" L ")}`);
  importLine.setAttribute("fill", "none");
  importLine.setAttribute("stroke", "var(--accent-cyan)");
  importLine.setAttribute("stroke-width", "2");
  svg.appendChild(importLine);

  // Draw Line for Export
  const exportLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  exportLine.setAttribute("d", `M ${exportPathPoints.join(" L ")}`);
  exportLine.setAttribute("fill", "none");
  exportLine.setAttribute("stroke", "var(--accent-green)");
  exportLine.setAttribute("stroke-width", "2");
  svg.appendChild(exportLine);

  // Draw Line for Price (Yellow)
  const priceLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  priceLine.setAttribute("d", `M ${pricePathPoints.join(" L ")}`);
  priceLine.setAttribute("fill", "none");
  priceLine.setAttribute("stroke", "var(--accent-yellow)");
  priceLine.setAttribute("stroke-width", "2");
  priceLine.setAttribute("stroke-dasharray", "4,4");
  svg.appendChild(priceLine);

  // 4. Inject SVG Gradients definitions into SVG
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  const impGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  impGrad.setAttribute("id", "import-grad");
  impGrad.setAttribute("x1", "0"); impGrad.setAttribute("y1", "0"); impGrad.setAttribute("x2", "0"); impGrad.setAttribute("y2", "1");
  impGrad.innerHTML = `<stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0.0"/>`;
  defs.appendChild(impGrad);

  const expGrad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  expGrad.setAttribute("id", "export-grad");
  expGrad.setAttribute("x1", "0"); expGrad.setAttribute("y1", "0"); expGrad.setAttribute("x2", "0"); expGrad.setAttribute("y2", "1");
  expGrad.innerHTML = `<stop offset="0%" stop-color="var(--accent-green)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--accent-green)" stop-opacity="0.0"/>`;
  defs.appendChild(expGrad);

  svg.appendChild(defs);

  // 5. Track Mouse Interactivity for Tooltip and Hover-dots
  const hoverLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  hoverLine.setAttribute("y1", paddingTop);
  hoverLine.setAttribute("y2", paddingTop + chartHeight);
  hoverLine.setAttribute("stroke", "rgba(255,255,255,0.2)");
  hoverLine.setAttribute("stroke-width", "1");
  hoverLine.style.display = "none";
  svg.appendChild(hoverLine);

  const dotImp = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dotImp.setAttribute("r", "5");
  dotImp.setAttribute("fill", "var(--accent-cyan)");
  dotImp.style.display = "none";
  svg.appendChild(dotImp);

  const dotExp = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dotExp.setAttribute("r", "5");
  dotExp.setAttribute("fill", "var(--accent-green)");
  dotExp.style.display = "none";
  svg.appendChild(dotExp);

  // Transparent overlay for hover detection
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  overlay.setAttribute("x", paddingLeft);
  overlay.setAttribute("y", paddingTop);
  overlay.setAttribute("width", chartWidth);
  overlay.setAttribute("height", chartHeight);
  overlay.setAttribute("fill", "transparent");
  overlay.style.cursor = "crosshair";
  svg.appendChild(overlay);

  overlay.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Convert mouseX to hour index
    const relativeX = (mouseX - paddingLeft) / chartWidth;
    let hour = Math.round(relativeX * 23.0);
    if (hour < 0) hour = 0;
    if (hour > 23) hour = 23;

    const x = getX(hour);
    const hr = profile[hour];
    const impVal = hourMedians[hour].imp;
    const expVal = hourMedians[hour].exp;

    // Show hover lines and dots
    hoverLine.setAttribute("x1", x);
    hoverLine.setAttribute("x2", x);
    hoverLine.style.display = "block";

    dotImp.setAttribute("cx", x);
    dotImp.setAttribute("cy", getYEnergy(impVal));
    dotImp.style.display = "block";

    dotExp.setAttribute("cx", x);
    dotExp.setAttribute("cy", getYEnergy(expVal));
    dotExp.style.display = "block";

    // Update Tooltip details
    tooltip.style.display = "block";
    // Center tooltip on hover point
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${getYEnergy(impVal) - 40}px`;

    document.getElementById("tt-hour").textContent = `${hour.toString().padStart(2, '0')}:00 - ${(hour + 1).toString().padStart(2, '0')}:00 uur`;
    document.getElementById("tt-import").textContent = `${impVal.toFixed(2)} kW`;
    document.getElementById("tt-export").textContent = `${expVal.toFixed(2)} kW`;
    const pureSpot = hourMedians[hour].spot;
    const consPrice = toConsumerPrice(pureSpot);
    document.getElementById("tt-spot").textContent = `€ ${consPrice.toFixed(3)} / kWh`;
    const rawEpex = (pureSpot / 1.21).toFixed(3);
    const markup = (parseFloat(document.getElementById("dynamic-markup")?.value) || 0.02).toFixed(3);
    document.getElementById("tt-spot-breakdown").textContent =
      `EPEX markt €${rawEpex} × 1.21 + opslag €${markup} × 1.21 + EB €${liveEnergyTax.toFixed(3)} = all-in €${consPrice.toFixed(3)}`;
  });

  overlay.addEventListener("mouseleave", () => {
    hoverLine.style.display = "none";
    dotImp.style.display = "none";
    dotExp.style.display = "none";
    tooltip.style.display = "none";
  });
}

// Window resizing
window.addEventListener("resize", () => { renderChart(); renderOverviewChart(); renderMonthlyChart(); renderSimChart(); renderHwChart(); });

// ── Sim chart mode/drill-down controls ───────────────────────────────────────
function setSimMode(mode) {
  simMode = mode;
  simDrillDay = null;
  document.getElementById("sim-btn-day").className = mode === "day" ? "btn-primary" : "btn-secondary";
  document.getElementById("sim-btn-week").className = mode === "week" ? "btn-primary" : "btn-secondary";
  document.getElementById("sim-btn-day").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  document.getElementById("sim-btn-week").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  _updateSimHeader();
  renderSimChart();
}

function _updateSimHeader() {
  const modeLabel = document.getElementById("sim-chart-mode-label");
  const subtitle = document.getElementById("sim-chart-subtitle");
  const backBtn = document.getElementById("sim-back-btn");
  const pct = activeSimulation?.epexPct ?? 0;
  const epexNote = pct === 100 ? "" : ` · ${pct > 0 ? pct + "% echte EPEX" : "⚠ gesimuleerde prijzen"}`;

  if (simDrillDay) {
    const d = new Date(simDrillDay + "T12:00:00");
    modeLabel.textContent = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
    subtitle.textContent = `Kosten per uur · groen = dynamisch goedkoper · rood = duurder${epexNote}`;
    if (backBtn) backBtn.style.display = "";
  } else {
    modeLabel.textContent = simMode === "week" ? "Week" : "Dag";
    subtitle.textContent = simMode === "week"
      ? `Totale kosten per week · klik op een balk voor uurdetail${epexNote}`
      : `Totale kosten per dag · klik op een dag voor uurdetail${epexNote}`;
    if (backBtn) backBtn.style.display = "none";
  }
}

// ── Simulatiechart ────────────────────────────────────────────────────────────
function renderSimChart() {
  const card = document.getElementById("sim-chart-card");
  if (!energyData || energyData.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";
  _updateSimHeader();

  if (simDrillDay) { _renderSimDrill(); return; }

  const isWeekMode = simMode === "week";
  const pdt = activeSimulation.perDayTotals;
  if (!pdt) return;

  const buckets = new Map();
  Object.entries(pdt).sort().forEach(([date, v]) => {
    const key = isWeekMode ? isoWeek(date) : date;
    if (!buckets.has(key)) buckets.set(key, { dyn: 0, fixed: 0, firstDate: date });
    const b = buckets.get(key);
    b.dyn += v.dynCost;
    b.fixed += v.fixedCost;
  });
  const keys = [...buckets.keys()];
  const dyns = keys.map(k => buckets.get(k).dyn);
  const fixeds = keys.map(k => buckets.get(k).fixed);
  const N = keys.length;
  if (!N) return;

  const maxVal = Math.max(...dyns, ...fixeds, 0.01) * 1.15;
  const container = document.getElementById("sim-svg-container");
  const svg = document.getElementById("sim-svg");
  const tooltip = document.getElementById("sim-tooltip");
  const W = container.clientWidth, H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const PAD_L = 42, PAD_R = 12, PAD_T = 14, PAD_B = 28;
  const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B;
  const barSlot = cW / N, barW = Math.max(2, barSlot * 0.35);

  const mk = (tag, a) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v)); return el; };
  const yOf = v => PAD_T + cH - Math.max(0, v) / maxVal * cH;
  const htOf = v => Math.max(0, v) / maxVal * cH;
  const xOf = i => PAD_L + i * barSlot + barSlot / 2;

  svg.appendChild(mk("line", { x1: PAD_L, y1: PAD_T + cH, x2: W - PAD_R, y2: PAD_T + cH, stroke: "rgba(255,255,255,0.15)", "stroke-width": "1" }));
  [0.25, 0.5, 0.75, 1].forEach(r => svg.appendChild(mk("line", { x1: PAD_L, y1: PAD_T + cH * (1 - r), x2: W - PAD_R, y2: PAD_T + cH * (1 - r), stroke: "rgba(255,255,255,0.04)" })));
  [0, 0.5, 1].forEach(r => {
    const lbl = mk("text", { x: PAD_L - 5, y: PAD_T + cH * (1 - r) + 4, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
    lbl.textContent = `€${(r * maxVal).toFixed(2)}`; svg.appendChild(lbl);
  });

  for (let i = 0; i < N; i++) {
    svg.appendChild(mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: dyns[i] < fixeds[i] ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
    [[dyns[i], "rgba(0,242,254,0.75)", -barW * 0.55], [fixeds[i], "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
      const ht = htOf(val); if (ht < 0.5) return;
      svg.appendChild(mk("rect", { x: xOf(i) + off, y: yOf(val), width: barW, height: ht, fill: col, rx: "1" }));
    });
  }

  const every = Math.ceil(N / 12);
  keys.forEach((k, i) => {
    if (i % every !== 0 && i !== N - 1) return;
    const lbl = mk("text", { x: xOf(i), y: H - 8, "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "8" });
    lbl.textContent = isWeekMode ? k.replace(/^\d{4}-/, "") : (() => { const d = new Date(k + "T12:00:00"); return `${d.getDate()}/${d.getMonth() + 1}`; })();
    svg.appendChild(lbl);
  });

  for (let i = 0; i < N; i++) {
    const ov = mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: "transparent", cursor: "pointer" });
    ov.addEventListener("mouseenter", () => {
      const diff = dyns[i] - fixeds[i];
      const label = isWeekMode ? keys[i] : (() => { const d = new Date(keys[i] + "T12:00:00"); return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }); })();
      document.getElementById("sim-tt-hour").textContent = label + (isWeekMode ? "" : " · klik voor uurdetail");
      document.getElementById("sim-tt-dyn").textContent = `€ ${dyns[i].toFixed(2)}`;
      document.getElementById("sim-tt-fixed").textContent = `€ ${fixeds[i].toFixed(2)}`;
      const de = document.getElementById("sim-tt-diff");
      de.textContent = (diff < 0 ? "−" : "+") + ` € ${Math.abs(diff).toFixed(2)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
      de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
      document.getElementById("sim-tt-spot").textContent = "";
      tooltip.style.display = "block";
      let tx = xOf(i) + 12; if (tx + 200 > W) tx = xOf(i) - 210;
      tooltip.style.left = tx + "px"; tooltip.style.top = (PAD_T + 10) + "px";
      ov.setAttribute("fill", "rgba(255,255,255,0.04)");
    });
    ov.addEventListener("mouseleave", () => { tooltip.style.display = "none"; ov.setAttribute("fill", "transparent"); });
    // Drill-down on click (day mode only — week mode drills to the first day of that week)
    ov.addEventListener("click", () => {
      if (!isWeekMode) {
        simDrillDay = keys[i];
      } else {
        simDrillDay = buckets.get(keys[i]).firstDate;
      }
      tooltip.style.display = "none";
      renderSimChart();
    });
    svg.appendChild(ov);
  }
}

// ── Drill-down: uurkosten voor één specifieke dag ────────────────────────────
function _renderSimDrill() {
  const dayData = activeSimulation?.perDayHourly?.[simDrillDay];
  if (!dayData) { simDrillDay = null; renderSimChart(); return; }

  const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
  const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;

  const dynVals = dayData.map(h => h ? h.dynCost : 0);
  const fixedVals = dayData.map(h => {
    if (!h) return 0;
    const dt = new Date(simDrillDay + "T00:00:00"); dt.setHours(h ? dayData.indexOf(h) : 0);
    // Use stored fixedCost
    return h.fixedCost;
  });
  const spots = dayData.map(h => h ? h.spot : null);

  const container = document.getElementById("sim-svg-container");
  const svg = document.getElementById("sim-svg");
  const tooltip = document.getElementById("sim-tooltip");
  const W = container.clientWidth, H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const PAD_L = 42, PAD_R = 40, PAD_T = 14, PAD_B = 28;
  const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B;
  const N = 24, barSlot = cW / N, barW = Math.max(2, barSlot * 0.38);
  const maxCost = Math.max(...dynVals.map(Math.abs), ...fixedVals.map(Math.abs), 0.001) * 1.2;
  const zero = PAD_T + cH / 2;

  const mk = (tag, a) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v)); return el; };
  const yOf = v => zero - (v / maxCost) * (cH / 2);
  const xOf = h => PAD_L + h * barSlot + barSlot / 2;

  // Zero line
  svg.appendChild(mk("line", { x1: PAD_L, y1: zero, x2: W - PAD_R, y2: zero, stroke: "rgba(255,255,255,0.2)", "stroke-width": "1" }));
  [0.5, 1].forEach(r => [1, -1].forEach(s => {
    const y = zero - s * r * (cH / 2);
    svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(255,255,255,0.04)" }));
  }));

  // Y-axis labels (left)
  ["1", "0", "-1"].forEach((_, i) => {
    const val = (1 - i) * maxCost, y = zero - (1 - i) * (cH / 2);
    const lbl = mk("text", { x: PAD_L - 5, y: y + 4, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
    const fmt = v => v >= 0.01 ? `€${v.toFixed(2)}` : `${(v * 100).toFixed(1)}¢`;
    lbl.textContent = fmt(Math.abs(val)) + (val < 0 ? " +" : (val > 0 ? " −" : ""));
    svg.appendChild(lbl);
  });

  // Bars + background shading
  for (let h = 0; h < 24; h++) {
    const dyn = dynVals[h], fx = fixedVals[h], diff = dyn - fx;
    svg.appendChild(mk("rect", { x: PAD_L + h * barSlot, y: PAD_T, width: barSlot, height: cH, fill: diff < 0 ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
    [[dyn, "rgba(0,242,254,0.75)", -barW * 0.55], [fx, "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
      const y1 = yOf(0), y2 = yOf(val), top = Math.min(y1, y2), ht = Math.abs(y2 - y1);
      if (ht < 0.5) return;
      svg.appendChild(mk("rect", { x: xOf(h) + off, y: top, width: barW, height: ht, fill: col, rx: "1" }));
    });
  }

  // Price line + right axis
  const validSpots = spots.filter(s => s != null);
  if (validSpots.length) {
    const priceMax = Math.max(...validSpots.map(s => toConsumerPrice(s)), fixedPeak, 0.10) * 1.15;
    const yP = v => PAD_T + cH * (1 - v / priceMax);
    const pRX = W - PAD_R + 4;
    [0, 0.5, 1].forEach(r => {
      const val = r * priceMax, y = yP(val);
      svg.appendChild(mk("line", { x1: W - PAD_R, y1: y, x2: W - PAD_R + 3, y2: y, stroke: "rgba(255,255,255,0.2)", "stroke-width": "1" }));
      const lbl = mk("text", { x: pRX + 1, y: y + 3, "text-anchor": "start", fill: "rgba(255,255,255,0.35)", "font-size": "7" });
      lbl.textContent = `€${val.toFixed(2)}`; svg.appendChild(lbl);
    });
    const axL = mk("text", { x: W - 2, y: PAD_T + cH / 2, "text-anchor": "middle", fill: "rgba(255,255,255,0.25)", "font-size": "7", transform: `rotate(-90,${W - 2},${PAD_T + cH / 2})` });
    axL.textContent = "€/kWh"; svg.appendChild(axL);
    // Fixed tariff lines
    [[fixedPeak, "piek", 0.65], [fixedDal, "dal", 0.35]].forEach(([t, lbl2, xf]) => {
      const y = yP(t);
      svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(102,126,234,0.45)", "stroke-width": "1", "stroke-dasharray": "4,3" }));
      const lt = mk("text", { x: PAD_L + cW * xf, y: y - 2, "text-anchor": "middle", fill: "rgba(102,126,234,0.75)", "font-size": "7" });
      lt.textContent = `vast ${lbl2} €${t.toFixed(2)}`; svg.appendChild(lt);
    });
    // Dynamic price step line
    const pts = [];
    spots.forEach((s, h) => {
      if (s == null) return;
      const x1 = PAD_L + h * barSlot, x2 = x1 + barSlot, y = yP(toConsumerPrice(s));
      pts.push(pts.length === 0 ? `M${x1},${y}` : `L${x1},${y}`);
      pts.push(`L${x2},${y}`);
    });
    if (pts.length) svg.appendChild(mk("path", { d: pts.join(" "), fill: "none", stroke: "rgba(0,242,254,0.8)", "stroke-width": "1.5" }));
  }

  // X labels
  [0, 4, 8, 12, 16, 20, 23].forEach(h => {
    const lbl = mk("text", { x: xOf(h), y: H - 8, "text-anchor": "middle", fill: "var(--text-muted)", "font-size": "9" });
    lbl.textContent = `${String(h).padStart(2, "0")}:00`; svg.appendChild(lbl);
  });

  // Hover overlays
  for (let h = 0; h < 24; h++) {
    const ov = mk("rect", { x: PAD_L + h * barSlot, y: PAD_T, width: barSlot, height: cH, fill: "transparent", cursor: "crosshair" });
    ov.addEventListener("mouseenter", () => {
      const dyn = dynVals[h], fx = fixedVals[h], diff = dyn - fx;
      document.getElementById("sim-tt-hour").textContent = `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
      document.getElementById("sim-tt-dyn").textContent = `€ ${Math.abs(dyn).toFixed(4)}/uur${dyn < 0 ? " (opbrengst)" : ""}`;
      document.getElementById("sim-tt-fixed").textContent = `€ ${Math.abs(fx).toFixed(4)}/uur${fx < 0 ? " (opbrengst)" : ""}`;
      const de = document.getElementById("sim-tt-diff");
      de.textContent = (diff < 0 ? "−" : "+") + ` € ${Math.abs(diff).toFixed(4)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
      de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
      const s = spots[h];
      document.getElementById("sim-tt-spot").textContent = s != null ? `Consumentenprijs: € ${toConsumerPrice(s).toFixed(3)}/kWh` : "";
      tooltip.style.display = "block";
      let tx = xOf(h) + 12; if (tx + 200 > W) tx = xOf(h) - 210;
      tooltip.style.left = tx + "px"; tooltip.style.top = (PAD_T + 10) + "px";
      ov.setAttribute("fill", "rgba(255,255,255,0.04)");
    });
    ov.addEventListener("mouseleave", () => { tooltip.style.display = "none"; ov.setAttribute("fill", "transparent"); });
    svg.appendChild(ov);
  }
}

// ── Hardware effect chart ─────────────────────────────────────────────────────
// ── Afname detail toggle ──────────────────────────────────────────────────────
let afnameDetailOpen = false;
function toggleAfnameDetail() {
  afnameDetailOpen = !afnameDetailOpen;
  document.getElementById("tbl-dyn-afname-detail").style.display = afnameDetailOpen ? "" : "none";
  document.getElementById("afname-toggle-icon").style.transform = afnameDetailOpen ? "rotate(180deg)" : "";
  if (afnameDetailOpen) renderAfnameDetail();
}

let afnameDetailView = "hour"; // "day" | "hour"

function renderAfnameDetail() {
  const body = document.getElementById("afname-detail-body");
  if (!body) return;

  // View toggle buttons
  const viewToggle = `
    <div style="display:flex;gap:0.3rem;padding:0.4rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.07);">
      <button onclick="setAfnameView('hour')" id="afn-btn-hour"
        style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;border:none;cursor:pointer;
          background:${afnameDetailView === 'hour' ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'};
          color:${afnameDetailView === 'hour' ? '#000' : 'var(--text-muted)'};">Per uur (gem.)</button>
      <button onclick="setAfnameView('day')" id="afn-btn-day"
        style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;border:none;cursor:pointer;
          background:${afnameDetailView === 'day' ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.08)'};
          color:${afnameDetailView === 'day' ? '#000' : 'var(--text-muted)'};">Per dag</button>
      <span style="font-size:0.68rem;color:var(--text-muted);margin-left:0.5rem;align-self:center;">
        ${activeSimulation.epexPct === 100 ? "✓ echte EPEX uurprijzen" : activeSimulation.epexPct > 0 ? `${activeSimulation.epexPct}% echt` : "⚠ gesimuleerde prijzen (klik Ophalen)"}
      </span>
    </div>`;

  if (afnameDetailView === 'hour') {
    renderAfnameDetailHour(body, viewToggle);
  } else {
    renderAfnameDetailDay(body, viewToggle);
  }
}

function setAfnameView(v) { afnameDetailView = v; renderAfnameDetail(); }

function renderAfnameDetailHour(body, viewToggle) {
  const hp = activeSimulation?.hourlyProfile;
  if (!hp) { body.innerHTML = viewToggle + "<p>Geen data.</p>"; return; }
  const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
  const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;

  const med = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  const hours = Array.from({ length: 24 }, (_, h) => {
    const impKwh = med(hp[h].imports);
    const expKwh = med(hp[h].exports);
    const spot = med(hp[h].spots);
    const consPrice = toConsumerPrice(spot);
    const isPeak = h >= 7 && h < 23;
    const fixedRate = isPeak ? fixedPeak : fixedDal; // simplified (weekday/weekend not split here)
    const impCostDyn = impKwh * consPrice;
    const impCostFixed = impKwh * fixedRate;
    return { h, impKwh, expKwh, spot, consPrice, impCostDyn, impCostFixed };
  });

  const maxImpCost = Math.max(...hours.map(r => Math.max(r.impCostDyn, r.impCostFixed)), 0.01);

  body.innerHTML = viewToggle + `
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead>
        <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.08);position:sticky;top:0;background:var(--glass-bg);">
          <th style="padding:0.3rem 0.4rem;text-align:left;font-weight:500;">Uur</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Gem. afname</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;" title="Ruwe beursprijs excl. BTW/EB/opslag — voor referentie">EPEX markt</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;" title="All-in consumentenprijs = EPEX + opslag + BTW + EB">All-in prijs</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Dyn kosten/uur</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Vast kosten/uur</th>
        </tr>
      </thead>
      <tbody>
        ${hours.map(r => {
    const dynCheaper = r.impCostDyn <= r.impCostFixed;
    const barDyn = Math.round(r.impCostDyn / maxImpCost * 55);
    const barFixed = Math.round(r.impCostFixed / maxImpCost * 55);
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.03);background:${dynCheaper ? "rgba(56,239,125,0.03)" : "rgba(255,100,100,0.03)"};">
            <td style="padding:0.2rem 0.4rem;font-variant-numeric:tabular-nums;">${String(r.h).padStart(2, "0")}:00–${String(r.h + 1).padStart(2, "0")}:00</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">${r.impKwh.toFixed(3)} kWh</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:${r.spot / 1.21 > 0.20 ? "var(--accent-orange)" : "var(--text-muted)"};">€ ${(r.spot / 1.21).toFixed(3)}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-cyan);">€ ${r.consPrice.toFixed(3)}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${barDyn}px;height:5px;background:rgba(0,242,254,${dynCheaper ? 0.6 : 0.3});border-radius:2px;"></div>
                <span style="color:${dynCheaper ? "var(--accent-green)" : "var(--accent-orange)"};">€ ${r.impCostDyn.toFixed(4)}</span>
              </div>
            </td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${barFixed}px;height:5px;background:rgba(102,126,234,0.4);border-radius:2px;"></div>
                € ${r.impCostFixed.toFixed(4)}
              </div>
            </td>
          </tr>`;
  }).join("")}
      </tbody>
    </table>
    <p style="font-size:0.68rem;color:var(--text-muted);padding:0.4rem 0.5rem;">
      Mediaan verbruik per uur over alle dagen × mediaan consumentenprijs. Rode uren = dynamisch duurder dan vast.
      ${activeSimulation.epexPct < 100 ? "<br>⚠ Gesimuleerde prijzen — met echte EPEX-data (Ophalen) worden winterpieken zichtbaar." : ""}
    </p>`;
}

function renderAfnameDetailDay(body, viewToggle) {
  const pdt = activeSimulation?.perDayTotals;
  if (!pdt) { body.innerHTML = viewToggle + "<p>Geen data.</p>"; return; }

  const rows = Object.entries(pdt).sort().map(([date, v]) => {
    const avgPrice = v.impKwh > 0 ? v.impCost / v.impKwh : 0;
    const avgSpot = v.spotN > 0 ? v.spotSum / v.spotN : 0;
    const d = new Date(date + "T12:00:00");
    return { label: d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }), ...v, avgPrice, avgSpot };
  });

  const maxCost = Math.max(...rows.map(r => r.impCost), 0.01);

  body.innerHTML = viewToggle + `
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead>
        <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.08);">
          <th style="padding:0.3rem 0.4rem;text-align:left;font-weight:500;">Datum</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Afname kWh</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Gem. cons.prijs</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Afname kosten</th>
          <th style="padding:0.3rem 0.4rem;text-align:right;font-weight:500;">Teruglevering</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
            <td style="padding:0.2rem 0.4rem;">${r.label}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">${r.impKwh.toFixed(2)} kWh</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-cyan);">${r.avgPrice > 0 ? "€ " + r.avgPrice.toFixed(3) + "/kWh" : "—"}</td>
            <td style="padding:0.2rem 0.4rem;text-align:right;">
              <div style="display:flex;align-items:center;gap:0.25rem;justify-content:flex-end;">
                <div style="width:${Math.round(r.impCost / maxCost * 55)}px;height:5px;background:rgba(0,242,254,0.5);border-radius:2px;"></div>
                € ${r.impCost.toFixed(3)}
              </div>
            </td>
            <td style="padding:0.2rem 0.4rem;text-align:right;color:var(--accent-green);">−€ ${r.expRev.toFixed(3)}</td>
          </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr style="border-top:1px solid rgba(255,255,255,0.12);font-weight:600;">
          <td style="padding:0.3rem 0.4rem;">Totaal</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;">${rows.reduce((s, r) => s + r.impKwh, 0).toFixed(1)} kWh</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;color:var(--accent-cyan);">€ ${(rows.reduce((s, r) => s + r.impCost, 0) / rows.reduce((s, r) => s + r.impKwh, 0)).toFixed(3)}/kWh gem.</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;">€ ${rows.reduce((s, r) => s + r.impCost, 0).toFixed(2)}</td>
          <td style="padding:0.3rem 0.4rem;text-align:right;color:var(--accent-green);">−€ ${rows.reduce((s, r) => s + r.expRev, 0).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>`;
}

// Maandelijkse kostenvergelijking: aggregeert perDayTotals (energiekosten excl.
// vastrecht) per kalendermaand en tekent 12 gegroepeerde staafparen (vast vs dynamisch).
function renderMonthlyChart() {
  const card = document.getElementById("monthly-chart-card");
  const perDay = activeSimulation?.perDayTotals;
  if (!card || !perDay) { if (card) card.style.display = "none"; return; }

  const months = Array.from({ length: 12 }, () => ({ fixed: 0, dyn: 0, has: false }));
  for (const [dk, d] of Object.entries(perDay)) {
    const m = parseInt(dk.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) continue;
    months[m].fixed += d.fixedCost;
    months[m].dyn += d.dynCost;
    months[m].has = true;
  }
  if (!months.some(m => m.has)) { card.style.display = "none"; return; }
  card.style.display = "";

  const svg = document.getElementById("monthly-svg");
  const container = document.getElementById("monthly-svg-container");
  const W = container.clientWidth, H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  const padL = 46, padR = 12, padT = 14, padB = 24;
  const cw = W - padL - padR, ch = H - padT - padB;
  const labels = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const maxV = Math.max(1, ...months.map(m => Math.max(m.fixed, m.dyn)));

  // y-as gridlijnen + labels
  for (let i = 0; i <= 4; i++) {
    const y = padT + ch - (ch * i / 4);
    svg.appendChild(mk("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }));
    const lbl = mk("text", { x: padL - 6, y: y + 3, "text-anchor": "end", "font-size": 9, fill: "var(--text-muted)" });
    lbl.textContent = `€${Math.round(maxV * i / 4)}`;
    svg.appendChild(lbl);
  }

  const groupW = cw / 12;
  const barW = Math.min(13, groupW / 2 - 2);
  months.forEach((m, i) => {
    const gx = padL + groupW * i + groupW / 2;
    const bar = (val, offset, color) => {
      const h = ch * (val / maxV);
      const r = mk("rect", { x: gx + offset, y: padT + ch - h, width: barW, height: Math.max(0, h), fill: color, rx: 2, opacity: 0.85 });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${labels[i]} — €${val.toFixed(0)}`;
      r.appendChild(t);
      svg.appendChild(r);
    };
    if (m.has) {
      bar(m.fixed, -barW - 1, "var(--accent-indigo)");
      bar(m.dyn, 1, "var(--accent-cyan)");
    }
    const lbl = mk("text", { x: gx, y: H - 7, "text-anchor": "middle", "font-size": 9, fill: m.has ? "var(--text-muted)" : "rgba(255,255,255,0.22)" });
    lbl.textContent = labels[i];
    svg.appendChild(lbl);
  });
}

const hwOpenState = { hp: false, ev: false, bat: false };

function renderHwChart() {
  const card = document.getElementById("hw-chart-card");
  if (!card || !activeSimulation?.hwEffects) { if (card) card.style.display = "none"; return; }
  card.style.display = "";
  const fx = activeSimulation.hwEffects;
  // De engine levert nu altijd een volledig jaar → effect is al op jaarbasis, geen herschaling.
  const mf = 1.0;

  const deviceDefs = [
    {
      key: "hp", icon: "🌡", label: "Warmtepomp", data: fx.hp,
      explanation: (d) => {
        const bl = d.cfg?.hpWinterBaseload ?? 0;
        return `<strong>Aanname:</strong> Extra baseload van <strong>${bl} kW</strong> voor de warmtepomp.
          <br><br>
          <strong>Seizoensmodel:</strong> Deze simulatie is seizoensbewust. In de wintermaanden draait de warmtepomp op 130% van de baseload, in lente/herfst op 70%, en in de zomer op slechts 15% (alleen voor tapwater). Daarnaast verbruikt hij 's nachts (22–07u) extra energie omdat de buitenlucht kouder is.
          <br><br>
          Bij een <strong>dynamisch contract</strong> profiteer je automatisch van lage nacht- en middagtarieven
          wanneer de pomp het zwaarst draait. Bij <strong>vast</strong> betaal je altijd piek- of daltarief.`;
      }
    },
    {
      key: "ev", icon: "🚗", label: "Auto (EV)", data: fx.ev,
      explanation: (d) => {
        const { evDist, evCons, evSolar } = d.cfg ?? {};
        const dailyKwh = ((evDist ?? 0) * (evCons ?? 0) / 7).toFixed(2);
        return `<strong>Aanname:</strong> ${evDist ?? '?'} km/week × ${((evCons ?? 0) * 100).toFixed(0)} kWh/100km
          = <strong>${dailyKwh} kWh/dag</strong> extra verbruik.
          <br><br>
          ${evSolar
            ? `<strong>Solar-match strategie:</strong> Overdag (10–16u) laadt de auto direct op zonne-overschot. De resterende behoefte wordt 's nachts slim geladen op de allergoedkoopste uren (bij een spotprijs &lt; €0,05). Als failsafe wordt er anders tussen 02:00 en 05:00 geladen.`
            : `<strong>Prijsgestuurd laden:</strong> De simulatie zoekt volautomatisch naar de momenten dat de marktprijs extreem laag is (&lt; €0,05). Als deze uren er niet zijn, laadt hij als failsafe tussen 02:00 en 05:00 's nachts.`}
          <br><br>
          Bij <strong>dynamisch</strong> pak je hierdoor automatisch de negatieve of supergoedkope uren mee.`;
      }
    },
    {
      key: "bat", icon: "🔋", label: "Thuisaccu", data: fx.bat,
      explanation: (d) => {
        const { batCapacity, batPower, batEfficiency, batArbitrage } = d.cfg ?? {};
        return `<strong>Aanname:</strong> ${batCapacity ?? '?'} kWh accu, ${batPower ?? '?'} kW vermogen,
          ${batEfficiency ?? '?'}% laad-/ontlaadefficiëntie.
          <br><br>
          <strong>Slimme Laadstrategie:</strong> Eerst zonne-overschot opslaan (overdag).
          ${batArbitrage ? `Daarnaast doet de batterij aan net-arbitrage: stroom inkopen als de beursprijs bizar laag is (&lt; €0,01).` : `(Net-arbitrage is uitgeschakeld).`}
          <br><br>
          <strong>Slim Ontladen:</strong> De accu ontlaadt niet zomaar, maar <strong>alleen als de all-in stroomprijs boven de € 0,25 per kWh schiet</strong>. Hierdoor bewaar je je opgeslagen stroom echt voor de dure piekmomenten.
          <br><br>
          <em>De accu bespaart bij beide contractvormen, maar de hoge efficiëntieverliezen (${100 - (batEfficiency ?? 85)}%) vallen zwaarder op een dynamisch contract waar de prijsmarges kleiner zijn.</em>`;
      }
    },
  ];

  const container = document.getElementById("hw-chart-body");
  container.innerHTML = "";

  // EPEX warning
  const epexPct = activeSimulation.epexPct ?? 0;
  if (epexPct < 100) {
    const warn = document.createElement("div");
    warn.style.cssText = "background:rgba(255,165,0,0.12);border:1px solid rgba(255,165,0,0.3);border-radius:6px;padding:0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.75rem;color:var(--accent-orange);";
    warn.innerHTML = epexPct === 0
      ? `⚠ <strong>Let op: geen echte EPEX-uurprijzen.</strong> De simulatie gebruikt <em>seizoensprofielen</em> als noodoplossing (winter = hogere prijzen, zomer = negatieve middagen) —
         dit geeft een redelijke schatting maar mist de echte piekdagen. Klik <strong>Ophalen</strong> om actuele historische EPEX-prijzen te laden voor een exacte berekening.`
      : `⚠ ${epexPct}% echte EPEX-prijzen geladen, ${100 - epexPct}% gesimuleerd via seizoensprofiel.`;
    container.appendChild(warn);
  }

  const maxAbsAll = Math.max(...deviceDefs.map(d => Math.max(Math.abs(d.data.fixed * mf), Math.abs(d.data.dyn * mf))), 1);

  deviceDefs.forEach(({ key, icon, label, data, explanation }) => {
    const fixedPm = data.fixed * mf;
    const dynPm = data.dyn * mf;
    const isEnabled = data.enabled;

    const wrap = document.createElement("div");
    wrap.style.cssText = "border-bottom:1px solid rgba(255,255,255,0.06);";

    // Header row
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:auto 1fr;gap:0.75rem;padding:0.55rem 0;cursor:pointer;align-items:start;";
    row.title = "Klik voor berekening";

    // Left: icon + label + status
    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:0.4rem;min-width:110px;";
    left.innerHTML = `<span style="font-size:1rem;">${icon}</span>
      <span style="font-size:0.8rem;color:${isEnabled ? "var(--text-primary)" : "var(--text-muted)"};">${label}</span>
      <span style="font-size:0.65rem;padding:0.1rem 0.3rem;border-radius:3px;background:${isEnabled ? "rgba(56,239,125,0.15)" : "rgba(255,255,255,0.07)"};color:${isEnabled ? "var(--accent-green)" : "var(--text-muted)"};">${isEnabled ? "aan" : "uit"}</span>`;

    // Right: two bars + toggle icon
    const right = document.createElement("div");
    right.style.cssText = "display:flex;flex-direction:column;gap:4px;";

    const toggleIcon = document.createElement("div");
    toggleIcon.style.cssText = "font-size:0.65rem;color:var(--text-muted);text-align:right;transition:transform 0.2s;";
    toggleIcon.id = `hw-toggle-${key}`;
    toggleIcon.textContent = "▼ uitleg";

    [[`Vast: ${fixedPm >= 0 ? "+" : ""}€${Math.abs(fixedPm).toFixed(2)}/jaar`, fixedPm, "var(--accent-indigo)"],
    [`Dynamisch: ${dynPm >= 0 ? "+" : ""}€${Math.abs(dynPm).toFixed(2)}/jaar`, dynPm, "var(--accent-cyan)"]].forEach(([lbl2, val, color]) => {
      const line = document.createElement("div");
      line.style.cssText = "display:flex;align-items:center;gap:0.4rem;";
      const barTrack = document.createElement("div");
      barTrack.style.cssText = "flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;";
      const bar = document.createElement("div");
      const pct = Math.min(100, Math.abs(val) / maxAbsAll * 100);
      const isNeg = val < 0;
      bar.style.cssText = `height:100%;width:${pct}%;background:${isNeg ? "var(--accent-green)" : color};opacity:0.75;border-radius:4px;`;
      barTrack.appendChild(bar);
      const txt = document.createElement("span");
      txt.style.cssText = `font-size:0.7rem;color:${isNeg ? "var(--accent-green)" : color};white-space:nowrap;min-width:110px;`;
      txt.textContent = lbl2;
      line.appendChild(txt);
      line.appendChild(barTrack);
      right.appendChild(line);
    });
    right.appendChild(toggleIcon);

    row.appendChild(left);
    row.appendChild(right);
    wrap.appendChild(row);

    // Expandable explanation
    const detail = document.createElement("div");
    detail.id = `hw-detail-${key}`;
    detail.style.cssText = `display:${hwOpenState[key] ? "" : "none"};padding:0.5rem 0 0.75rem 0.5rem;font-size:0.75rem;color:var(--text-muted);line-height:1.6;border-top:1px solid rgba(255,255,255,0.05);`;
    detail.innerHTML = explanation(data);
    wrap.appendChild(detail);

    row.addEventListener("click", () => {
      hwOpenState[key] = !hwOpenState[key];
      detail.style.display = hwOpenState[key] ? "" : "none";
      const ti = document.getElementById(`hw-toggle-${key}`);
      if (ti) { ti.textContent = hwOpenState[key] ? "▲ sluiten" : "▼ uitleg"; }
    });

    container.appendChild(wrap);
  });

  // Totaalregel (alleen actieve apparaten)
  const activeDevices = deviceDefs.filter(d => d.data.enabled);
  if (activeDevices.length > 1) {
    const totalFixed = activeDevices.reduce((s, d) => s + d.data.fixed * mf, 0);
    const totalDyn = activeDevices.reduce((s, d) => s + d.data.dyn * mf, 0);
    const tot = document.createElement("div");
    tot.style.cssText = "display:flex;gap:1.5rem;padding-top:0.6rem;font-size:0.75rem;color:var(--text-muted);flex-wrap:wrap;";
    tot.innerHTML = `
      <span>Totaal effect actieve apparaten — vast: <strong style="color:${totalFixed < 0 ? "var(--accent-green)" : "var(--accent-indigo)"};">${totalFixed >= 0 ? "+" : ""}€${totalFixed.toFixed(2)}/jaar</strong></span>
      <span>dynamisch: <strong style="color:${totalDyn < 0 ? "var(--accent-green)" : "var(--accent-cyan)"};">${totalDyn >= 0 ? "+" : ""}€${totalDyn.toFixed(2)}/jaar</strong></span>`;
    container.appendChild(tot);
  }
}

// ISO week number helper (ISO 8601)
function isoWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const diff = d - startOfWeek1;
  const week = Math.floor(diff / (7 * 86400000)) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function setOverviewMode(mode) {
  overviewMode = mode;
  document.getElementById("ov-btn-day").className = mode === "day" ? "btn-primary" : "btn-secondary";
  document.getElementById("ov-btn-week").className = mode === "week" ? "btn-primary" : "btn-secondary";
  document.getElementById("ov-btn-day").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  document.getElementById("ov-btn-week").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  renderOverviewChart();
}

function renderOverviewChart() {
  const card = document.getElementById("overview-chart-card");
  if (!energyData || energyData.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";

  // Aggregate to day or week totals
  const bucketMap = new Map();
  energyData.forEach(row => {
    const key = overviewMode === "week"
      ? isoWeek(row.timestamp.slice(0, 10))
      : row.timestamp.slice(0, 10);
    if (!bucketMap.has(key)) bucketMap.set(key, { imp: 0, exp: 0 });
    const e = bucketMap.get(key);
    e.imp += (row.import_t1 || 0) + (row.import_t2 || 0);
    e.exp += (row.export_t1 || 0) + (row.export_t2 || 0);
  });

  const days = Array.from(bucketMap.keys()).sort();
  const values = days.map(d => bucketMap.get(d));
  const maxVal = Math.max(...values.map(v => Math.max(v.imp, v.exp)), 1) * 1.15;

  const container = document.getElementById("overview-svg-container");
  const svg = document.getElementById("overview-svg");
  const tooltip = document.getElementById("overview-tooltip");
  const W = container.clientWidth;
  const H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const PAD_L = 42, PAD_R = 12, PAD_T = 14, PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = days.length;
  const barW = Math.max(1, (chartW / n) - 1);

  const xOf = i => PAD_L + i * (chartW / n) + 0.5;
  const yOf = v => PAD_T + chartH - (v / maxVal) * chartH;

  const mk = (tag, attrs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  // Grid lines + Y labels
  for (let t = 0; t <= 4; t++) {
    const ratio = t / 4;
    const y = PAD_T + chartH * (1 - ratio);
    const val = (ratio * maxVal).toFixed(0);
    svg.appendChild(mk("line", {
      x1: PAD_L, y1: y, x2: W - PAD_R, y2: y,
      stroke: "rgba(255,255,255,0.04)"
    }));
    const lbl = mk("text", {
      x: PAD_L - 6, y: y + 4, "text-anchor": "end",
      fill: "var(--text-muted)", "font-size": 9
    });
    lbl.textContent = val;
    svg.appendChild(lbl);
  }

  // Bars — export first (behind), then import on top
  values.forEach((v, i) => {
    const x = xOf(i);
    // Export bar (green, full height relative to export value)
    if (v.exp > 0) {
      svg.appendChild(mk("rect", {
        x, y: yOf(v.exp), width: barW, height: chartH - (yOf(v.exp) - PAD_T),
        fill: "rgba(56,239,125,0.55)", rx: 1
      }));
    }
    // Import bar (cyan)
    if (v.imp > 0) {
      svg.appendChild(mk("rect", {
        x, y: yOf(v.imp), width: barW, height: chartH - (yOf(v.imp) - PAD_T),
        fill: "rgba(0,242,254,0.55)", rx: 1
      }));
    }
  });

  // X-axis date labels (show ~8 labels max)
  const step = Math.max(1, Math.floor(n / 8));
  days.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const lbl = mk("text", {
      x: xOf(i) + barW / 2, y: H - 8,
      "text-anchor": "middle", fill: "var(--text-muted)", "font-size": 9
    });
    const labelText = overviewMode === "week"
      ? d.replace(/(\d{4})-W(\d+)/, (_, y, w) => `W${w} '${y.slice(2)}`)
      : new Date(d + "T12:00:00Z").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    lbl.textContent = labelText;
    svg.appendChild(lbl);
  });

  // Hover overlay bars (invisible, for tooltip)
  values.forEach((v, i) => {
    const x = xOf(i);
    const overlay = mk("rect", {
      x, y: PAD_T, width: barW, height: chartH,
      fill: "transparent", cursor: "crosshair"
    });
    overlay.addEventListener("mouseenter", (e) => {
      const key = days[i];
      document.getElementById("ov-date").textContent = overviewMode === "week"
        ? key.replace(/(\d{4})-W(\d+)/, (_, y, w) => `Week ${w}, ${y}`)
        : new Date(key + "T12:00:00Z").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      document.getElementById("ov-import").textContent = v.imp.toFixed(2) + " kWh";
      document.getElementById("ov-export").textContent = v.exp.toFixed(2) + " kWh";
      const net = v.imp - v.exp;
      const netEl = document.getElementById("ov-net");
      netEl.textContent = (net >= 0 ? "+" : "") + net.toFixed(2) + " kWh";
      netEl.style.color = net >= 0 ? "var(--accent-orange)" : "var(--accent-green)";
      // Position tooltip
      const rect = container.getBoundingClientRect();
      tooltip.style.display = "block";
      let tx = x + barW + 8;
      if (tx + 180 > W) tx = x - 188;
      tooltip.style.left = tx + "px";
      tooltip.style.top = Math.max(0, yOf(Math.max(v.imp, v.exp)) - 10) + "px";
      // Highlight bar
      overlay.setAttribute("fill", "rgba(255,255,255,0.06)");
    });
    overlay.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      overlay.setAttribute("fill", "transparent");
    });
    svg.appendChild(overlay);
  });
}
