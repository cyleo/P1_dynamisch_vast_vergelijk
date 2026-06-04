/* Core Dashboard Logic & Simulation Engine */

// Global state
let energyData = [];
let overviewMode = "day"; // "day" | "week"
let simMode = "day";  // "day" | "week"
let simDrillDay = null;   // YYYY-MM-DD — drill-down naar uurweergave voor die dag
let activeSimulation = {};
let profileVisibleLines = {
  imp: true,
  exp: true,
  spot: true,
  solar: true,
  ev: true,
  hp: true,
  bat: true
};
function toggleProfileLine(key) {
  profileVisibleLines[key] = !profileVisibleLines[key];
  const legendEl = document.getElementById(`legend-${key}`);
  if (legendEl) {
    legendEl.style.opacity = profileVisibleLines[key] ? "1" : "0.35";
    legendEl.style.textDecoration = profileVisibleLines[key] ? "none" : "line-through";
  }
  renderChart();
}
window.toggleProfileLine = toggleProfileLine;
let epexHistory = new Map(); // isoHour (floored) → price incl. BTW (€/kWh)
let liveEnergyTax = 0.11084;   // updated by fetchTarieven()

// ── Digital Twin ─────────────────────────────────────────────────────────────
let _lastHAStats = null;    // ruwe HA-statistieken; bewaard voor DT-toggle hertransformatie
let _lastRoleMap = null;    // bijbehorende roleMap
let digitalTwinEnabled = true;  // false = gebruik ruwe meterstanden ook als apparaten gekoppeld zijn

// ── Data-ingest & jaarprojectie ─────────────────────────────────────────────
let isDemoData = true;   // demo/voorbeeld actief? eerste upload vervangt i.p.v. mergt
let fullYearData = null;   // 8760-uurs jaarprojectie (echte + gesynthetiseerde uren); null = geen synthese
let fullYearStamp = "";     // cache-stempel: vermijdt herbouw als energyData/toggle ongewijzigd is
let yearScale = 1.0;    // normaliseert de som van de loop naar exact één jaar (8760u / #uren)
let dataMeta = { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 };

// ── Wegklikbare uitleg/waarschuwingen ───────────────────────────────────────
// Statische boxen (intro, scope-note) onthouden hun weggeklikt-status in localStorage;
// dynamisch gerenderde banners (EPEX-waarschuwing, prognose-badge) per sessie via vlag.
let epexWarnDismissed = false;
let prognosisDismissed = false;

function isDismissed(id) {
  try { return localStorage.getItem("dismiss_" + id) === "1"; } catch (e) { return false; }
}
function applyPersistedDismissals() {
  ["intro-explainer", "scope-note"].forEach(id => {
    if (isDismissed(id)) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
  });
}
function initDismissHandlers() {
  applyPersistedDismissals();
  // Capture-fase: vóór de details-toggle / globale tooltip-click, zodat de × alleen wegklikt.
  document.addEventListener("click", (e) => {
    const x = e.target.closest(".dismiss-x");
    if (!x) return;
    e.preventDefault(); e.stopPropagation();
    const id = x.getAttribute("data-dismiss");
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
    if (x.hasAttribute("data-persist")) { try { localStorage.setItem("dismiss_" + id, "1"); } catch (_) {} }
    if (id === "epex-warn-box") epexWarnDismissed = true;
    if (id === "prognosis-badge") prognosisDismissed = true;
    if (id === "data-quality-banner") dataQualityDismissed = true;
  }, true);
}

// ── Simulatie-constanten (voorheen verspreide magic numbers) ─────────────────
const EV_MAX_CHARGE_KW = 11.0;   // max laadvermogen EV per uur (kWh)
const BATTERY_C_RATE = 0.5;    // laad/ontlaadvermogen = capaciteit × C-rate
const EVENING_PEAK_MULT = 3.0;    // koken/verlichting: synthetische avond × baseload (17–21u)

// Maandelijkse warmtepomp-belastingfactor o.b.v. NL klimaat-graaddagen (HDD, basis 18°C,
// De Bilt-normaal 1991–2020), genormaliseerd op de wintermaanden (dec–feb gem. ≈ 1,3 =
// de "winter stooklast"-schuif). Zomer houdt een vloer (~0,15) voor warmtapwater.
// Realistischere seizoensvorm dan de oude 3-staps 1,3/0,7/0,15: koudste maand (jan) piekt
// en de schouderseizoenen lopen geleidelijk. NB: dit lijnt nog NIET per dag uit met de
// EPEX-koudepieken — daarvoor zijn KNMI-daggegevens (graaddagen per dag) nodig.
const HEATPUMP_HDD_FACTOR = {
  1: 1.38, 2: 1.21, 3: 1.10, 4: 0.77, 5: 0.44, 6: 0.17,
  7: 0.15, 8: 0.15, 9: 0.29, 10: 0.66, 11: 1.02, 12: 1.31,
};

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
// Vermindering energiebelasting (heffingskorting) — vaste jaarlijkse korting per
// elektriciteitsaansluiting. 2026: €628,96 incl. BTW (bron: Milieu Centraal / Belastingdienst).
// Geldt identiek voor béide contracten (één aansluiting) → comparison-neutraal, maar zonder
// deze post liggen de absolute jaartotalen ~€629 te hoog t.o.v. de echte jaarrekening.
const EB_REBATE_2026 = 628.96; // €/jaar incl. BTW

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
//
// HERIJKT (v=23): de oude profielen maakten de lente/zomer-middag te diep negatief,
// waardoor de export-gewogen "capture price" van zonnestroom ≈ €0,00/kWh werd. Empirisch
// (NL 2024-2025 kwartierdata) is teruggeleverde zonnestroom ~52% van het jaargemiddelde
// waard. Deze set is geijkt op: vlak jaargemiddelde €0,091, solar-capture €0,048 (53%),
// verbruik-gewogen €0,109, ~3% negatieve uren — gevalideerd via _validate/tune_profiles.js.
// NB: dit is de NOODOPLOSSING; met live/gekalibreerde EPEX-data (buildCalibratedProfile)
// worden deze waarden overschreven door echte marktprijzen.
const EPEX_PROFILES = {
  // Dec · Jan · Feb — hoge nachten/avonden, koude pieken, weinig zon → zelden negatief
  winter: {
    0: 0.07, 1: 0.06, 2: 0.06, 3: 0.06, 4: 0.06, 5: 0.07,
    6: 0.10, 7: 0.13, 8: 0.14, 9: 0.12, 10: 0.10, 11: 0.09,
    12: 0.09, 13: 0.09, 14: 0.10, 15: 0.11, 16: 0.13, 17: 0.16,
    18: 0.15, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.08, 23: 0.07
  },
  // Mrt · Apr · Mei — zon drukt de middag, ondiep negatief rond zon-noon
  spring: {
    0: 0.05, 1: 0.04, 2: 0.04, 3: 0.04, 4: 0.04, 5: 0.05,
    6: 0.07, 7: 0.09, 8: 0.09, 9: 0.07, 10: 0.06, 11: 0.05,
    12: 0.01, 13: -0.01, 14: 0.04, 15: 0.07, 16: 0.08, 17: 0.10,
    18: 0.12, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.07, 23: 0.06
  },
  // Jun · Jul · Aug — diepste zon-kannibalisatie, goedkope nachten
  summer: {
    0: 0.03, 1: 0.02, 2: 0.02, 3: 0.02, 4: 0.02, 5: 0.04,
    6: 0.06, 7: 0.07, 8: 0.07, 9: 0.06, 10: 0.06, 11: 0.04,
    12: -0.01, 13: -0.02, 14: 0.03, 15: 0.06, 16: 0.07, 17: 0.09,
    18: 0.11, 19: 0.12, 20: 0.11, 21: 0.09, 22: 0.07, 23: 0.05
  },
  // Sep · Okt · Nov — mix, loopt op richting winter
  autumn: {
    0: 0.06, 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.06,
    6: 0.08, 7: 0.11, 8: 0.13, 9: 0.10, 10: 0.07, 11: 0.06,
    12: 0.05, 13: 0.04, 14: 0.05, 15: 0.08, 16: 0.12, 17: 0.15,
    18: 0.15, 19: 0.13, 20: 0.11, 21: 0.09, 22: 0.08, 23: 0.07
  }
};

// Seizoen-helper (gedeeld door getFallbackSpot + buildCalibratedProfile).
function seasonOf(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// ── Zelf-kalibrerende fallback ──────────────────────────────────────────────
// Wanneer er echte EPEX-historie is opgehaald (epexHistory), leiden we hieruit een
// (seizoen × uur)-prijsprofiel af en gebruiken dat om de geprojecteerde/synthetische
// uren te vullen — verankerd aan de eigen regio/periode i.p.v. de generieke profielen.
let calibratedProfile = null;   // { winter:{0..23}, ... } in €/kWh incl. BTW, of null
let calibrationMeta = { buckets: 0, samples: 0 };
const CALIB_MIN_SAMPLES = 3;    // minimaal aantal echte prijzen per (seizoen,uur)-emmer

function buildCalibratedProfile() {
  calibratedProfile = null;
  calibrationMeta = { buckets: 0, samples: 0 };
  if (epexHistory.size < 24) return;   // te weinig historie om op te kalibreren

  const acc = {};  // seizoen → uur → { sum, n }
  for (const [key, price] of epexHistory.entries()) {
    const m = parseInt(key.slice(5, 7), 10);   // key = "YYYY-MM-DDTHH"
    const h = parseInt(key.slice(11, 13), 10);
    if (!Number.isFinite(m) || !Number.isFinite(h)) continue;
    const s = seasonOf(m);
    (acc[s] ||= {});
    (acc[s][h] ||= { sum: 0, n: 0 });
    acc[s][h].sum += price; acc[s][h].n++;
  }

  const prof = {};
  let buckets = 0;
  for (const s of Object.keys(acc)) {
    for (const h of Object.keys(acc[s])) {
      const b = acc[s][h];
      if (b.n >= CALIB_MIN_SAMPLES) { (prof[s] ||= {})[h] = b.sum / b.n; buckets++; }
    }
  }
  if (buckets > 0) {
    calibratedProfile = prof;
    calibrationMeta = { buckets, samples: epexHistory.size };
  }
}

/**
 * Geeft de fallback EPEX-spotprijs voor een specifieke maand + uur.
 * Retourneert de ruwe beursprijs × 1.21 (BTW) voor positieve uren;
 * negatieve uren worden niet met BTW verhoogd (leverancier vergoedt de negatieve prijs 1-op-1).
 * @param {number} month  1–12
 * @param {number} hour   0–23
 * @returns {number} spot in €/kWh, incl. BTW, excl. EB en opslag
 */
function getFallbackSpot(month, hour) {
  const season = seasonOf(month);
  // Voorkeur: gekalibreerd op eigen EPEX-historie (al incl. BTW → geen extra ×1.21).
  const cal = calibratedProfile?.[season]?.[hour];
  if (cal != null) return cal;
  // Anders: generiek seizoensprofiel (ruwe beurs → ×1.21 op positieve uren).
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

// Klap een config-kaart in/uit (aangeroepen vanuit de klikbare kaart-titel).
function toggleCard(titleEl) {
  const card = titleEl.closest(".glass-panel");
  if (card) card.classList.toggle("collapsed");
}

// Progressive Disclosure: view mode toggle
function setViewMode(mode) {
  const body = document.body;
  const btnSimple = document.getElementById("btn-view-simple");
  const btnAdvanced = document.getElementById("btn-view-advanced");
  
  if (mode === "simple") {
    if (body && body.classList) {
      body.classList.add("mode-simple");
      body.classList.remove("mode-advanced");
    }
    if (btnSimple) btnSimple.classList.add("active");
    if (btnAdvanced) btnAdvanced.classList.remove("active");
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("view_mode", "simple");
    }
  } else {
    if (body && body.classList) {
      body.classList.add("mode-advanced");
      body.classList.remove("mode-simple");
    }
    if (btnSimple) btnSimple.classList.remove("active");
    if (btnAdvanced) btnAdvanced.classList.add("active");
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("view_mode", "advanced");
    }
  }
  
  // Alleen simulatie herberekenen als er al data geladen is
  if (typeof energyData !== "undefined" && energyData.length > 0) {
    runSimulation();
  }
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  restoreHACredentials();
  
  // View mode initialiseren
  const savedMode = (typeof localStorage !== "undefined" && localStorage.getItem("view_mode")) || "simple";
  setViewMode(savedMode);
  
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
  document.getElementById("bat-mode")?.addEventListener("change", runSimulation);
  document.getElementById("bat-mode")?.addEventListener("change", updateBatModeHint);
  updateBatModeHint();
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
  // Alleen sluiten bij klik op de achtergrond zelf — niet op klikken bínnen de modal
  // (anders sloten de "Optie A/B"-tabknoppen de gids via event-bubbling).
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSetupModal();
  });

  // Uitleg-modal (accu/warmtepomp/EV rekenmodel)
  document.getElementById("explain-close")?.addEventListener("click", closeHardwareExplainer);
  document.getElementById("explain-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeHardwareExplainer();
  });

  // Wegklik-knoppen voor uitleg/waarschuwingen activeren
  initDismissHandlers();
}

// Restore saved HA credentials from localStorage
function restoreHACredentials() {
  const savedUrl = localStorage.getItem("ha_url");
  const savedToken = localStorage.getItem("ha_token");
  if (savedUrl) document.getElementById("ha-url").value = savedUrl;
  if (savedToken) document.getElementById("ha-token").value = savedToken;
}

// Load Personalized HA Demo Data
// Compacte demo-arrays (window.DEMO_PROFILE uit demo-year.js) → uurrecords met
// een schoon, niet-schrikkel referentiejaar (geen DST-gaten/dubbele uren).
function expandDemoProfile(p) {
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const p2 = n => (n < 10 ? "0" : "") + n;
  const rows = [];
  let i = 0;
  for (let m = 1; m <= 12 && i < p.hours; m++)
    for (let day = 1; day <= DAYS[m - 1] && i < p.hours; day++)
      for (let h = 0; h < 24 && i < p.hours; h++, i++)
        rows.push({
          timestamp: `${p.startYear}-${p2(m)}-${p2(day)}T${p2(h)}:00:00`,
          import_t1: p.imp[i], import_t2: 0,
          export_t1: p.exp[i], export_t2: 0,
          solar_yield: p.sol[i],
        });
  return rows;
}

async function loadDemoData() {
  try {
    // Voorkeur: gebundeld realistisch jaarprofiel (OPSD residential4, NL-geschaald).
    if (window.DEMO_PROFILE && Array.isArray(window.DEMO_PROFILE.imp)) {
      energyData = expandDemoProfile(window.DEMO_PROFILE);
      isDemoData = true;
      document.getElementById("data-status").textContent =
        `Voorbeelddata geladen — realistisch jaarprofiel (${Math.round(energyData.length / 24)} dagen) · koppel jouw HA voor je eigen data`;
      runSimulation();
      return;
    }
    // Fallback: lokaal p1_sample.json (eigen data, niet meegeleverd in de repo).
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

// ── "Hoe werkt het rekenmodel?"-uitleg per apparaat ──────────────────────────
// Beschrijft exact wat _simulateCore() per uur doet, in mensentaal. Voor de accu
// worden alle drie de modi uitgelegd; de actieve modus wordt gemarkeerd.
function hardwareExplainerContent(kind) {
  const watervalBlock = `
    <div class="explain-block" style="border-left-color: var(--accent-yellow);">
      <h4>🌊 De Zonne-waterval (Volgorde van stroomverdeling)</h4>
      <p>Opgewekte zonnestroom stroomt in deze vaste prioriteitsvolgorde door je woning:</p>
      <ol style="margin-left: 1.2rem; padding: 0; line-height: 1.6;">
        <li><strong>Huisverbruik:</strong> Eerst worden je actieve apparaten in huis gevoed.</li>
        <li><strong>Elektrische auto (EV):</strong> Wat over is gaat naar de EV (indien zonne-laden actief is en de auto is gekoppeld).</li>
        <li><strong>Thuisaccu:</strong> Wat daarna nog overblijft laadt de thuisaccu op.</li>
        <li><strong>Elektriciteitsnet:</strong> Pas als alles verzadigd is, gaat het restant naar het net (en wordt op dat moment eventueel gedimd bij negatieve prijzen).</li>
      </ol>
    </div>
  `;

  if (kind === "battery") {
    const activeMode = document.getElementById("bat-mode")?.value || "zelf";
    const tag = (m) => activeMode === m ? ` <span style="color:var(--accent-green);font-size:0.75rem;">(nu actief)</span>` : "";
    return {
      title: "🔋 Hoe werkt het thuisbatterij-model?",
      body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De accu wordt <strong>per uur</strong> doorgerekend, en apart voor het dynamische en het vaste
          contract (twee gescheiden laadtoestanden). Belangrijk: <strong>de accu hoeft nooit vol</strong> —
          hij laadt alléén zoveel als economisch zin heeft. Op een rustige dag blijft hij deels leeg.
          Bij opslaan en ontladen gaat een deel verloren (round-trip-rendement, bv. 90% → 10% verlies).
        </p>
        ${watervalBlock}
        <div class="explain-block">
          <h4>🔋 Maximaal zelfverbruik (standaard)${tag("zelf")}</h4>
          <ul>
            <li><strong>Opslaan:</strong> zonne-overschot dat je anders zou exporteren gaat in de accu —
              maar niet méér dan je die dag zelf nog kunt verbruiken. De rest wordt gewoon geëxporteerd
              (geen onnodig opslaan dat toch niet ontladen wordt).</li>
            <li><strong>Ontladen:</strong> zodra je stroom van het net zou halen. Dat bespaart altijd de
              volle all-in prijs (inclusief energiebelasting), dus zelfverbruik is altijd lonend.</li>
            <li>Geen handel met het net.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">laden:   alleen zon, tot opslag = min(accu_capaciteit, dag-import)
ontladen: dekt eigen import (bespaart all-in)</code>
        </div>
        <div class="explain-block">
          <h4>💡 Kostenbewust${tag("kosten")}</h4>
          <ul>
            <li>Als zelfverbruik, plus: in de <strong>goedkoopste uren van de dag</strong> laadt de accu
              bij van het net — maar <strong>alléén het stukje dat de zon niet dekt</strong> en dat je
              later zelf verbruikt.</li>
            <li>Zo voorkom je dat je stroom inkoopt die de zon toch levert: over élke ingekochte kWh
              betaal je namelijk energiebelasting, die je alleen terugverdient als die kWh later
              net-import verdringt.</li>
            <li>Laden gebeurt alleen als de dure uren (× rendement) duurder zijn dan de goedkope laaduren.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ net-laden als: dure_all_in_prijs × rendements_factor > goedkope_all_in_prijs
  laad_budget = max(0, maximale_eigen_behoefte − zonne_overschot × rendements_factor) / rendements_factor</code>
        </div>
        <div class="explain-block">
          <h4>📈 Maximale winst${tag("winst")}</h4>
          <ul>
            <li>Als kostenbewust, plus: in de duurste uren <strong>verkoopt de accu het overschot terug aan het net</strong>.</li>
            <li>Dit gebeurt alleen als de opbrengst — de <strong>kale spotprijs</strong> (zónder BTW en
              zónder energiebelasting) — na rendementsverlies hoger is dan wat het laden kostte, én alléén
              voor energie bóven je eigen-verbruik-voorraad.</li>
            <li>Onder het 2027-model betaal je energiebelasting over élke ingekochte kWh, maar krijg je die
              níét terug bij verkoop. <strong>Daardoor komt deze modus op normale prijzen vrijwel altijd
              gelijk uit met "Kostenbewust"</strong> — zelfverbruik (bespaart all-in incl. EB) is bijna
              altijd waardevoller dan teruglevering (kale spot). Echt voordeel ontstaat pas bij flinke
              prijspieken én vrije accu-capaciteit.</li>
          </ul>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.5rem;white-space:pre-wrap;">+ verkoop als: kale_beursprijs / 1.21 > (goedkope_all_in_prijs / rendements_factor) × 1.21
  export = max(0, opgeslagen_stroom − maximale_eigen_behoefte)</code>
        </div>
        <p class="explain-note">
          ⓘ De knop "Bereken Ideale Accu Formaat" veegt verschillende groottes door met de gekozen modus en
          toont de terugverdientijd (bij €450/kWh) — zo zie je dat een grotere accu niet automatisch beter is.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>1. Rendement bij laden en ontladen:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Bij het opslaan van stroom treedt energieverlies op. Bij een rendement van bijvoorbeeld 90% (rendementsfactor 0.90) wordt 10% omgezet in warmte:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nieuwe_opgeslagen_stroom = oude_opgeslagen_stroom + (ingeladen_stroom × rendements_factor)
geleverde_stroom = ontladen_stroom  (ontladen gaat zonder extra verlies)</code>

            <p><strong>2. Slimme opslaglimiet (voorkomt onnodig hamsteren):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De accu laadt per dag nooit meer op dan je die dag daadwerkelijk zelf nodig hebt. Dit voorkomt dat een hele grote accu onnodig stroom vasthoudt die je toch niet verbruikt:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">maximale_eigen_behoefte = de kleinste waarde van (accu_capaciteit OF totale_dag_import)
opslag_limiet = maximale_eigen_behoefte  (plus eventueel verkoopruimte in de winst-modus)</code>

            <p><strong>3. Consumentenprijs (All-in importprijs):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              De all-in prijs die je betaalt per kWh stroom van het net. Dit is wat je bespaart als je stroom uit de accu gebruikt:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">all_in_prijs = kale_beursprijs + (inkoop_opslag × 1.21) + energie_belasting</code>

            <p><strong>4. Laden vanaf het net (wanneer loont dit?):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Laden vanaf het net in goedkope uren is alleen rendabel als de all-in prijs tijdens de dure uren (vermenigvuldigd met het rendement) hoger is dan de all-in prijs tijdens de goedkope uren:
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">dure_all_in_prijs × rendements_factor  >  goedkope_all_in_prijs</code>

            <p><strong>5. Hoeveel laden vanaf het net (Net-laad-budget):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              We berekenen precies hoeveel stroom er van het net geladen moet worden, rekening houdend met de verwachte zonne-energie van die dag (om te voorkomen dat we belasting betalen over stroom die we ook gratis van de zon hadden kunnen krijgen):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">net_laad_budget = maximale_waarde van (0 OF maximale_eigen_behoefte − zonne_overschot × rendements_factor) / rendements_factor</code>

            <p><strong>6. Teruglevering loont (alleen in de winst-modus):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Terugleveren loont alleen als de ontvangen vergoeding (de kale spotprijs zonder BTW) hoger is dan de all-in inkoopprijs gedeeld door het rendement (rekening houdend met de BTW die je niet terugkrijgt):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">kale_beursprijs / 1.21  >  (goedkope_all_in_prijs / rendements_factor) × 1.21
export_stroom = maximale_waarde van (0 OF opgeslagen_stroom − maximale_eigen_behoefte)</code>
          </div>
        </details>`,
    };
  }
  if (kind === "heatpump") {
    return {
      title: "♨️ Hoe werkt het warmtepomp-model?",
      body: `
        <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
          De warmtepomp voegt een <strong>elektrische stooklast</strong> toe (de schuif = gemiddeld
          wintervermogen in kW). Die last wordt per uur opgeteld bij je import (of trekt eerst van je
          zon-overschot af) en telt mee in <strong>beide</strong> contracten.
        </p>
        <div class="explain-block">
          <h4>Seizoensvorm via graaddagen</h4>
          <ul>
            <li>De jaarverdeling volgt het Nederlandse klimaat (graaddagen, basis 18&deg;C, De Bilt-normaal):
              piek in dec/jan, geleidelijk aflopend naar het voorjaar, met een kleine zomer-vloer voor
              warmtapwater.</li>
            <li>Per uur: <em>last = winter-stooklast × maandfactor × dag/nacht-factor</em>.</li>
            <li>Dag/nacht: 's nachts ~1,2× (kouder + setback-herstel), overdag ~0,9×.</li>
          </ul>
        </div>
        <p class="explain-note">
          ⓘ Beperking: de maandfactor is vlak per maand — hij lijnt nog niet per dag uit met echte
          koudegolven/EPEX-prijspieken. In een strenge koudegolf is warmtepomp-op-dynamisch dus iets
          optimistisch ingeschat.
        </p>
        <details class="explain-formula">
          <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
          <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
            <p><strong>Stooklast per uur:</strong></p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">stooklast = winter_stooklast × maandfactor_verwarmingsbehoefte × dag_nacht_factor</code>
            
            <p><strong>Dag/nacht factor:</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              In de nacht staat de warmtepomp vaak iets harder te werken (door lagere buitentemperatuur of opstarten in de vroege ochtend):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">nacht (tussen 22:00 en 07:00 uur) = 1.2
overdag (tussen 07:00 en 22:00 uur) = 0.9</code>
            
            <p><strong>Maandfactoren voor de verwarmingsbehoefte (op basis van graaddagen):</strong></p>
            <p style="margin-left: 0.5rem; color: var(--text-muted); padding-bottom: 0.2rem;">
              Deze factoren bepalen hoe de warmtevraag over het jaar is verdeeld (hoog in de winter, laag in de zomer):
            </p>
            <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jan: 1.38  ·  feb: 1.21  ·  mrt: 1.10  ·  apr: 0.77
mei: 0.44  ·  jun: 0.17  ·  jul: 0.15  ·  aug: 0.15
sep: 0.29  ·  okt: 0.66  ·  nov: 1.02  ·  dec: 1.31</code>
          </div>
        </details>`,
    };
  }
  // EV
  return {
    title: "🚗 Hoe werkt het EV-model?",
    body: `
      <p style="font-size:0.86rem;color:var(--text-muted);line-height:1.7;">
        Uit <strong>wekelijkse afstand × verbruik per 100 km</strong> volgt de jaarlijkse laadvraag.
        Die wordt slim over de uren verdeeld — apart gepland voor het dynamische en het vaste contract.
      </p>
      ${watervalBlock}
      <div class="explain-block">
        <h4>Slim laden (look-ahead per dag)</h4>
        <ul>
          <li>Eerst <strong>gratis zonne-overschot</strong> (overdag, ~10–16u), als zonne-laden aanstaat.</li>
          <li>Daarna het restant in de <strong>goedkoopste resterende uren</strong> (dynamisch) resp. de
            <strong>daluren</strong> (vast contract).</li>
        </ul>
      </div>
      <div class="explain-block">
        <h4>Wanneer staat de auto ingeplugd?</h4>
        <ul>
          <li><strong>Altijd thuis:</strong> laden mag overdag én 's nachts.</li>
          <li><strong>Kantoortijden:</strong> ma–vr 08:00–17:00 is de auto weg — dan vervalt zonne-laden op
            werkdagen en wordt vooral 's avonds/nachts geladen.</li>
          <li>Zonne-laden uit = de hele laadvraag komt volgens het schema van het net.</li>
        </ul>
      </div>
      <details class="explain-formula">
        <summary>De wiskunde uitgelegd (voor de liefhebber)</summary>
        <div class="formula-body" style="font-size:0.8rem;line-height:1.6;">
          <p><strong>Benodigde laadstroom:</strong></p>
          <code style="display:block;font-family:monospace;font-size:0.76rem;color:var(--accent-green);background:#000;border-radius:6px;padding:0.4rem 0.6rem;margin:0.3rem 0.5rem 0.8rem;white-space:pre-wrap;">jaarlijkse_laadvraag = (wekelijkse_afstand × verbruik_per_100km / 100) × 52 weken
gemiddelde_dagvraag  = (wekelijkse_afstand × verbruik_per_100km / 100) / 7 dagen</code>
          
          <p><strong>Verdeling van de laadstroom per dag (begrensd op ${EV_MAX_CHARGE_KW} kW per uur):</strong></p>
          <ol style="margin-left: 1.2rem; padding: 0; color: var(--text-muted); line-height: 1.6;">
            <li>Eerst vullen met het gratis <strong>zonne-overschot</strong> (meestal tussen 10:00 en 16:00 uur).</li>
            <li>Als er nog meer stroom nodig is: de rest inplannen tijdens de <strong>goedkoopste uren van de dag</strong> (dynamisch contract) of tijdens de <strong>daluren</strong> (vast contract).</li>
          </ol>
          <p style="margin-top: 0.5rem; color: var(--text-muted);">
            Bij de instelling "Kantoortijden" kan de auto op werkdagen (maandag t/m vrijdag) tussen 08:00 en 17:00 uur niet laden omdat de auto dan weg is.
          </p>
        </div>
      </details>`,
  };
}

function showHardwareExplainer(kind) {
  const { title, body } = hardwareExplainerContent(kind);
  document.getElementById("explain-title").innerHTML = title;
  document.getElementById("explain-body").innerHTML = body;
  document.getElementById("explain-backdrop").style.display = "flex";
}

function closeHardwareExplainer() {
  document.getElementById("explain-backdrop").style.display = "none";
}

// Korte inline-hint onder de accu-modus-dropdown (zonder de uitleg-modal te openen).
function updateBatModeHint() {
  const el = document.getElementById("bat-mode-hint");
  if (!el) return;
  const mode = document.getElementById("bat-mode")?.value || "zelf";
  const hints = {
    zelf: `Alléén zon opslaan en ontladen voor eigen verbruik — robuust en voorspelbaar.`,
    kosten: `Laadt óók goedkoop van het net, maar alleen voor eigen verbruik (geen teruglevering).`,
    winst: `⚠️ Onder bruto-EB (2027) levert teruglevering minder op dan zelfverbruik, dus op normale prijzen komt dit vrijwel gelijk uit met "Kostenbewust". Echt voordeel pas bij flinke prijspieken.`,
  };
  el.innerHTML = hints[mode] || "";
  el.style.display = el.innerHTML ? "block" : "none";
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
  autoFetchEpex();        // best-effort: echte EPEX-prijzen ophalen + herberekenen
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
    const whSensors = allStates
      .filter(s => s.attributes?.unit_of_measurement === "Wh")
      .map(s => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "Wh", unavailable };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // kW-sensoren: live vermogen (warmtepomp, laadpaal, batterij)
    const kwSensors = allStates
      .filter(s => s.attributes?.unit_of_measurement === "kW")
      .map(s => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "kW", unavailable };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // W-sensoren: live vermogen (warmtepomp, laadpaal, batterij)
    const wSensors = allStates
      .filter(s => s.attributes?.unit_of_measurement === "W")
      .map(s => {
        const unavailable = s.state === "unavailable" || s.state === "unknown";
        return { id: s.entity_id, unit: "W", unavailable };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (kwhSensors.length === 0) {
      statusEl.textContent = "Geen kWh sensoren gevonden in deze HA.";
      statusEl.style.color = "var(--accent-orange)";
      return;
    }

    // Auto-detect best candidates per P1 role
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

    // Sla alle eenheden op
    const allAvailableSensors = [...kwhSensors, ...whSensors, ...kwSensors, ...wSensors];
    const sensorUnitMap = {};
    allAvailableSensors.forEach(s => { sensorUnitMap[s.id] = s.unit; });
    window._solarSensorUnitMap = sensorUnitMap;  // globale lookup
    window._haSensorUnitMap = sensorUnitMap;

    // Helper voor slim gecategoriseerd dropdowns invullen
    const fillCategorizedSelect = (id, savedVal, patterns, defaultLabel) => {
      const sel = document.getElementById(id);
      if (!sel) return;

      const selectedId = savedVal || (allAvailableSensors.find(s => patterns.some(p => s.id.toLowerCase().includes(p))) || {}).id || "";

      // Verdeel in aanbevolen (matches pattern) en overige
      const rec = [];
      const other = [];
      allAvailableSensors.forEach(s => {
        const isRec = patterns.some(p => s.id.toLowerCase().includes(p));
        if (isRec) rec.push(s);
        else other.push(s);
      });

      const opt = (s) => {
        const isLive = s.unit === "kW" || s.unit === "W";
        const label = isLive 
          ? `${s.id} [${s.unit} - live vermogen fallback]` 
          : (s.unit === "Wh" ? `${s.id} [Wh → kWh]` : s.id);
        return `<option value="${s.id}" data-unit="${s.unit}"${s.id === selectedId ? " selected" : ""}>${label}${s.unavailable ? " ⚠ offline" : ""}</option>`;
      };

      const groupOpts = (arr) => {
        const kwh = arr.filter(s => s.unit === "kWh");
        const wh = arr.filter(s => s.unit === "Wh");
        const kw = arr.filter(s => s.unit === "kW");
        const w = arr.filter(s => s.unit === "W");

        let html = "";
        if (kwh.length) html += `<optgroup label="kWh sensoren">` + kwh.map(opt).join("") + `</optgroup>`;
        if (wh.length) html += `<optgroup label="Wh sensoren (omvormers/laders)">` + wh.map(opt).join("") + `</optgroup>`;
        if (kw.length) html += `<optgroup label="kW sensoren (live vermogen fallback)">` + kw.map(opt).join("") + `</optgroup>`;
        if (w.length) html += `<optgroup label="W sensoren (live vermogen fallback)">` + w.map(opt).join("") + `</optgroup>`;
        return html;
      };

      sel.innerHTML =
        `<option value="">${defaultLabel}</option>` +
        (rec.length ? `<optgroup label="⭐ Aanbevolen (op basis van naam)">` + rec.map(opt).join("") + `</optgroup>` : "") +
        (other.length ? groupOpts(other) : "");
    };

    // Invullen van select boxes
    fillCategorizedSelect("sel-solar", savedSensors.solar, 
      ["solar", "yield", "opwek", "pv_energy", "inverter", "omvormer", "production", "lifetime_energy", "zonnepaneel"],
      "— Niet koppelen (export-gebaseerde schatting) —");

    fillCategorizedSelect("sel-ev", savedSensors.ev, 
      ["ev", "wallbox", "charger", "laadpaal", "car_charg", "easee", "zaptec", "alfen", "tesla", "cocharger"],
      "— Niet koppelen —");

    fillCategorizedSelect("sel-hp", savedSensors.hp, 
      ["heat_pump", "warmtepomp", "heatpump", "hp_", "quatt", "daikin", "wp_", "elga"],
      "— Niet koppelen —");

    fillCategorizedSelect("sel-bat-in", savedSensors.batIn, 
      ["battery_charge", "battery_in", "accu_laden", "bat_charge", "charge_energy", "accu_in"],
      "— Niet koppelen —");

    fillCategorizedSelect("sel-bat-out", savedSensors.batOut, 
      ["battery_discharge", "battery_out", "accu_ontladen", "bat_discharge", "discharge_energy", "accu_uit"],
      "— Niet koppelen —");

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

  const evSensor = document.getElementById("sel-ev")?.value || "";
  const hpSensor = document.getElementById("sel-hp")?.value || "";
  const batInSensor = document.getElementById("sel-bat-in")?.value || "";
  const batOutSensor = document.getElementById("sel-bat-out")?.value || "";

  const unitOf = (entId) => (window._haSensorUnitMap?.[entId]) ||
    document.querySelector(`#sel-ev option[value="${CSS.escape(entId)}"]`)?.dataset?.unit ||
    (savedSensorsForUnit.ev === entId ? savedSensorsForUnit.evUnit : null) ||
    (savedSensorsForUnit.hp === entId ? savedSensorsForUnit.hpUnit : null) ||
    (savedSensorsForUnit.batIn === entId ? savedSensorsForUnit.batInUnit : null) ||
    (savedSensorsForUnit.batOut === entId ? savedSensorsForUnit.batOutUnit : null) ||
    "kWh";

  const evUnit = unitOf(evSensor);
  const hpUnit = unitOf(hpSensor);
  const batInUnit = unitOf(batInSensor);
  const batOutUnit = unitOf(batOutSensor);

  const entities = [
    document.getElementById("sel-imp1").value,
    document.getElementById("sel-imp2").value,
    document.getElementById("sel-exp1").value,
    document.getElementById("sel-exp2").value,
    solarSensor,
    evSensor,
    hpSensor,
    batInSensor,
    batOutSensor,
  ].filter(Boolean); // remove empty (not selected)

  const uniqueEntities = [...new Set(entities)];

  if (uniqueEntities.length === 0) {
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
    ev: evSensor,
    evUnit,
    hp: hpSensor,
    hpUnit,
    batIn: batInSensor,
    batInUnit,
    batOut: batOutSensor,
    batOutUnit,
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
    solarUnit,
    ev: evSensor,
    evUnit,
    hp: hpSensor,
    hpUnit,
    batIn: batInSensor,
    batInUnit,
    batOut: batOutSensor,
    batOutUnit,
  };

  try {
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    const stats = await fetchHAStatisticsWS(wsUrl, tokenInput, uniqueEntities, startTime, endTime, statusEl);

    _lastHAStats = stats;
    _lastRoleMap = roleMap;
    energyData = processHAStatistics(stats, roleMap, digitalTwinEnabled);
    isDemoData = false;   // echte HA-data: verdere uploads mergen erbij

    const untangle = energyData.untangle || { active: false };
    updateDigitalTwinBanner(untangle);

    statusEl.textContent = `✓ ${energyData.length} uurrecords geladen · EPEX prijzen ophalen…`;
    statusEl.style.color = "var(--accent-cyan)";

    // Fetch real EPEX prices for the loaded period in the background
    let successMsg = "";
    try {
      await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
      successMsg = `✓ ${energyData.length} uurrecords + ${epexHistory.size} echte EPEX-prijzen geladen (${days} dagen)`;
    } catch (_) {
      successMsg = `✓ ${energyData.length} uurrecords geladen (EPEX-prijzen niet beschikbaar)`;
    }

    if (untangle.batterySensorSuspect) {
      statusEl.innerHTML = `<strong>${successMsg}</strong><br>` +
        `<span style="color:var(--accent-orange);font-size:0.78rem;">⚠ Batterij-sensoren controleren: ontladen > laden over de hele periode is fysiek onmogelijk. ` +
        `Kies sensoren die beide aan de net-/AC-zijde meten (of verwissel in/uit).</span>`;
    } else {
      statusEl.textContent = successMsg;
      statusEl.style.color = "var(--accent-green)";
    }

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
          types: ["sum", "mean"]
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
function toggleDigitalTwin(enabled) {
  digitalTwinEnabled = enabled;
  if (!_lastHAStats || !_lastRoleMap) return;
  energyData = processHAStatistics(_lastHAStats, _lastRoleMap, digitalTwinEnabled);
  isDemoData = false;
  const untangle = energyData.untangle || { active: false };
  updateDigitalTwinBanner(untangle);
  fullYearStamp = "";   // invalideer cache zodat jaarprojectie opnieuw gebouwd wordt
  runSimulation();
}

function processHAStatistics(stats, roleMap, dtEnabled = true) {
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

  const records = [];
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1];
    const curr = timestamps[i];
    if (curr - prev > 2 * 3600 * 1000) continue; // skip gaps > 2h

    const delta = (ent, maxVal = 100) => {
      if (!ent) return 0;
      // 1. Probeer eerst cumulatieve sum (tellerstand)
      if (hourlySum[ent]) {
        const a = hourlySum[ent].get(prev) ?? null;
        const b = hourlySum[ent].get(curr) ?? null;
        if (a === null || b === null) return 0;
        const d = b - a;
        return (d > 0 && d < maxVal) ? d : 0;
      }
      // 2. Fallback: probeer mean (live vermogen in W/kW)
      if (hourlyMean[ent]) {
        const val = hourlyMean[ent].get(curr) ?? null;
        if (val === null) return 0;
        return (val > 0 && val < maxVal) ? val : 0;
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

function updateDigitalTwinBanner(meta) {
  const banner = document.getElementById("digital-twin-banner");
  if (!banner) return;
  // Toon de banner zodra apparaten gekoppeld zijn (ook als DT uitgeschakeld is).
  const hasDevices = meta && (meta.active || (meta.devices &&
    (meta.devices.ev || meta.devices.hp || meta.devices.battery)));
  window.digitalTwinMode = meta && meta.active ? meta : null;
  if (!hasDevices) { banner.style.display = "none"; return; }

  const names = [];
  if (meta.devices?.ev) names.push("elektrische auto");
  if (meta.devices?.hp) names.push("warmtepomp");
  if (meta.devices?.battery) names.push("thuisbatterij");
  const human = names.length === 1 ? names[0]
    : names.slice(0, -1).join(", ") + " en " + names.slice(-1);
  const devEl = document.getElementById("digital-twin-devices");
  if (devEl) devEl.textContent = human || "hardware";

  const on = digitalTwinEnabled;
  banner.style.border = `1px solid ${on ? "var(--accent-cyan)" : "var(--accent-orange)"}`;
  banner.style.background = on ? "rgba(56,189,248,0.08)" : "rgba(251,146,60,0.08)";

  const statusEl = document.getElementById("dt-status-label");
  if (statusEl) statusEl.textContent = on ? "actief" : "uitgeschakeld";
  statusEl && (statusEl.style.color = on ? "var(--accent-cyan)" : "var(--accent-orange)");

  const btn = document.getElementById("dt-toggle-btn");
  if (btn) {
    btn.textContent = on ? "Uitschakelen" : "Inschakelen";
    btn.style.borderColor = on ? "var(--accent-cyan)" : "var(--accent-orange)";
    btn.style.background = on ? "rgba(56,189,248,0.15)" : "rgba(251,146,60,0.15)";
    btn.style.color = on ? "var(--accent-cyan)" : "var(--accent-orange)";
  }

  const bodyEl = document.getElementById("dt-banner-body");
  if (bodyEl) {
    bodyEl.innerHTML = on
      ? `Je bestaande <span id="digital-twin-devices">${human || "hardware"}</span> is uit de historische baseline <strong>gestript</strong>. De schuiven hieronder modelleren nu <strong>vervangende</strong> hardware, geen toevoegingen.`
      : `Digital Twin is uitgeschakeld — ruwe meterstanden worden 1-op-1 gebruikt. De hardware-schuiven modelleren <strong>toevoegingen</strong> bovenop je bestaande situatie.`;
  }

  banner.style.display = "block";
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

// Best-effort: probeer ALTIJD echte EPEX-historie te laden voor de geladen periode.
// Stilletjes terugvallen op het (gekalibreerde of generieke) profiel als het mislukt
// (offline / CORS / periode buiten dekking). Herberekent na een geslaagde fetch.
async function autoFetchEpex() {
  if (energyData.length === 0) return;
  const before = epexHistory.size;
  try {
    await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
  } catch (err) {
    console.warn("autoFetchEpex: live EPEX niet beschikbaar, fallback actief —", err.message);
    return;
  }
  if (epexHistory.size > before) runSimulation();   // herbereken met echte prijzen
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
const HOUR_MS = 3600 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// DATA-KWALITEIT: importcheck, opschonen & gaten vullen
// ────────────────────────────────────────────────────────────────────────────
// Na elke import wordt energyData tot een GATENLOZE uurreeks gemaakt over de eigen
// meetperiode [eerste, laatste uur]. Anomalieën (negatief/absurd) eruit; kleine
// gaten (≤ GAP_SMALL_MAX_HOURS) lineair geïnterpoleerd; langere ontbrekende
// periodes ingevuld met een "standaardprofiel" = mediaan dagverloop (seizoen×uur)
// uit de eigen data. dataQuality houdt de samenvatting bij voor de gebruiker.
// ════════════════════════════════════════════════════════════════════════════
const GAP_SMALL_MAX_HOURS = 6;   // ≤6u = interpoleren, >6u = standaardprofiel
let dataQuality = null;          // { expectedHours, realHours, interpHours, profileHours, completenessPct, largePeriods[], spanFrom, spanTo }
let dataQualityDismissed = false;
let _cleanedRef = null;          // referentie naar de laatst-opgeschoonde energyData-array (idempotentie)

function _rowTotals(r) {
  return {
    imp: (r.import_t1 || 0) + (r.import_t2 || 0),
    exp: (r.export_t1 || 0) + (r.export_t2 || 0),
    sol: r.solar_yield != null ? Number(r.solar_yield) : null,
  };
}

// Roept cleanAndFillEnergyData() aan zodra een nieuwe (nog niet opgeschoonde) array is geladen.
function ensureCleanData() {
  if (!energyData || energyData.length < 2) { dataQuality = null; return; }
  if (energyData === _cleanedRef) return;   // al opgeschoond
  cleanAndFillEnergyData();
  _cleanedRef = energyData;
}

function cleanAndFillEnergyData() {
  // 1. Dedup op uur (laatste meting wint) + sorteer
  const byHour = new Map();
  energyData.forEach(r => {
    const t = new Date(r.timestamp).getTime();
    if (isNaN(t)) return;
    byHour.set(Math.floor(t / HOUR_MS) * HOUR_MS, r);
  });
  const keys0 = [...byHour.keys()].sort((a, b) => a - b);
  if (keys0.length < 2) { dataQuality = null; return; }

  const first = keys0[0], last = keys0[keys0.length - 1];
  const expectedHours = Math.round((last - first) / HOUR_MS) + 1;

  // 2. Anomalie-schoonmaak + bouw mediaan-profiel (seizoen×uur, met uur-fallback)
  const shVals = {};   // "seizoen-uur" → {imp[],exp[],sol[]}
  const hVals = {};    // uur → idem (fallback als een seizoen ontbreekt)
  byHour.forEach((r, ms) => {
    const { imp, exp, sol } = _rowTotals(r);
    if (imp < 0 || exp < 0 || imp > 100 || exp > 100 || !isFinite(imp) || !isFinite(exp)) {
      byHour.delete(ms); return;            // absurde/kapotte meting → behandel als gat
    }
    const d = new Date(ms), h = d.getHours(), sh = `${seasonOf(d.getMonth() + 1)}-${h}`;
    (shVals[sh] ||= { imp: [], exp: [], sol: [] });
    (hVals[h] ||= { imp: [], exp: [], sol: [] });
    shVals[sh].imp.push(imp); shVals[sh].exp.push(exp);
    hVals[h].imp.push(imp); hVals[h].exp.push(exp);
    if (sol != null) { shVals[sh].sol.push(sol); hVals[h].sol.push(sol); }
  });
  const hasSolar = Object.values(hVals).some(v => v.sol.length > 0);
  const med = arr => (arr && arr.length ? _median(arr) : null);
  const profileFor = ms => {
    const d = new Date(ms), h = d.getHours(), sh = `${seasonOf(d.getMonth() + 1)}-${h}`;
    const pick = f => { let m = med(shVals[sh]?.[f]); if (m == null) m = med(hVals[h]?.[f]); return m == null ? 0 : m; };
    return { imp: pick("imp"), exp: pick("exp"), sol: hasSolar ? pick("sol") : null };
  };

  // 3. Detecteer gaten over het volledige uurrooster
  const realSet = new Set(byHour.keys());
  const realHours = realSet.size;
  const gaps = [];
  let run = null;
  for (let ms = first; ms <= last; ms += HOUR_MS) {
    if (realSet.has(ms)) { if (run) { gaps.push(run); run = null; } }
    else { if (!run) run = { startMs: ms, endMs: ms, hours: 0 }; run.endMs = ms; run.hours++; }
  }
  if (run) gaps.push(run);

  // 4. Vul gaten
  const mkRow = (ms, imp, exp, sol, fill) => ({
    timestamp: new Date(ms).toISOString(),
    import_t1: Math.max(0, imp), import_t2: 0,
    export_t1: Math.max(0, exp), export_t2: 0,
    solar_yield: sol, _fill: fill,
  });
  let interpHours = 0, profileHours = 0;
  const largePeriods = [];
  gaps.forEach(g => {
    const isLarge = g.hours > GAP_SMALL_MAX_HOURS;
    const beforeMs = g.startMs - HOUR_MS, afterMs = g.endMs + HOUR_MS;
    const before = byHour.get(beforeMs), after = byHour.get(afterMs);
    for (let ms = g.startMs; ms <= g.endMs; ms += HOUR_MS) {
      if (isLarge || !before || !after) {
        const p = profileFor(ms);
        byHour.set(ms, mkRow(ms, p.imp, p.exp, p.sol, isLarge ? "profile" : "interp"));
        isLarge ? profileHours++ : interpHours++;
      } else {
        const frac = (ms - beforeMs) / (afterMs - beforeMs);
        const b = _rowTotals(before), a = _rowTotals(after);
        const lerp = (x, y) => x + (y - x) * frac;
        const sol = (b.sol != null && a.sol != null) ? lerp(b.sol, a.sol) : (hasSolar ? profileFor(ms).sol : null);
        byHour.set(ms, mkRow(ms, lerp(b.imp, a.imp), lerp(b.exp, a.exp), sol, "interp"));
        interpHours++;
      }
    }
    if (isLarge) largePeriods.push({ from: new Date(g.startMs).toISOString(), to: new Date(g.endMs).toISOString(), hours: g.hours });
  });

  // 5. Terugschrijven als gatenloze, gesorteerde reeks
  energyData = [...byHour.keys()].sort((a, b) => a - b).map(ms => byHour.get(ms));

  dataQuality = {
    expectedHours, realHours, interpHours, profileHours,
    completenessPct: expectedHours > 0 ? Math.round(realHours / expectedHours * 100) : 100,
    largePeriods,
    spanFrom: new Date(first).toISOString(), spanTo: new Date(last).toISOString(),
  };
  dataQualityDismissed = false;   // nieuwe import → samenvatting weer tonen
}

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

  // Een compleet jaar telt 8760 uur maar spant van het eerste tot het laatste uur
  // slechts ~364,96 dagen — daarom óók op uren/dagen toetsen, niet enkel op spanwijdte.
  if (spanDays >= 365 || realHoursTot >= 8760 || realDays >= 365) {
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

  // ── 1. "Typische dag" uit de eigen data: GEMIDDELD bruto import/export per maand×uur
  //     (som/telling → energiebehoud bij jaartotalen). Een ongemeten maand leent het
  //     profiel van de gemeten maand met de meest vergelijkbare daglengte (dichtste
  //     SOLAR_MONTH_FACTOR) — bv. aug≈apr, nov≈feb, jun/jul≈mei. Vervangt de oude
  //     vlakke-basislast+piek-zon synthese (verbruik te laag, zon te hoog). ──
  const mhAcc = {}, shAcc = {}, hAcc = {};   // maand-uur / seizoen-uur / uur → accumulator
  const daysPerMonth = {};
  const add = (bucket, key, imp, exp, sol) => {
    const a = (bucket[key] ||= { imp: 0, exp: 0, sol: 0, solN: 0, n: 0 });
    a.imp += imp; a.exp += exp; a.n++;
    if (sol != null) { a.sol += sol; a.solN++; }
  };
  let hasSolar = false;
  energyData.forEach(r => {
    const { month, date, hour } = rowMeta(r);
    const t = _rowTotals(r);
    if (t.sol != null) hasSolar = true;
    (daysPerMonth[month] ||= new Set()).add(date);
    add(mhAcc, `${month}-${hour}`, t.imp, t.exp, t.sol);
    add(shAcc, `${seasonOf(month)}-${hour}`, t.imp, t.exp, t.sol);
    add(hAcc, `${hour}`, t.imp, t.exp, t.sol);
  });
  const MIN_PROFILE_DAYS = 5;   // een maand telt pas als 'gemeten' bij ≥5 dagen data
  const measuredMonths = Object.keys(daysPerMonth).map(Number).filter(m => daysPerMonth[m].size >= MIN_PROFILE_DAYS);

  // Bronmaand per kalendermaand: zichzelf (indien gemeten) of de gemeten maand met de
  // dichtstbijzijnde daglengte. Eénmalig vooraf bepaald.
  const sourceMonth = {};
  for (let m = 1; m <= 12; m++) {
    if (measuredMonths.includes(m)) { sourceMonth[m] = m; }
    else if (measuredMonths.length === 0) { sourceMonth[m] = null; }
    else sourceMonth[m] = measuredMonths.reduce((best, c) =>
      Math.abs(SOLAR_MONTH_FACTOR[c] - SOLAR_MONTH_FACTOR[m]) < Math.abs(SOLAR_MONTH_FACTOR[best] - SOLAR_MONTH_FACTOR[m]) ? c : best);
  }
  const mean = a => (a && a.n) ? { imp: a.imp / a.n, exp: a.exp / a.n, sol: a.solN ? a.sol / a.solN : 0 } : null;

  // Beste profiel voor (maand,uur): bronmaand → seizoen → uur → nul.
  const synthProfileFor = (month, hour) => {
    const src = sourceMonth[month];
    return (src != null && mean(mhAcc[`${src}-${hour}`]))
      || mean(shAcc[`${seasonOf(month)}-${hour}`])
      || mean(hAcc[`${hour}`])
      || { imp: 0, exp: 0, sol: 0 };
  };

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

        // Synthetische rij: gemiddelde "typische dag" van de bronmaand (gelijke daglengte).
        const p = synthProfileFor(month, hour);
        const mm = String(month).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        const hh = String(hour).padStart(2, "0");
        out.push({
          timestamp: `${year}-${mm}-${dd}T${hh}:00:00`,  // lokaal-naïef → getHours() klopt
          import_t1: Math.max(0, p.imp),
          import_t2: 0,
          export_t1: Math.max(0, p.exp),
          export_t2: 0,
          solar_yield: hasSolar ? p.sol : null,
          _synth: true,
        });
        synthHours++;
      }
    }
  }

  fullYearData = out;
  yearScale = 1.0;   // de projectie is al exact 8760u — geen extra normalisatie
  const synthPct = (realHours + synthHours) > 0 ? synthHours / (realHours + synthHours) : 0;
  dataMeta = { mode: "seasonal", synthesized: true, realDays, realHours, synthHours, synthPct, yearScale: 1 };
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
    batMode,
  } = cfg;

  // ── Accu-modus (v=38) ──
  //   "zelf"   = maximaal zelfverbruik: alléén zon opslaan ↔ eigen import dekken.
  //   "kosten" = kostenbewust: óók 's nachts van het net laden, maar uitsluitend om
  //              eigen verbruik te dekken (geen net-teruglevering).
  //   "winst"  = maximale winst: bovenstaande + bij hoge prijs aan het net verkopen.
  //   Back-compat: oude cfg's met batArbitrage/batGridExport mappen op deze modi.
  const mode = batMode || (batGridExport ? "winst" : (batArbitrage ? "kosten" : "zelf"));
  const gridCharge = mode === "kosten" || mode === "winst";   // van het net mogen laden
  const gridExport = mode === "winst";                        // aan het net mogen verkopen

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

  // ── Accu-arbitrage: per dag de goedkoopste laad- en duurste ontlaad-uren bepalen.
  //     Vervangt de starre vaste drempels (laden ≤€0,01, ontladen >€0,25), die in
  //     herfst/winter/lente bijna nooit triggeren. Vangt nu de échte dagspread
  //     (bv. goedkope nacht → dure avondpiek), gated op het round-trip-rendement.
  //     Day-ahead prijzen zijn de dag ervoor bekend → vooruitblik is realistisch. ──
  const batChargeHrs = {};       // dayKey → Set<uur> om van het net te laden (goedkoop)
  const batDischargeHrs = {};    // dayKey → Set<uur> om náár het net te ontladen (winst-modus)
  const batDayMinAllin = {};     // dayKey → loAllin voor de net-export rentabiliteitstoets
  const batGridBudget = {};      // dayKey → max. van-het-net in te kopen energie (drawn kWh)
  const batStoreCap = {};        // dayKey → max. totaal op te slaan energie (geleverd, in SoC-eenheden)
  const batSelfReserve = {};     // dayKey → SoC die we voor eigen verbruik bewaren (nooit exporteren)
  function precomputeBatterySchedule() {
    if (!hasBattery || batCapacity <= 0 || batPower <= 0) return;
    const K = Math.max(1, Math.min(10, Math.round(batCapacity / batPower)));   // ~uren om vol/leeg te zijn
    Object.keys(dayRows).forEach(dk => {
      const dayRowsArr = dayRows[dk];
      const loadDay = dayRowsArr.reduce((s, r) => s + r.import_t1 + r.import_t2, 0);
      const solarDay = dayRowsArr.reduce((s, r) => s + r.export_t1 + r.export_t2, 0);

      // ── Gedeelde dag-opslaglimiet (`batStoreCap`) — borgt monotonie ──
      //   Zon én net mogen samen nooit méér in de accu stoppen dan dit. Voor
      //   zelfverbruik is de bovengrens de verdringbare eigen import van die dag
      //   (min met de capaciteit): boven dat punt zou opgeslagen energie nooit
      //   ontladen worden (strandt → verliest export-omzet). Omdat de grens =
      //   min(capaciteit, dag-import), verandert er bóven capaciteit=dag-import
      //   niets meer → een grotere accu kan nooit duurder uitvallen.
      const selfNeed = Math.min(batCapacity, loadDay);
      batStoreCap[dk] = selfNeed;
      batSelfReserve[dk] = selfNeed;   // bij export: nooit onder de eigen-verbruik-voorraad zakken
      if (!gridCharge) return;     // zelf-modus: geen van-het-net-laadschema nodig

      const priced = dayRowsArr.map(r => {
        const { hour, month, epexKey: k } = rowMeta(r);
        let sp = epexHistory.has(k) ? epexHistory.get(k) : getFallbackSpot(month, hour);
        if (sp > 0 && stressMultiplier !== 1.0) sp *= stressMultiplier;
        return { hour, spot: sp, allin: sp + markupBtw + eb };
      });
      if (priced.length < 3) return;
      const asc = [...priced].sort((a, b) => a.allin - b.allin);
      const cheap = asc.slice(0, K), expensive = asc.slice(-K);
      const hiAllin = expensive[expensive.length - 1].allin;
      // Zelfconsumptie-arbitrage: van het net laden loont als de duurste import die je
      // ermee verdringt (all-in, incl. EB) × rendement > de laad-all-in. EB valt weg
      // (je betaalt 'm bij laden, bespaart 'm bij de verdrongen import) op het rendement na.
      const chargeHrs = cheap.filter(c => hiAllin * batEfficiency > c.allin);
      if (chargeHrs.length === 0) return;     // geen rendabele spread vandaag
      const loAllin = chargeHrs[0].allin;
      batChargeHrs[dk] = new Set(chargeHrs.map(c => c.hour));
      batDayMinAllin[dk] = loAllin;

      // ── Net-laad-budget: vermijd de bruto-EB-val ──
      //   De zon vult de verdringbare behoefte (selfNeed) als eerste; alléén het restant
      //   is het van-het-net laden waard. Zonder deze rem koopt de accu stroom in die de
      //   zon toch al levert → bruto-import (en EB) blazen op zonder iets te verdringen.
      const fromSolar = Math.min(solarDay * batEfficiency, selfNeed);    // de zon dekt dit deel
      let drawnBudget = Math.max(0, selfNeed - fromSolar) / batEfficiency; // in te kopen kWh voor zelfverbruik

      if (gridExport) {
        // Maximale winst: óók aan het net verkopen. Een verkochte kWh levert kale spot
        // (spot/1.21, géén EB) op, geen all-in — dus toets de export-uren tegen díe waarde.
        const expHrs = expensive.filter(e => (e.spot / 1.21) * batEfficiency > loAllin);
        // Ruimte om voor de winstgevende export-uren te laden — exact wat die uren kunnen
        // ontladen (vermogen × #uren), begrensd door de capaciteit bóven de zelf-voorraad.
        // Alléén als er zúlke vrije ruimte is verkopen we: anders is de capaciteit volledig
        // voor eigen verbruik nodig (dat levert all-in incl. EB op > kale-spot export) →
        // winst gedraagt zich dan exact als kosten, en kan dus nooit slechter uitvallen.
        const exportRoom = Math.min(expHrs.length * batPower, Math.max(0, batCapacity - selfNeed));
        if (exportRoom > 0) {
          batDischargeHrs[dk] = new Set(expHrs.map(e => e.hour));
          batStoreCap[dk] = selfNeed + exportRoom;     // extra ruimte bovenop de zelf-voorraad
          drawnBudget += exportRoom / batEfficiency;
        } else {
          batDischargeHrs[dk] = new Set();             // geen vrije ruimte → geen net-export
        }
      } else {
        batDischargeHrs[dk] = new Set();               // zelf/kosten: nooit aan het net verkopen
      }
      batGridBudget[dk] = drawnBudget;
    });
  }
  precomputeBatterySchedule();

  // Accumulatoren
  let fxPeakImp = 0, fxDalImp = 0, fxPeakExp = 0, fxDalExp = 0;
  let dynImpCost = 0, dynExpRev = 0, dynImpKwh = 0, dynExpKwh = 0;
  let batSoC = 0, batSoCFx = 0;
  let epexReal = 0, epexFall = 0;
  const batGridDrawn = {};    // dayKey → reeds van het net ingekochte kWh (drawn, budgetbewaking)

  // Profiel-arrays (wanneer full=true)
  const hourly = full ? Array.from({ length: 24 }, () => ({
    imports: [], exports: [], spots: [], dynCosts: [], fixedCosts: [],
    solar: [], ev: [], hp: [], batCharge: [], batDischarge: []
  })) : null;
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

    let batChargeVal = 0;
    let batDischargeVal = 0;

    if (full) {
      hourly[hour].spots.push(spot);
    }

    // Thermische stooklast (Warmtepomp)
    let hpLoad = 0;
    if (hasHeatPump) {
      const sf = HEATPUMP_HDD_FACTOR[month] || 0.15;   // seizoensvorm via klimaat-graaddagen
      const tf = (hour >= 22 || hour < 7) ? 1.2 : 0.9;  // 's nachts kouder/setback-herstel
      hpLoad = hpWinterBaseload * sf * tf;
    }

    // ── STRATEGIE SPLIT: DYNAMISCH VS VAST APPARAATGEDRAG ──
    // Warmtepomp consumeert éérst lokaal zonoverschot (net als de EV's solar-match),
    // pas het tekort komt van het net. Anders zou een uur met zon-overschot tegelijk
    // import (WP) én export (zon) tonen → overschat bruto import + export + EB.
    const hpFromSolar = Math.min(hpLoad, rawExp);   // rawExp = gemeten zon-overschot
    const hpFromGrid = hpLoad - hpFromSolar;
    let impDyn = rawImp + hpFromGrid;
    let expDyn = rawExp - hpFromSolar;
    let impFx = rawImp + hpFromGrid;
    let expFx = rawExp - hpFromSolar;

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
      const isChargeHour = gridCharge && batChargeHrs[dayKey]?.has(hour);
      let currentPowerLimit = batPower;

      // Dag-opslaglimiet op de SoC zelf: laad nooit verder dan de dag-behoefte (`batStoreCap`
      // = min(capaciteit, dag-import), of + export-ruimte in winst). Hierdoor "hoardt" de accu
      // niet over dagen heen tot vol: de SoC blijft ≤ dag-behoefte, dus voor elke capaciteit
      // boven die behoefte is het gedrag identiek → meer capaciteit kan nooit duurder uitvallen.
      const socCap = Math.min(batCapacity, batStoreCap[dayKey] ?? batCapacity);
      const socRoom = Math.max(0, socCap - batSoC) / batEfficiency;   // nog te laden (drawn kWh)

      // 1. Zonoverschot opslaan (tot de dag-behoefte).
      if (expDyn > 0 && socRoom > 0) {
        const c = Math.min(expDyn, currentPowerLimit, socRoom);
        batSoC += c * batEfficiency;
        expDyn = Math.max(0, expDyn - c);
        currentPowerLimit -= c;
        batChargeVal += c;
      }
      // 2. Van het net laden in de geplande goedkope uren — begrensd door zowel het
      //    inkoop-budget (bruto-EB-val) als de dag-behoefte op de SoC.
      if (isChargeHour && expDyn === 0 && currentPowerLimit > 0) {
        const drawnRoom = Math.max(0, (batGridBudget[dayKey] || 0) - (batGridDrawn[dayKey] || 0));
        const room = Math.max(0, socCap - batSoC) / batEfficiency;
        const c = Math.min(currentPowerLimit, room, drawnRoom);
        if (c > 0) {
          batSoC += c * batEfficiency;
          impDyn += c;
          currentPowerLimit -= c;
          batGridDrawn[dayKey] = (batGridDrawn[dayKey] || 0) + c;
          batChargeVal += c;
        }
      }
      // 3. Ontladen om de woning-import te dekken — zelfconsumptie is ÁLTIJD lonend
      //    (je bespaart de hele all-in prijs incl. EB, ongeacht de spotprijs), plus de
      //    geplande dure uren voor net-export (winst-modus). NIET tijdens een laad-uur,
      //    anders zou de accu in hetzelfde uur laden én ontladen (rondloop-verlies).
      const wantDischarge = !isChargeHour
        && (impDyn > 0 || (gridExport && batDischargeHrs[dayKey]?.has(hour)));
      if (wantDischarge && batSoC > 0 && expDyn === 0) {
        let d = Math.min(batPower, batSoC);
        const toHouse = Math.min(impDyn, d);
        impDyn -= toHouse; batSoC -= toHouse; d -= toHouse;
        batDischargeVal += toHouse;

        // Terugleveren aan net mag alleen als (a) het rendement oplevert (opbrengst spot/1.21
        // > laadkosten loAllin/rendement) én (b) het écht overschot is: we houden de
        // resterende eigen import van vandaag in de accu, want zelfconsumptie is waardevoller.
        const loAllin = batDayMinAllin[dayKey] || (markupBtw + eb);
        const minExportSpot = (loAllin / batEfficiency) * 1.21;
        const reserve = batSelfReserve[dayKey] ?? 0;                 // bewaar de eigen-verbruik-voorraad
        const exportable = Math.min(d, Math.max(0, batSoC - reserve));
        if (gridExport && exportable > 0 && spot > minExportSpot) {
          expDyn += exportable; batSoC -= exportable;
          batDischargeVal += exportable;
        }
      }

      // Vast circuit
      if (expFx > 0 && batSoCFx < batCapacity) {
        const c = Math.min(expFx, batPower, (batCapacity - batSoCFx) / batEfficiency);
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
    dynExpRev += dynExp * (spot / 1.21);
    dynImpKwh += dynImp;
    dynExpKwh += dynExp;

    if (full) {
      hourly[hour].imports.push(dynImp);
      hourly[hour].exports.push(dynExp);
      const allIn = basePrice + eb;
      const dynHrCost = dynImp * allIn - dynExp * (spot / 1.21);   // teruglevering = kale spot (excl. BTW, 2027)
      const tariff = isPeak ? fixedPeakRate : fixedDalRate;
      const fxHrCost = impFx * tariff - expFx * fixedFeedInRate + expFx * fixedFeedInFee;

      hourly[hour].dynCosts.push(dynHrCost);
      hourly[hour].fixedCosts.push(fxHrCost);
      weekly[dow].dynCosts.push(dynHrCost);
      weekly[dow].fixedCosts.push(fxHrCost);

      // Collect simulated hardware values for 24h profile
      hourly[hour].solar.push(row.solar_yield || 0);
      let evVal = 0;
      if (hasEv) {
        const evD = evScheduleCacheDyn[dayKey]?.[hour];
        if (evD) evVal = evD.grid + evD.solar;
      }
      hourly[hour].ev.push(evVal);
      hourly[hour].hp.push(hasHeatPump ? hpLoad : 0);
      hourly[hour].batCharge.push(batChargeVal);
      hourly[hour].batDischarge.push(batDischargeVal);

      if (!dayTot[dayKey]) dayTot[dayKey] = { dynCost: 0, fixedCost: 0, impKwh: 0, expKwh: 0, spotSum: 0, spotN: 0, impCost: 0, expRev: 0 };
      const pd = dayTot[dayKey];
      pd.dynCost += dynHrCost; pd.fixedCost += fxHrCost;
      pd.impKwh += dynImp; pd.expKwh += dynExp;
      pd.impCost += dynImp * allIn;   // all-in afname-kosten incl. EB (voor de "per dag"-detailtabel)
      pd.expRev += dynExp * (spot / 1.21);   // teruglever-opbrengst = kale spotprijs (excl. BTW, 2027)
      if (dynImp > 0) { pd.spotSum += spot * dynImp; pd.spotN += dynImp; }

      if (!dayHour[dayKey]) dayHour[dayKey] = Array.from({ length: 24 }, () => null);
      dayHour[dayKey][hour] = { dynCost: dynHrCost, fixedCost: fxHrCost, spot, impKwh: dynImp, expKwh: dynExp };
    }
  });

  // Jaarnormalisatie-schaling
  fxPeakImp *= yearScale; fxDalImp *= yearScale; fxPeakExp *= yearScale; fxDalExp *= yearScale;
  dynImpCost *= yearScale; dynExpRev *= yearScale; dynImpKwh *= yearScale; dynExpKwh *= yearScale;

  // ── EINDTOTALEN REKENING (Fiscaal Zuiver Model 2027) ──
  // Het vaste piek/dal-tarief is het all-in tarief zoals getekend (incl. EB-bij-tekenen).
  // We rekenen er rechtstreeks mee: de energiebelasting-schuif (een dynamisch-contract-
  // parameter, ook live bijgewerkt door Frank) mag het vaste contract NIET stil herprijzen.
  const fxImpCost = fxPeakImp * fixedPeakRate + fxDalImp * fixedDalRate;
  const fxFeedCredit = (fxPeakExp + fxDalExp) * fixedFeedInRate;
  const fxFeedPenalt = (fxPeakExp + fxDalExp) * fixedFeedInFee;
  const fxSub = fixedVastrecht * 12.0;

  // Heffingskorting (vaste jaarlijkse EB-vermindering per aansluiting) — identiek voor
  // beide contracten, dus comparison-neutraal, maar nodig voor realistische jaartotalen.
  const ebRebate = EB_REBATE_2026;

  const fixedBill = fxImpCost - fxFeedCredit + fxFeedPenalt + fxSub - ebRebate;

  const dynEB = dynImpKwh * eb; // Gross energy tax charging rule
  const dynSub = dynamicVastrecht * 12.0;
  const dynBill = (dynImpCost - dynExpRev) + dynEB + dynSub - ebRebate;

  const out = { fixedBill, dynBill };

  if (full) {
    Object.assign(out, {
      totalImportKwh: dynImpKwh, totalExportKwh: dynExpKwh,
      netDynamicKwh: Math.max(0, dynImpKwh - dynExpKwh),
      dynamicRawImportCost: dynImpCost, dynamicRawExportRevenue: dynExpRev,
      dynamicNetTax: dynEB, dynamicSubscription: dynSub, dynamicTotalBill: dynBill,
      taxRebate: ebRebate,
      fixedPeakImport: fxPeakImp, fixedPeakExport: fxPeakExp,
      fixedDalImport: fxDalImp, fixedDalExport: fxDalExp,
      fixedImportCost: fxImpCost, fixedFeedInCredit: fxFeedCredit,
      fixedFeedInFee: fxFeedPenalt, fixedSubscription: fxSub, fixedTotalBill: fixedBill,
      totalSavings: fixedBill - dynBill,
      // Deel door |fixedBill|: door de heffingskorting kan een totaal negatief zijn
      // (zon-huishouden krijgt geld terug) → anders zou het % van teken wisselen.
      savingsPct: fixedBill !== 0 ? ((fixedBill - dynBill) / Math.abs(fixedBill)) * 100 : 0,
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
  const isSimple = document.body && document.body.classList && typeof document.body.classList.contains === "function"
    ? document.body.classList.contains("mode-simple")
    : true; // Default to simple if not in a proper browser environment
  return {
    fixedPeakRate: parseFloat(document.getElementById("fixed-peak").value),
    fixedDalRate: parseFloat(document.getElementById("fixed-dal").value),
    fixedFeedInRate: parseFloat(document.getElementById("fixed-feedin-rate").value),
    fixedVastrecht: parseFloat(document.getElementById("fixed-vastrecht").value),
    fixedFeedInFee: parseFloat(document.getElementById("fixed-feedin-fee")?.value) || 0,
    dynamicMarkup: parseFloat(document.getElementById("dynamic-markup").value),
    dynamicVastrecht: parseFloat(document.getElementById("dynamic-vastrecht").value),
    stressMultiplier: isSimple ? 1.0 : (parseFloat(document.getElementById("stress-multiplier")?.value) || 1.0),
    solarDimmingMode: isSimple ? "off" : (document.getElementById("solar-dimming-mode")?.value || "off"),
    hasHeatPump: isSimple ? false : document.getElementById("has-heatpump").checked,
    hpWinterBaseload: parseFloat(document.getElementById("hp-baseload").value),
    hasEv: isSimple ? false : document.getElementById("has-ev").checked,
    evWeeklyDist: parseFloat(document.getElementById("ev-dist").value),
    evConsumption: parseFloat(document.getElementById("ev-cons").value) / 100.0,
    evSolarMatch: document.getElementById("ev-solar-match").checked,
    evProfile: document.getElementById("ev-profile")?.value || "home",
    hasBattery: isSimple ? false : document.getElementById("has-battery").checked,
    batCapacity: parseFloat(document.getElementById("bat-cap").value),
    batPower: parseFloat(document.getElementById("bat-power").value),
    batEfficiency: parseFloat(document.getElementById("bat-eff").value) / 100.0,
    batMode: document.getElementById("bat-mode")?.value || "zelf",
  };
}

// ── Download: eigen meetdata met gematchte (historische) EPEX-prijzen ─────────
// Exporteert per uur de afname/teruglevering + de bijbehorende beursprijs en de
// daaruit volgende kosten voor zowel het dynamische als het vaste contract.
// CSV met ;-scheiding + BOM zodat Nederlandse Excel het netjes opent.
function downloadDataWithPrices() {
  if (!energyData || energyData.length === 0) {
    alert("Er is nog geen data geladen om te downloaden. Upload eerst je P1-data of koppel Home Assistant.");
    return;
  }
  const cfg = readSimConfig();
  const eb = liveEnergyTax;
  const markupBtw = cfg.dynamicMarkup * 1.21;

  const header = [
    "tijdstip", "afname_kWh", "teruglevering_kWh", "opwek_kWh",
    "epex_spot_eur_per_kWh_incl_btw", "prijs_bron",
    "dynamisch_allin_eur_per_kWh", "dynamisch_netto_kosten_eur",
    "vast_tarief_eur_per_kWh", "vast_netto_kosten_eur",
  ];
  const lines = [header.join(";")];

  energyData.forEach(r => {
    const { hour, month, dow, epexKey: key } = rowMeta(r);
    const imp = (r.import_t1 || 0) + (r.import_t2 || 0);
    const exp = (r.export_t1 || 0) + (r.export_t2 || 0);
    const sol = r.solar_yield != null ? Number(r.solar_yield) : null;
    const real = epexHistory.has(key);
    const spot = real ? epexHistory.get(key) : getFallbackSpot(month, hour);
    const allIn = spot + markupBtw + eb;                       // all-in consumentenprijs dynamisch
    const dynCost = imp * allIn - exp * (spot / 1.21);                  // netto kosten dat uur (dynamisch)
    const isPeak = dow > 0 && dow < 6 && hour >= 7 && hour < 23;
    const tariff = isPeak ? cfg.fixedPeakRate : cfg.fixedDalRate;
    const vastCost = imp * tariff - exp * cfg.fixedFeedInRate + exp * cfg.fixedFeedInFee;
    lines.push([
      r.timestamp, imp.toFixed(4), exp.toFixed(4), sol == null ? "" : sol.toFixed(4),
      spot.toFixed(5), real ? "echt" : "geschat",
      allIn.toFixed(5), dynCost.toFixed(5),
      tariff.toFixed(4), vastCost.toFixed(5),
    ].join(";"));
  });

  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const from = energyData[0].timestamp.slice(0, 10);
  const till = energyData[energyData.length - 1].timestamp.slice(0, 10);
  a.href = url;
  a.download = `energie-data-met-epex-prijzen_${from}_tot_${till}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
      batMode: baseCfg.batMode,            // UI-instelling
    });
    const extra = baselineDyn - r.dynBill;      // ROI dynamic
    const extraFix = baselineFix - r.fixedBill; // ROI fixed (zelfconsumptie)
    const cost = cap * BATTERY_COST_PER_KWH;
    const payback = extra > 0 ? cost / extra : Infinity;
    const paybackFix = extraFix > 0 ? cost / extraFix : Infinity;
    return { cap, power: cap * 0.5, dynBill: r.dynBill, fixedBill: r.fixedBill, extra, extraFix, cost, payback, paybackFix };
  });

  window.lastOptResults = { rows, noBat };
  const currentType = window.optContractType || "dyn";
  renderBatteryOptimization(rows, currentType, resEl);
}

function renderBatteryOptimization(rows, type, resEl) {
  const eur = v => (v >= 0 ? "" : "−") + "€" + Math.abs(v).toFixed(0);
  const yrs = p => Number.isFinite(p) ? `${p.toFixed(1)} jr` : "—";

  // Bepaal sweet spot (ROI)
  let sweetIdx = -1, bestPayback = Infinity;
  rows.forEach((r, i) => {
    const pb = type === "dyn" ? r.payback : r.paybackFix;
    if (pb < bestPayback) { bestPayback = pb; sweetIdx = i; }
  });
  if (sweetIdx === -1) {
    rows.forEach((r, i) => {
      const extraVal = type === "dyn" ? r.extra : r.extraFix;
      const sweetExtraVal = sweetIdx === -1 ? 0 : (type === "dyn" ? rows[sweetIdx].extra : rows[sweetIdx].extraFix);
      if (sweetIdx === -1 || extraVal > sweetExtraVal) sweetIdx = i;
    });
  }

  const body = rows.map((r, i) => {
    const sweet = i === sweetIdx;
    const bg = sweet ? "background:rgba(56,239,125,0.14);" : "";
    const star = sweet ? " ⭐" : "";
    const extraVal = type === "dyn" ? r.extra : r.extraFix;
    const paybackVal = type === "dyn" ? r.payback : r.paybackFix;
    return `<tr style="${bg}">
      <td style="padding:0.25rem 0.4rem;">${r.cap} kWh${star}</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${r.power.toFixed(1)} kW</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;color:var(--accent-green);">${eur(extraVal)}/jr</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${yrs(paybackVal)}</td>
    </tr>`;
  }).join("");

  const sweet = rows[sweetIdx];
  const sweetPayback = sweet ? (type === "dyn" ? sweet.payback : sweet.paybackFix) : Infinity;
  const sweetExtra = sweet ? (type === "dyn" ? sweet.extra : sweet.extraFix) : 0;
  const contractLabel = type === "dyn" ? "dynamisch" : "vast";

  const verdict = sweet && Number.isFinite(sweetPayback)
    ? `<strong style="color:var(--accent-green);">Sweet spot: ${sweet.cap} kWh</strong> — accu-meerwaarde ${eur(sweetExtra)}/jaar, terugverdiend in ${yrs(sweetPayback)} (bij €${BATTERY_COST_PER_KWH}/kWh).`
    : `Binnen dit scenario verdient geen enkele accu zichzelf terug op een ${contractLabel} contract (meerwaarde ≤ €0/jaar).`;

  const tabDynActive = type === "dyn" ? "active" : "";
  const tabFixActive = type === "fix" ? "active" : "";

  resEl.style.display = "";
  resEl.innerHTML = `
    <div style="display:flex; justify-content:center; gap:0.5rem; margin-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.6rem;">
      <button type="button" class="btn-toggle ${tabDynActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" onclick="window.setOptContract('dyn')">Dynamisch Contract</button>
      <button type="button" class="btn-toggle ${tabFixActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" onclick="window.setOptContract('fix')">Vast Contract</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead><tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.12);">
        <th style="padding:0.25rem 0.4rem;text-align:left;">Accu</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Vermogen</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Meerwaarde</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Terugverdientijd</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div style="margin-top: 0.6rem; font-size: 0.72rem; line-height: 1.5; color: var(--text-main); margin-bottom:0.5rem;">
      ${verdict}
    </div>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.45rem;line-height:1.45;">
      💡 <strong>Let op:</strong> De besparingen worden berekend ten opzichte van dezelfde opstelling zónder thuisbatterij.
      ${type === "dyn" 
        ? "Bij een <strong>dynamisch contract</strong> laadt de batterij op bij zonnestroom en bij goedkope uren van het net, en levert/ontlaadt bij dure uren."
        : "Bij een <strong>vast contract</strong> doet de batterij uitsluitend aan zelfconsumptie (zonne-overschot opslaan en 's avonds/nachts gebruiken)."}
    </p>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.45;">
      Investering €${BATTERY_COST_PER_KWH}/kWh (indicatief). Vermogen = 0,5× capaciteit.
    </p>`;
}

window.setOptContract = function(type) {
  window.optContractType = type;
  if (window.lastOptResults && window.lastOptResults.rows) {
    const resEl = document.getElementById("battery-optimization-result");
    renderBatteryOptimization(window.lastOptResults.rows, type, resEl);
  }
};

// =============================================================================
// HOOFD-SIMULATIE: leest DOM eenmalig, bouwt cfg, roept _simulateCore aan.
// =============================================================================
function runSimulation() {
  if (energyData.length === 0) return;

  // ── Energiebelasting uit de schuif lezen (live-fetch werkt deze schuif bij) ──
  const ebEl = document.getElementById("energy-tax");
  if (ebEl) liveEnergyTax = parseFloat(ebEl.value);

  // ── Importcheck: opschonen + gaten vullen (idempotent per geladen dataset) ──
  ensureCleanData();

  // ── Jaarprojectie (8760u) opbouwen/cachen vóór de simulatie ──────────────
  ensureFullYearData();

  // ── Fallback kalibreren op opgehaalde EPEX-historie (vult geprojecteerde uren) ──
  buildCalibratedProfile();

  // ── Alle DOM-reads EENMALIG voor de loop ─────────────────────────────────
  const cfg = readSimConfig();

  // ── Hoofdsimulatie + hardware-deltas (5 x _simulateCore) ─────────────────
  const sim = _simulateCore(cfg, true);

  const base0 = {
    ...cfg,
    hasHeatPump: false, hpWinterBaseload: 0,
    hasEv: false, evWeeklyDist: 0, evConsumption: 0, evSolarMatch: false,
    hasBattery: false, batCapacity: 0, batPower: 0, batEfficiency: 1, batMode: "zelf",
  };
  const base = _simulateCore(base0, false);
  const withHp = _simulateCore({ ...base0, hasHeatPump: true, hpWinterBaseload: cfg.hpWinterBaseload }, false);
  const withEv = _simulateCore({ ...base0, hasEv: true, evWeeklyDist: cfg.evWeeklyDist, evConsumption: cfg.evConsumption, evSolarMatch: cfg.evSolarMatch }, false);
  const withBat = _simulateCore({ ...base0, hasBattery: true, batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency, batMode: cfg.batMode }, false);

  // ── activeSimulation bijwerken ────────────────────────────────────────────
  activeSimulation = {
    ...sim,
    hwEffects: {
      base,
      hp: { fixed: withHp.fixedBill - base.fixedBill, dyn: withHp.dynBill - base.dynBill, enabled: cfg.hasHeatPump, cfg: { hpWinterBaseload: cfg.hpWinterBaseload } },
      ev: { fixed: withEv.fixedBill - base.fixedBill, dyn: withEv.dynBill - base.dynBill, enabled: cfg.hasEv, cfg: { evDist: cfg.evWeeklyDist, evCons: cfg.evConsumption, evSolar: cfg.evSolarMatch } },
      bat: { fixed: withBat.fixedBill - base.fixedBill, dyn: withBat.dynBill - base.dynBill, enabled: cfg.hasBattery, cfg: { batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency * 100, batMode: cfg.batMode } },
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
  renderDynPriceExample();
  renderDataQualityBanner();
}

// Toont een (wegklikbare) samenvatting van de importcheck: hoeveel uren echt waren
// en welke gaten/periodes zijn bijgevuld. Verschijnt alleen als er iets is ingevuld.
function renderDataQualityBanner() {
  const el = document.getElementById("data-quality-banner");
  if (!el) return;
  const q = dataQuality;
  // Alleen tonen bij een echt ontbrekende periode of meer dan een handvol losse gat-uren
  // (1–2 uur kan een DST-/afrondingsartefact zijn — geen alarm waard).
  const worthShowing = q && (q.profileHours > 0 || q.interpHours > 2);
  if (!worthShowing || dataQualityDismissed) { el.style.display = "none"; return; }

  const fmtDays = h => {
    const d = h / 24;
    return d >= 1 ? `${d.toFixed(d % 1 === 0 ? 0 : 1)} dag${d >= 2 ? "en" : ""}` : `${h} uur`;
  };
  let parts = [];
  if (q.profileHours > 0) {
    const n = q.largePeriods.length;
    parts.push(`<strong>${n} langere periode${n > 1 ? "s" : ""}</strong> (samen ${fmtDays(q.profileHours)}) ${n > 1 ? "ontbraken" : "ontbrak"} — ingevuld met je eigen standaardprofiel (mediaan dagverloop per seizoen)`);
  }
  if (q.interpHours > 0) {
    parts.push(`${q.interpHours} kort${q.interpHours > 1 ? "e gaten" : " gat"} bijgeschat`);
  }
  el.style.display = "";
  el.innerHTML =
    `📋 <strong>Data gecontroleerd:</strong> ${q.realHours.toLocaleString("nl-NL")} van ${q.expectedHours.toLocaleString("nl-NL")} uren waren echte metingen (${q.completenessPct}%). `
    + parts.join("; ") + "."
    + ` <span style="opacity:0.85;">De ingevulde periodes tellen mee als gemiddeld gebruik, niet als gemeten data.</span>`
    + `<button type="button" class="dismiss-x" data-dismiss="data-quality-banner" title="Verberg deze melding">×</button>`;
}

// Vult het rekenvoorbeeld in de "Hoe wordt de dynamische prijs berekend?"-uitleg
// met een representatief avonduur (18:00), op basis van de huidige instellingen.
function renderDynPriceExample() {
  const box = document.getElementById("dynprice-example");
  if (!box) return;
  const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.018;
  const eb = liveEnergyTax;

  let spot = null;
  const hp = activeSimulation?.hourlyProfile;
  if (hp && hp[18]?.spots?.length) {
    const s = [...hp[18].spots].sort((a, b) => a - b);
    spot = s[Math.floor(s.length / 2)];   // mediaan spotprijs om 18:00
  }
  if (spot == null) spot = getFallbackSpot(1, 18);

  const kaleEpex = spot / 1.21;            // spot is incl. BTW → toon de kale beursprijs
  const btw = (kaleEpex + markup) * 0.21;
  const allIn = spot + markup * 1.21 + eb;
  const pct = activeSimulation?.epexPct ?? 0;
  const bron = pct === 100 ? "echte EPEX" : pct > 0 ? `${pct}% echte EPEX` : "geschatte prijs";

  const part = (val, lbl) => `<span>€${val.toFixed(3)}</span> <span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);">${lbl}</span>`;
  box.innerHTML =
    `${part(kaleEpex, "EPEX")} + ${part(markup, "opslag")} + ${part(btw, "BTW")} + ${part(eb, "EB")} = ` +
    `<span style="color:var(--accent-cyan);font-weight:700;">€${allIn.toFixed(3)}/kWh</span>` +
    `<span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);"> &nbsp;(voorbeeld 18:00 · ${bron})</span>`;
}



// Update the DOM Elements with calculated values
function updateUIElements() {
  const sim = activeSimulation;

  // ── Prognose-badge: toelichting op de jaarbasis afhankelijk van de modus ──
  const badge = document.getElementById("prognosis-badge");
  const extrapolated = dataMeta.mode === "seasonal" || dataMeta.mode === "linear";
  if (badge && prognosisDismissed) {
    badge.style.display = "none";
  } else if (badge) {
    const setBadgeTone = (orange) => {
      badge.style.background = orange ? "rgba(255,165,0,0.12)" : "rgba(56,189,248,0.10)";
      badge.style.borderColor = orange ? "rgba(255,165,0,0.35)" : "rgba(56,189,248,0.30)";
      badge.style.color = orange ? "var(--accent-orange)" : "var(--accent-cyan)";
    };
    if (dataMeta.mode === "seasonal") {
      badge.style.display = "";
      const pct = Math.round((dataMeta.synthPct || 0) * 100);
      const prominent = (dataMeta.synthPct || 0) > 0.40;   // >40% geschat → nadrukkelijke melding
      setBadgeTone(prominent);
      document.getElementById("prognosis-text").innerHTML = prominent
        ? `je hebt maar <strong>${dataMeta.realDays} dagen</strong> data, dus <strong>~${pct}% van het jaar is geschat</strong>. Ongemeten maanden zijn ingevuld met je eigen typische dag van de maand met gelijke daglengte (bijv. augustus ≈ april). <strong>Meer maanden meten maakt de schatting flink nauwkeuriger.</strong>`
        : `${dataMeta.realDays} dagen eigen data aangevuld tot een volledig jaar (${pct}% geschat) via je eigen typische dag per maand.`;
    } else if (dataMeta.mode === "linear") {
      badge.style.display = "";
      setBadgeTone(false);
      document.getElementById("prognosis-text").innerHTML =
        `${dataMeta.realDays} dagen eigen data <strong>lineair</strong> doorgerekend naar een jaar (×${dataMeta.yearScale.toFixed(1)}, géén seizoenscorrectie). Zet <em>Jaarprognose</em> aan voor een seizoensgewogen schatting.`;
    } else {
      badge.style.display = "none";
    }
  }
  const synthTag = extrapolated
    ? ` <span style="color:var(--accent-cyan);font-size:0.7rem;" title="Geëxtrapoleerd naar jaarbasis">· prognose</span>`
    : "";

  // Header en stats — besparing is teken-bewust: dynamisch goedkoper = groen (besparing),
  // dynamisch duurder = oranje (extra kosten). Niet langer altijd "groene besparing".
  const savings  = sim.totalSavings;           // fixedBill − dynBill; > 0 = dynamisch goedkoper
  const positive = savings >= 0;
  const col = positive ? "var(--accent-green)" : "var(--accent-orange)";
  document.getElementById("stat-savings-val").textContent = `${Math.abs(savings).toFixed(2)}`;
  document.getElementById("stat-savings-pct").textContent = `${Math.abs(sim.savingsPct).toFixed(1)}%`;
  document.getElementById("stat-savings-value").style.color = col;
  document.getElementById("stat-savings-pct").style.color = col;
  document.getElementById("stat-savings-card").classList.toggle("negative", !positive);
  document.getElementById("stat-savings-header").textContent = positive ? "Jouw besparing" : "Extra kosten dynamisch";
  const subEl = document.getElementById("stat-savings-sub");
  subEl.textContent = positive ? "▲ in het voordeel van Dynamisch" : "▼ Vast contract is goedkoper";
  subEl.style.color = col;
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
  document.getElementById("tbl-fixed-rebate").textContent = `− € ${(sim.taxRebate ?? 0).toFixed(2)}`;
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
  document.getElementById("tbl-dyn-rebate").textContent = `− € ${(sim.taxRebate ?? 0).toFixed(2)}`;
  document.getElementById("tbl-dyn-total").textContent = `€ ${sim.dynamicTotalBill.toFixed(2)}`;
}

// Custom responsive SVG Chart Renderer
function renderChart() {
  if (!activeSimulation?.hourlyProfile) return;

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

  // Helper: mean of an array
  const mean = arr => arr.length ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;

  // Pre-compute per-hour stats: mean for import/export, median for spot price, mean for hardware components
  const hourMedians = profile.map(h => ({
    imp: mean(h.imports),
    exp: mean(h.exports),
    spot: median(h.spots),
    solar: mean(h.solar || []),
    ev: mean(h.ev || []),
    hp: mean(h.hp || []),
    batCharge: mean(h.batCharge || []),
    batDischarge: mean(h.batDischarge || [])
  }));

  const isDtActive = activeSimulation?.records?.untangle?.active || (window.digitalTwinMode && window.digitalTwinMode.active);
  
  // Show or hide digital twin legends
  document.querySelectorAll(".dt-legend").forEach(el => {
    el.style.display = isDtActive ? "inline-flex" : "none";
  });

  // Max values to scale chart axis
  let maxEnergy = 0.1; // lower floor so small values are visible
  hourMedians.forEach(h => {
    if (profileVisibleLines.imp && h.imp > maxEnergy) maxEnergy = h.imp;
    if (profileVisibleLines.exp && h.exp > maxEnergy) maxEnergy = h.exp;
    if (isDtActive) {
      if (profileVisibleLines.solar && h.solar > maxEnergy) maxEnergy = h.solar;
      if (profileVisibleLines.ev && h.ev > maxEnergy) maxEnergy = h.ev;
      if (profileVisibleLines.hp && h.hp > maxEnergy) maxEnergy = h.hp;
      if (profileVisibleLines.bat && h.batCharge > maxEnergy) maxEnergy = h.batCharge;
      if (profileVisibleLines.bat && h.batDischarge > maxEnergy) maxEnergy = h.batDischarge;
    }
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
  let solarPathPoints = [];
  let evPathPoints = [];
  let hpPathPoints = [];
  let batChgPathPoints = [];
  let batDisPathPoints = [];

  for (let h = 0; h < 24; h++) {
    const hm = hourMedians[h];
    importPathPoints.push(`${getX(h)},${getYEnergy(hm.imp)}`);
    exportPathPoints.push(`${getX(h)},${getYEnergy(hm.exp)}`);
    pricePathPoints.push(`${getX(h)},${getYPrice(toConsumerPrice(hm.spot))}`);
    
    solarPathPoints.push(`${getX(h)},${getYEnergy(hm.solar)}`);
    evPathPoints.push(`${getX(h)},${getYEnergy(hm.ev)}`);
    hpPathPoints.push(`${getX(h)},${getYEnergy(hm.hp)}`);
    batChgPathPoints.push(`${getX(h)},${getYEnergy(hm.batCharge)}`);
    batDisPathPoints.push(`${getX(h)},${getYEnergy(hm.batDischarge)}`);
  }

  // Helper function to draw a line path
  const drawLine = (points, color, width = "2", dash = null, isArea = false, gradId = null) => {
    if (isArea && gradId) {
      const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
      area.setAttribute("d", `M ${getX(0)},${getYEnergy(0)} L ${points.join(" L ")} L ${getX(23)},${getYEnergy(0)} Z`);
      area.setAttribute("fill", `url(#${gradId})`);
      svg.appendChild(area);
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${points.join(" L ")}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", width);
    if (dash) path.setAttribute("stroke-dasharray", dash);
    svg.appendChild(path);
  };

  // Draw Areas and Lines for Main Import/Export
  if (profileVisibleLines.imp) {
    drawLine(importPathPoints, "var(--accent-cyan)", "2", null, true, "import-grad");
  }
  if (profileVisibleLines.exp) {
    drawLine(exportPathPoints, "var(--accent-green)", "2", null, true, "export-grad");
  }

  // Draw simulated hardware lines in Digital Twin mode
  if (isDtActive) {
    if (profileVisibleLines.solar) {
      drawLine(solarPathPoints, "#eab308", "1.5");
    }
    if (profileVisibleLines.ev) {
      drawLine(evPathPoints, "#667eea", "1.5");
    }
    if (profileVisibleLines.hp) {
      drawLine(hpPathPoints, "#ff758c", "1.5");
    }
    if (profileVisibleLines.bat) {
      drawLine(batChgPathPoints, "#4facfe", "1.5", "3,3"); // charging: dashed
      drawLine(batDisPathPoints, "#00f2fe", "1.5"); // discharging: solid
    }
  }

  // Draw Line for Price (Yellow)
  if (profileVisibleLines.spot) {
    drawLine(pricePathPoints, "var(--accent-yellow)", "2", "4,4");
  }

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
    const hm = hourMedians[hour];
    const impVal = hm.imp;
    const expVal = hm.exp;

    // Show hover lines and dots
    hoverLine.setAttribute("x1", x);
    hoverLine.setAttribute("x2", x);
    hoverLine.style.display = "block";

    if (profileVisibleLines.imp) {
      dotImp.setAttribute("cx", x);
      dotImp.setAttribute("cy", getYEnergy(impVal));
      dotImp.style.display = "block";
    } else {
      dotImp.style.display = "none";
    }

    if (profileVisibleLines.exp) {
      dotExp.setAttribute("cx", x);
      dotExp.setAttribute("cy", getYEnergy(expVal));
      dotExp.style.display = "block";
    } else {
      dotExp.style.display = "none";
    }

    // Update Tooltip details
    tooltip.style.display = "block";
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${getYEnergy(impVal) - 40}px`;

    let extraHtml = "";
    if (isDtActive) {
      if (profileVisibleLines.solar) {
        extraHtml += `<div class="tooltip-row"><span>Zonnepanelen:</span><span class="val" style="color:#eab308;">${hm.solar.toFixed(2)} kW</span></div>`;
      }
      if (profileVisibleLines.ev) {
        extraHtml += `<div class="tooltip-row"><span>Auto:</span><span class="val" style="color:#667eea;">${hm.ev.toFixed(2)} kW</span></div>`;
      }
      if (profileVisibleLines.hp) {
        extraHtml += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:#ff758c;">${hm.hp.toFixed(2)} kW</span></div>`;
      }
      if (profileVisibleLines.bat) {
        extraHtml += `<div class="tooltip-row"><span>Accu Laden:</span><span class="val" style="color:#4facfe;">${hm.batCharge.toFixed(2)} kW</span></div>`;
        extraHtml += `<div class="tooltip-row"><span>Accu Ontladen:</span><span class="val" style="color:#00f2fe;">${hm.batDischarge.toFixed(2)} kW</span></div>`;
      }
    }

    const pureSpot = hm.spot;
    const consPrice = toConsumerPrice(pureSpot);
    const rawEpex = (pureSpot / 1.21).toFixed(3);
    const markup = (parseFloat(document.getElementById("dynamic-markup")?.value) || 0.02).toFixed(3);

    tooltip.innerHTML = `
      <h4>${hour.toString().padStart(2, '0')}:00 - ${(hour + 1).toString().padStart(2, '0')}:00 uur</h4>
      <div class="tooltip-row">
        <span>Gem. Afname:</span>
        <span class="val" style="color: var(--accent-cyan);">${impVal.toFixed(2)} kW</span>
      </div>
      <div class="tooltip-row">
        <span>Gem. Teruglevering:</span>
        <span class="val" style="color: var(--accent-green);">${expVal.toFixed(2)} kW</span>
      </div>
      ${extraHtml}
      <div class="tooltip-row">
        <span>Consumentenprijs (all-in):</span>
        <span class="val" style="color: var(--accent-yellow);">€ ${consPrice.toFixed(3)} / kWh</span>
      </div>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.2rem;">
        EPEX markt €${rawEpex} × 1.21 + opslag €${markup} × 1.21 + EB €${liveEnergyTax.toFixed(3)} = all-in €${consPrice.toFixed(3)}
      </div>
    `;
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

  const minVal = Math.min(0, ...dyns, ...fixeds);
  const maxVal = Math.max(1, ...dyns, ...fixeds);
  const range = maxVal - minVal;

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
  const yOf = v => PAD_T + cH - cH * ((v - minVal) / range);
  const yZero = PAD_T + cH - cH * ((0 - minVal) / range);
  const xOf = i => PAD_L + i * barSlot + barSlot / 2;

  // Gridlijnen over de volledige range
  [0, 0.25, 0.5, 0.75, 1].forEach(r => {
    const val = minVal + r * range;
    const y = PAD_T + cH * (1 - r);
    svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(255,255,255,0.04)" }));
    if (r === 0 || r === 0.5 || r === 1) {
      const lbl = mk("text", { x: PAD_L - 5, y: y + 4, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
      lbl.textContent = `€${val.toFixed(2)}`; svg.appendChild(lbl);
    }
  });

  // Nullijn extra accentueren
  svg.appendChild(mk("line", {
    x1: PAD_L,
    y1: yZero,
    x2: W - PAD_R,
    y2: yZero,
    stroke: minVal < 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.15)",
    "stroke-width": "1",
    "stroke-dasharray": minVal < 0 ? "2,2" : ""
  }));

  for (let i = 0; i < N; i++) {
    svg.appendChild(mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: dyns[i] < fixeds[i] ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
    [[dyns[i], "rgba(0,242,254,0.75)", -barW * 0.55], [fixeds[i], "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
      const yVal = yOf(val);
      const barY = Math.min(yVal, yZero);
      const barH = Math.abs(yVal - yZero);
      if (barH < 0.5) return;
      svg.appendChild(mk("rect", { x: xOf(i) + off, y: barY, width: barW, height: barH, fill: col, rx: "1" }));
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
  
  // Zoek de minimale en maximale waarden om een dynamische schaal te bepalen
  const minVal = Math.min(0, ...months.map(m => m.has ? Math.min(m.fixed, m.dyn) : 0));
  const maxVal = Math.max(1, ...months.map(m => m.has ? Math.max(m.fixed, m.dyn) : 0));
  const range = maxVal - minVal;

  // y-as gridlijnen + labels
  for (let i = 0; i <= 4; i++) {
    const val = minVal + (range * i / 4);
    const y = padT + ch - (ch * i / 4);
    svg.appendChild(mk("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }));
    const lbl = mk("text", { x: padL - 6, y: y + 3, "text-anchor": "end", "font-size": 9, fill: "var(--text-muted)" });
    lbl.textContent = `€${Math.round(val)}`;
    svg.appendChild(lbl);
  }

  // Duidelijke nullijn als er negatieve waarden zijn
  const yZero = padT + ch - ch * ((0 - minVal) / range);
  svg.appendChild(mk("line", {
    x1: padL,
    y1: yZero,
    x2: W - padR,
    y2: yZero,
    stroke: minVal < 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)",
    "stroke-width": 1,
    "stroke-dasharray": minVal < 0 ? "3,3" : ""
  }));

  const groupW = cw / 12;
  const barW = Math.min(13, groupW / 2 - 2);
  months.forEach((m, i) => {
    const gx = padL + groupW * i + groupW / 2;
    const bar = (val, offset, color) => {
      const yVal = padT + ch - ch * ((val - minVal) / range);
      const barY = Math.min(yVal, yZero);
      const barH = Math.abs(yVal - yZero);

      const r = mk("rect", { x: gx + offset, y: barY, width: barW, height: barH, fill: color, rx: 2, opacity: 0.85 });
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
        const { batCapacity, batPower, batEfficiency, batMode } = d.cfg ?? {};
        const modeText = {
          zelf:   `<strong>Maximaal zelfverbruik:</strong> de accu slaat alléén zonne-overschot op en ontlaadt om je eigen import te dekken. Geen handel met het net.`,
          kosten: `<strong>Kostenbewust:</strong> naast zon laadt de accu óók in de goedkoopste uren van het net bij — maar alleen zoveel als nodig om je eigen verbruik te dekken (geen teruglevering).`,
          winst:  `<strong>Maximale winst:</strong> de accu koopt goedkoop in én verkoopt bij hoge prijzen terug aan het net (echte arbitrage). Let op: onder bruto-EB (2027) betaal je belasting over elke ingekochte kWh, dus dit loont alleen bij flinke prijsspreads.`,
        }[batMode || "zelf"];
        return `<strong>Aanname:</strong> ${batCapacity ?? '?'} kWh accu, ${batPower ?? '?'} kW vermogen,
          ${batEfficiency ?? '?'}% laad-/ontlaadefficiëntie.
          <br><br>
          ${modeText}
          <br><br>
          <strong>Slim ontladen:</strong> zelfconsumptie verdringt de hele all-in prijs (incl. energiebelasting), dus dat is altijd lonend. Van-het-net laden wordt begrensd op wat je die dag werkelijk zelf kunt gebruiken, zodat de accu geen onnodige stroom (en EB) inkoopt.
          <br><br>
          <em>De accu bespaart bij beide contractvormen, maar de efficiëntieverliezen (${100 - (batEfficiency ?? 85)}%) vallen zwaarder op een dynamisch contract waar de prijsmarges kleiner zijn.</em>`;
      }
    },
  ];

  const container = document.getElementById("hw-chart-body");
  container.innerHTML = "";

  // EPEX warning — onderscheidt 3 lagen: volledig live · gekalibreerd · generiek
  const epexPct = activeSimulation.epexPct ?? 0;
  if (epexPct < 100 && !epexWarnDismissed) {
    const warn = document.createElement("div");
    warn.id = "epex-warn-box";
    warn.style.cssText = "position:relative;background:rgba(255,165,0,0.12);border:1px solid rgba(255,165,0,0.3);border-radius:6px;padding:0.5rem 1.9rem 0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.75rem;color:var(--accent-orange);";
    const calibrated = calibratedProfile && calibrationMeta.buckets > 0;
    if (epexPct === 0 && !calibrated) {
      // Niets live, geen kalibratie → generiek noodprofiel (grote waarschuwing).
      warn.innerHTML = `⚠ <strong>Let op: geen echte EPEX-uurprijzen.</strong> De simulatie gebruikt generieke
         <em>seizoensprofielen</em> als noodoplossing (geijkt op NL-marktpatronen: zon-export ≈ 50% van het
         jaargemiddelde) — een redelijke schatting, maar zonder de echte piek- en negatieve dagen.
         Klik <strong>Ophalen</strong> of laad HA-data om actuele historische EPEX-prijzen te gebruiken.`;
    } else if (epexPct === 0 && calibrated) {
      // Gemeten periode valt buiten de loop, maar projectie draait op eigen prijsprofiel.
      warn.innerHTML = `ℹ De jaarprognose is gevuld met een <strong>prijsprofiel uit je eigen EPEX-historie</strong>
         (${calibrationMeta.samples} echte uurprijzen, ${calibrationMeta.buckets} seizoen×uur-buckets) i.p.v. de generieke profielen.`;
    } else {
      // Deels live, rest gevuld via kalibratie of generiek.
      warn.innerHTML = `⚠ ${epexPct}% echte EPEX-prijzen geladen; de overige ${100 - epexPct}% is `
        + (calibrated
            ? `gevuld met je <strong>eigen gekalibreerde prijsprofiel</strong> (${calibrationMeta.samples} echte uurprijzen).`
            : `geschat via het generieke seizoensprofiel.`);
    }
    const x = document.createElement("button");
    x.type = "button"; x.className = "dismiss-x"; x.textContent = "×";
    x.title = "Verberg deze melding"; x.setAttribute("data-dismiss", "epex-warn-box");
    warn.appendChild(x);
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

  // Use simulated perDayTotals if available (reflects slider/switch changes),
  // otherwise fall back to raw energyData for the base view.
  const pdt = activeSimulation?.perDayTotals;
  const bucketMap = new Map();

  if (pdt && Object.keys(pdt).length > 0) {
    // perDayTotals is { "2025-06-01": { impKwh, expKwh, ... }, ... }
    for (const [dayKey, v] of Object.entries(pdt)) {
      const key = overviewMode === "week" ? isoWeek(dayKey) : dayKey;
      if (!bucketMap.has(key)) bucketMap.set(key, { imp: 0, exp: 0 });
      const e = bucketMap.get(key);
      e.imp += v.impKwh || 0;
      e.exp += v.expKwh || 0;
    }
  } else {
    energyData.forEach(row => {
      const key = overviewMode === "week"
        ? isoWeek(row.timestamp.slice(0, 10))
        : row.timestamp.slice(0, 10);
      if (!bucketMap.has(key)) bucketMap.set(key, { imp: 0, exp: 0 });
      const e = bucketMap.get(key);
      e.imp += (row.import_t1 || 0) + (row.import_t2 || 0);
      e.exp += (row.export_t1 || 0) + (row.export_t2 || 0);
    });
  }

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
