import { appStore } from "./domain/store.js";

// Premium inline SVG icons to replace emojis
const ICON_CHECK = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const ICON_WARN = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
const ICON_STAR = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-yellow);fill:var(--accent-yellow);"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
const ICON_LIGHTBULB = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-yellow);"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>`;

import { getFallbackSpot, buildSimContext, _simulateCore, getDayRows } from "./domain/engine.js";

import {
  parseHAHistoryExportCSV, parseHAStatisticsWideCSVAsync, parseLongCSV, processHAStatistics
} from "./domain/parser.js";

/* Core Dashboard Logic & Simulation Engine */

import {
  renderChart, renderSimChart, renderAfnameDetail, renderAfnameDetailHour,
  renderAfnameDetailDay, renderMonthlyChart, renderHwChart, renderOverviewChart,
  renderSankeyDiagram, setChartsDependencies
} from "./ui/charts.js";

import {
  showSetupModal, closeSetupModal, showHardwareExplainer, closeHardwareExplainer,
  hardwareExplainerContent, toggleTableDetail, toggleCard, toggleProfileLine,
  showCsvMapModal, showUploadError, toggleAfnameDetail, updateDigitalTwinBanner
} from "./ui/dom.js";

import {
  EV_MAX_CHARGE_KW, BATTERY_C_RATE, EVENING_PEAK_MULT, HEATPUMP_HDD_FACTOR,
  ENERGY_TAX_2026, EB_REBATE_2026, NETBEHEER_2026, EPEX_PROFILES, DEMO_ROLEMAP
} from "./domain/constants.js";

import {
  rowMeta, epexKey, toConsumerPrice, seasonOf,
  precomputeEVSchedules, precomputeBatterySchedule,
  applyHeatPumpLoad, applyEVLoad, applyBatteryState, applySmartDimming,
  isoWeek
} from "./domain/energyMath.js";


// ── Store-mirror invariant (lees dit vóór je een van deze namen muteert) ──────────────
// Deze lokale `let`-bindings zijn READ-ONLY spiegels van de appStore. Ze worden uitsluitend
// bijgewerkt door de subscribe()-callback hieronder, telkens als iemand appStore.setState()
// aanroept. De engine (buildSimContext in engine.js) leest ZIJN waarden rechtstreeks uit de
// store — NIET uit deze mirrors. Daarom geldt keihard:
//
//   ▸ Schrijf NOOIT `liveEnergyTax = …` (of een andere mirror) met een bare assignment.
//     Gebruik altijd `appStore.setState({ liveEnergyTax: … })`; de subscriber spiegelt 'm.
//
// Een bare assignment werkt de mirror wél bij (zodat app.js-reads kloppen) maar laat de
// store stil → de engine rekent door met de oude waarde. Dat was bug B1 (de energie-
// belastingschuif had geen effect op de rekening). De enige uitzondering is de test-harness
// (__setTestState), die bewust mirror én store samen zet.
let {
  energyData, overviewMode, overviewMetric, activeViewType, sankeyInterval,
  sankeyValue, simMode, simDrillDay, activeSimulation, profileVisibleLines,
  epexHistory, liveEnergyTax, _lastHAStats, _lastRoleMap, digitalTwinEnabled,
  isDemoData, fullYearData, fullYearStamp, yearScale, dataMeta, epexWarnDismissed,
  prognosisDismissed, dataQualityDismissed, calibratedProfile, calibrationMeta
} = appStore.getState();

appStore.subscribe(state => {
  energyData = state.energyData; overviewMode = state.overviewMode;
  overviewMetric = state.overviewMetric; activeViewType = state.activeViewType;
  sankeyInterval = state.sankeyInterval; sankeyValue = state.sankeyValue;
  simMode = state.simMode; simDrillDay = state.simDrillDay;
  activeSimulation = state.activeSimulation; profileVisibleLines = state.profileVisibleLines;
  epexHistory = state.epexHistory; liveEnergyTax = state.liveEnergyTax;
  _lastHAStats = state._lastHAStats; _lastRoleMap = state._lastRoleMap;
  digitalTwinEnabled = state.digitalTwinEnabled; isDemoData = state.isDemoData;
  fullYearData = state.fullYearData; fullYearStamp = state.fullYearStamp;
  yearScale = state.yearScale; dataMeta = state.dataMeta;
  epexWarnDismissed = state.epexWarnDismissed; prognosisDismissed = state.prognosisDismissed;
  dataQualityDismissed = state.dataQualityDismissed; calibratedProfile = state.calibratedProfile;
  calibrationMeta = state.calibrationMeta;
});

// Global exports for backwards compat in other files during migration
window.toggleProfileLine = toggleProfileLine;

const CALIB_MIN_SAMPLES = 3;    // minimaal aantal echte prijzen per (seizoen,uur)-emmer

function buildCalibratedProfile() {
  appStore.setState({ calibratedProfile: null });
  appStore.setState({ calibrationMeta: { buckets: 0, samples: 0 } });
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
    appStore.setState({ calibratedProfile: prof });
    appStore.setState({ calibrationMeta: { buckets, samples: epexHistory.size } });
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


// ─── Leverancier-presets (indicatieve waarden 2025/2026 — controleer eigen contract) ──
// Vult de tariefschuiven; teruglevertarief/VTK volgens gevonden marktcijfers, piek/dal
// en opslag als typische NL-marktbenadering. Stappen sluiten aan op de slider-steps.
const SUPPLIER_PRESETS = {
  vattenfall: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.045, "dynamic-markup": 0.025, "dynamic-export-markup": 0.025 },
  eneco: { "fixed-peak": 0.28, "fixed-dal": 0.25, "fixed-feedin-rate": 0.040, "fixed-feedin-fee": 0.030, "dynamic-markup": 0.025, "dynamic-export-markup": 0.025 },
  greenchoice: { "fixed-peak": 0.29, "fixed-dal": 0.26, "fixed-feedin-rate": 0.040, "fixed-feedin-fee": 0.010, "dynamic-markup": 0.020, "dynamic-export-markup": 0.020 },
  budgetthuis: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.045, "fixed-feedin-fee": 0.020, "dynamic-markup": 0.020, "dynamic-export-markup": 0.020 },
  anwb: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.050, "fixed-feedin-fee": 0.000, "dynamic-markup": 0.020, "dynamic-export-markup": 0.020 },
  zonneplan: { "fixed-peak": 0.27, "fixed-dal": 0.24, "fixed-feedin-rate": 0.050, "fixed-feedin-fee": 0.000, "dynamic-markup": 0.015, "dynamic-export-markup": 0.015 },
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

// Klap een detail-tabelgedeelte in/uit

window.toggleTableDetail = toggleTableDetail;

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
    // Geavanceerde weergave start standaard op de Sankey-stroomgrafiek (rijker overzicht
    // voor power-users); de basis-weergave houdt de eenvoudiger staaf-/lijngrafiek. Alleen
    // bij geladen data — zonder data zou de Sankey leeg renderen (boot regelt dit ná de load).
    setOverviewViewType(mode === "simple" ? "bars" : "sankey");
  }
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  restoreHACredentials();
  
  if (typeof window !== "undefined" && window.innerWidth <= 800) {
    document.getElementById("intro-explainer")?.removeAttribute("open");
  }
  
  // View mode initialiseren
  const savedMode = (typeof localStorage !== "undefined" && localStorage.getItem("view_mode")) || "simple";
  setViewMode(savedMode);

  // Voorbeelddata laden zodat de grafieken meteen gevuld zijn, dán de modus-standaard voor
  // het overzicht toepassen (geavanceerd → Sankey). Bij boot heeft setViewMode nog geen data,
  // dus dat doen we hier ná de load.
  loadDemoData().then(() => {
    if (typeof energyData !== "undefined" && energyData.length > 0) {
      setOverviewViewType(savedMode === "simple" ? "bars" : "sankey");
    }
  });
});

// Setup Events
// Throttelt zware hersimulaties. Een slider-`input` vuurt continu tijdens het slepen
// (~60×/s); zonder dit draait runSimulation() (5× _simulateCore over 8760u + 6 charts)
// elke frame → hoofdthread-jank. We draaien hooguit één keer per SIM_MIN_INTERVAL_MS,
// frame-uitgelijnd, met een gegarandeerde trailing run aan het eind van een sleep.
// Een THROTTLE (niet een debounce): zo blijft de grafiek live meebewegen tijdens het
// slepen (~12 fps voor de zware sim) i.p.v. pas te updaten ná het loslaten.
// De badge-update blijft volledig synchroon (directe feedback; zie de input-listener).
// Toekomst: verplaats _simulateCore naar een Web Worker (de engine is al ctx-puur /
// DOM-vrij) → de hoofdthread blijft dan 60 fps ongeacht de datasetgrootte.
const SIM_MIN_INTERVAL_MS = 80;
let _simRaf = 0, _simTrailing = 0, _simLastRun = 0;
function scheduleSim() {
  const since = Date.now() - _simLastRun;
  const fire = () => {
    if (_simRaf) return;
    _simRaf = requestAnimationFrame(() => { _simRaf = 0; _simLastRun = Date.now(); runSimulation(); });
  };
  if (since >= SIM_MIN_INTERVAL_MS) {
    fire();                                  // genoeg tijd verstreken → meteen (frame-aligned)
  } else if (!_simTrailing) {
    _simTrailing = setTimeout(() => { _simTrailing = 0; fire(); }, SIM_MIN_INTERVAL_MS - since);
  }
}

// Sluitknoppen ("×") op de info-/waarschuwingsbanners. Eén gedelegeerde document-listener
// zodat het óók werkt voor banners die later (her)gerenderd worden (EPEX-waarschuwing,
// datakwaliteit, prognose). `data-dismiss="<doel-id>"` verbergt dat element; voor de
// herhaaldelijk gerenderde banners onthouden we de keuze in de store (sessie) zodat ze
// niet terugkomen bij de volgende render.
function initDismissHandlers() {
  const DISMISS_FLAG = {
    "epex-warn-box": "epexWarnDismissed",
    "prognosis-badge": "prognosisDismissed",
    "data-quality-banner": "dataQualityDismissed",
  };
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-dismiss]");
    if (!btn) return;
    const targetId = btn.getAttribute("data-dismiss");
    const el = document.getElementById(targetId);
    if (el) el.style.display = "none";
    const flag = DISMISS_FLAG[targetId];
    if (flag) appStore.setState({ [flag]: true });
  });
}

function setupEventListeners() {
  // Slider input reactive badges
  const sliders = document.querySelectorAll('input[type="range"]');
  sliders.forEach(slider => {
    slider.addEventListener("input", (e) => {
      const badge = document.getElementById(`${e.target.id}-val`);
      if (badge) {
        let prefix = e.target.dataset.prefix || "";
        let suffix = e.target.dataset.suffix || "";
        badge.textContent = `${prefix}${e.target.value}${suffix}`;
      }
      scheduleSim();
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
        ? `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg> Omvormer-sensor gekoppeld — nauwkeurige berekening.`
        : `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Geen omvormer-sensor — schatting op basis van P1-meterdata.`;
      if (v === "off") { el.style.display = "none"; return; }
      el.style.display = "block";
      if (v === "dim") {
        el.innerHTML = `<strong>Dimmen</strong>: de omvormer regelt automatisch af tot het momentele huisverbruik. Zonne-energie voedt nog steeds het huis — alleen het <em>overschot</em> dat naar het net zou gaan, wordt onderdrukt.<br>Effect op dynamisch: <strong>export = 0, import ≈ 0</strong> wanneer zonneopwek ≥ huisverbruik.<br><em>${sensorNote}</em>`;
      } else {
        el.innerHTML = `<strong>Uitschakelen</strong>: omvormer compleet uit. Het huis trekt in die uren <em>alles</em> van het net, inclusief wat de panelen normaal zelf opwekten.<br>Effect op dynamisch: <strong>export = 0, import = volledig huisverbruik</strong> van het net.<br>${hasSensor ? `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);margin-right:0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg> Met sensor kan echt huisverbruik berekend worden.` : `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Zonder omvormer-sensor is de berekening minder nauwkeurig (zelf-verbruik van zonne is onbekend).`}`;
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

  // --- Dynamic HTML bindings previously using inline onclick/onchange ---
  document.getElementById('tab-direct')?.addEventListener('click', () => {
    const fn = window.showModalTab || function(t) {
      document.getElementById('modal-tab-direct').style.display = t === 'direct' ? '' : 'none';
      document.getElementById('modal-tab-manual').style.display = t === 'manual' ? '' : 'none';
      document.getElementById('tab-direct').className = t === 'direct' ? 'btn-primary' : 'btn-secondary';
      document.getElementById('tab-manual').className = t === 'manual' ? 'btn-primary' : 'btn-secondary';
    };
    fn('direct');
  });
  document.getElementById('tab-manual')?.addEventListener('click', () => {
    const fn = window.showModalTab || function(t) {
      document.getElementById('modal-tab-direct').style.display = t === 'direct' ? '' : 'none';
      document.getElementById('modal-tab-manual').style.display = t === 'manual' ? '' : 'none';
      document.getElementById('tab-direct').className = t === 'direct' ? 'btn-primary' : 'btn-secondary';
      document.getElementById('tab-manual').className = t === 'manual' ? 'btn-primary' : 'btn-secondary';
    };
    fn('manual');
  });
  document.getElementById('copy-snippet-btn')?.addEventListener('click', copySetupSnippet);
  document.getElementById('btn-view-simple')?.addEventListener('click', () => setViewMode('simple'));
  document.getElementById('btn-view-advanced')?.addEventListener('click', () => setViewMode('advanced'));
  
  document.querySelectorAll('h2.section-title').forEach(el => {
    el.addEventListener('click', () => toggleCard(el));
  });

  document.getElementById('btn-load-demo')?.addEventListener('click', loadDemoData);
  
  document.getElementById('prognose-toggle')?.addEventListener('change', runSimulation);
  document.getElementById('supplier-preset')?.addEventListener('change', (e) => applySupplierPreset(e.target.value));
  document.getElementById('solar-dimming-mode')?.addEventListener('change', runSimulation);
  
  document.getElementById('btn-explain-ev')?.addEventListener('click', () => showHardwareExplainer('ev'));
  document.getElementById('btn-explain-battery')?.addEventListener('click', () => showHardwareExplainer('battery'));
  document.getElementById('btn-explain-heatpump')?.addEventListener('click', () => showHardwareExplainer('heatpump'));
  
  document.getElementById('dt-toggle-btn')?.addEventListener('click', () => {
    // Note: digitalTwinEnabled is local to app.js
    toggleDigitalTwin(!digitalTwinEnabled);
  });

  ['imp','exp','spot','solar','ev','hp','bat'].forEach(l => {
    document.getElementById('legend-' + l)?.addEventListener('click', () => toggleProfileLine(l));
  });

  ['bars','sankey'].forEach(v => {
    document.getElementById('ov-btn-view-' + v)?.addEventListener('click', () => setOverviewViewType(v));
  });

  ['day','week','month'].forEach(m => {
    document.getElementById('ov-btn-' + m)?.addEventListener('click', () => setOverviewMode(m));
    document.getElementById('sim-btn-' + m)?.addEventListener('click', () => setSimMode(m));
  });

  ['energy','cost','savings'].forEach(m => {
    document.getElementById('ov-btn-' + m)?.addEventListener('click', () => setOverviewMetric(m));
  });

  ['year','month','week','day'].forEach(i => {
    document.getElementById('sk-btn-' + i)?.addEventListener('click', () => setSankeyInterval(i));
  });

  document.getElementById('sk-nav-prev')?.addEventListener('click', () => navigateSankey(-1));
  document.getElementById('sk-nav-next')?.addEventListener('click', () => navigateSankey(1));

  document.getElementById('sim-back-btn')?.addEventListener('click', () => {
    appStore.setState({simDrillDay: null});
    renderSimChart();
  });

  document.getElementById('hdr-fixed-net-energy')?.addEventListener('click', () => toggleTableDetail('hdr-fixed-net-energy', 'fixed-net-detail'));
  document.getElementById('hdr-fixed-vaste-lasten')?.addEventListener('click', () => toggleTableDetail('hdr-fixed-vaste-lasten', 'fixed-lasten-detail'));
  document.getElementById('hdr-dyn-net-energy')?.addEventListener('click', () => toggleTableDetail('hdr-dyn-net-energy', 'dyn-net-detail'));
  document.getElementById('tbl-dyn-afname-row')?.addEventListener('click', (e) => {
    toggleAfnameDetail();
    e.stopPropagation();
  });
  document.getElementById('hdr-dyn-vaste-lasten')?.addEventListener('click', () => toggleTableDetail('hdr-dyn-vaste-lasten', 'dyn-lasten-detail'));

  document.getElementById('btn-download-csv')?.addEventListener('click', downloadDataWithPrices);
  // --- End Dynamic Bindings ---

  // Wegklik-knoppen voor uitleg/waarschuwingen adviseren
  initDismissHandlers();

  // Listen for changes to the Home Assistant sensor selectors for auto-fetch/collapse
  ["sel-imp1", "sel-imp2", "sel-exp1", "sel-exp2"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", checkHAAutoImportAndCollapse);
  });
}

let haAutoTimeout = null;
function checkHAAutoImportAndCollapse() {
  const imp1 = document.getElementById("sel-imp1")?.value;
  const imp2 = document.getElementById("sel-imp2")?.value;
  const exp1 = document.getElementById("sel-exp1")?.value;
  const exp2 = document.getElementById("sel-exp2")?.value;

  if (imp1 && imp2 && exp1 && exp2) {
    if (haAutoTimeout) clearTimeout(haAutoTimeout);
    haAutoTimeout = setTimeout(async () => {
      const statusEl = document.getElementById("ha-sync-status");
      if (statusEl) {
        statusEl.textContent = "Sensoren compleet. Data automatisch ophalen...";
        statusEl.style.color = "var(--accent-cyan)";
      }
      try {
        await handleHAImport();
      } catch (err) {
        console.error("Auto import failed:", err);
      }
    }, 1500);
  }
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
      appStore.setState({ energyData: expandDemoProfile(window.DEMO_PROFILE) });
      appStore.setState({ isDemoData: true });
      document.getElementById("data-status").textContent =
        `Voorbeelddata geladen — realistisch jaarprofiel (${Math.round(energyData.length / 24)} dagen) · koppel jouw HA voor je eigen data`;
      runSimulation();
      return;
    }
    // Fallback: lokaal p1_sample.json (eigen data, niet meegeleverd in de repo).
    const response = await fetch("p1_sample.json");
    if (!response.ok) throw new Error("Sample file missing");
    appStore.setState({ energyData: await response.json() });
    appStore.setState({ isDemoData: true });   // markeer als demo zodat de eerste upload deze vervangt
    document.getElementById("data-status").textContent = "Voorbeelddata geladen — koppel jouw HA voor persoonlijke data";
    runSimulation();
  } catch (error) {
    console.error("Failed to load demo data:", error);
    document.getElementById("data-status").textContent = "Upload je eigen P1 bestand om te starten";
  }
}

// Setup Modal: show CORS instructions dynamically

// ── "Hoe werkt het rekenmodel?"-uitleg per apparaat ──────────────────────────
// Beschrijft exact wat _simulateCore() per uur doet, in mensentaal. Voor de accu
// worden alle drie de modi uitgelegd; de actieve modus wordt gemarkeerd.

// Korte inline-hint onder de accu-modus-dropdown (zonder de uitleg-modal te openen).
function updateBatModeHint() {
  const el = document.getElementById("bat-mode-hint");
  if (!el) return;
  const mode = document.getElementById("bat-mode")?.value || "zelf";
  const hints = {
    zelf: `Alléén zon opslaan en ontladen voor eigen verbruik — robuust en voorspelbaar.`,
    kosten: `Laadt óók goedkoop van het net, maar alleen voor eigen verbruik (geen teruglevering).`,
    winst: `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Onder bruto-EB (2027) levert teruglevering minder op dan zelfverbruik, dus op normale prijzen komt dit vrijwel gelijk uit met "Kostenbewust". Echt voordeel pas bij flinke prijspieken.`,
  };
  el.innerHTML = hints[mode] || "";
  el.style.display = el.innerHTML ? "block" : "none";
}
function copySetupSnippet() {
  const origin = window.location.origin;
  const snippet = `http:\n  cors_allowed_origins:\n    - ${origin}`;
  navigator.clipboard.writeText(snippet).then(() => {
    const btn = document.getElementById("copy-snippet-btn");
    btn.textContent = "Gekopieerd!";
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

  // Auto-collapse the upload panel after a timeout
  setTimeout(() => {
    const uploadPanel = document.getElementById("upload-panel");
    if (uploadPanel) uploadPanel.classList.add("collapsed");
  }, 1500);
}

function processFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    document.getElementById("data-status").textContent = "Bezig met verwerken…";

    reader.onload = async function (event) {
      try {
        let parsed = [];
        if (file.name.endsWith(".json")) {
          const raw = JSON.parse(event.target.result);
          if (Array.isArray(raw) && raw[0]?.timestamp !== undefined) {
            parsed = raw;
          } else if (Array.isArray(raw) && raw[0]?.entity_id !== undefined) {
            parsed = parseHAStatisticsJSON(raw);
          } else {
            throw new Error("Onbekend JSON-formaat. Gebruik een HA statistieken export of onze eigen export.");
          }
        } else if (file.name.endsWith(".csv")) {
          parsed = await parseAutoCSVAsync(event.target.result);
        } else {
          throw new Error("Ongeldig bestandstype. Selecteer een .json of .csv bestand.");
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Geen geldige P1-stroomgegevens gevonden. Controleer of het bestand import/export sensor data bevat.");
        }

        if (isDemoData) { energyData = []; isDemoData = false; }

        const merged = new Map();
        for (const r of energyData) merged.set(r.timestamp, r);
        for (const r of parsed) merged.set(r.timestamp, r);
        
        const oldUntangle = energyData.untangle;
        const sorted = Array.from(merged.values())
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        sorted.untangle = parsed.untangle || oldUntangle;
        
        appStore.setState({ energyData: sorted });

        const span = energyData.length > 0
          ? ` (${new Date(energyData[0].timestamp).toLocaleDateString("nl-NL")} t/m ${new Date(energyData[energyData.length - 1].timestamp).toLocaleDateString("nl-NL")})`
          : "";
        document.getElementById("data-status").innerHTML =
          `${ICON_CHECK} <span>${file.name} — ${parsed.length} records · ${energyData.length} totaal${span}</span>`;
        
        const untangle = energyData.untangle || { active: false };
        updateDigitalTwinBanner(untangle);
        
        runSimulation();
      } catch (error) {
        // Door de gebruiker geannuleerde koppelmodal is geen fout → stille, nette reset.
        if (error && /geannuleerd/i.test(error.message || "")) {
          document.getElementById("data-status").textContent = "Koppeling geannuleerd.";
        } else {
          console.error("Parse error:", error);
          showUploadError(error.message);
        }
      } finally {
        resolve();
      }
    };
    reader.onerror = () => { showUploadError("Bestand kon niet gelezen worden."); resolve(); };
    reader.readAsText(file);
  });
}

// Slimme eerste gok voor de sensor→rol-koppeling op basis van de entity_id-namen (NL+EN).
// Alles is in de koppelmodal nog aanpasbaar; dit bespaart de gebruiker alleen handwerk.
function guessRolesFromEntities(entities) {
  const find = (...pats) => entities.find(e => {
    const s = e.toLowerCase();
    return pats.some(p => s.includes(p));
  }) || "";
  return {
    imp1: find("import_tariff_1", "import_t1", "afname_tarief_1", "afname_t1", "verbruik_piek"),
    imp2: find("import_tariff_2", "import_t2", "afname_tarief_2", "afname_t2", "verbruik_dal"),
    exp1: find("export_tariff_1", "export_t1", "teruglevering_tariff_1", "teruglever_t1"),
    exp2: find("export_tariff_2", "export_t2", "teruglevering_tariff_2", "teruglever_t2"),
    solar: find("solar", "_pv", "zon", "opwek", "envoy", "inverter", "omvormer"),
    ev: find("laadpaal", "wallbox", "charger", "myenergi", "zappi", "wallbox"),
    hp: find("warmtepomp", "heatpump", "altherma", "nibe", "compressor"),
    batIn: find("aggr_charge", "_charge", "laden", "bat_in", "battery_charge"),
    batOut: find("aggr_discharge", "discharge", "ontladen", "bat_out", "battery_discharge"),
  };
}

async function parseAutoCSVAsync(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV is leeg of heeft slechts één rij.");

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim());

  if (headers[0].toLowerCase() === "entity_id" &&
    headers[1].toLowerCase() === "type" &&
    headers[2].toLowerCase() === "unit") {
    return await parseHAStatisticsWideCSVAsync(lines, sep, headers, showCsvMapModal);
  }

  if (headers.some(h => ["timestamp", "datetime", "datum", "date"].includes(h.toLowerCase()))) {
    return parseLongCSV(lines, sep, headers);
  }

  if (headers[0].toLowerCase() === "entity_id" &&
    headers[1].toLowerCase() === "state" &&
    headers[2].toLowerCase() === "last_changed") {
    // Lange HA-historie-export (entity_id,state,last_changed): de kolommen dragen geen
    // rol-info. Laat de gebruiker de sensoren handmatig koppelen — net als bij de
    // HA-koppeling en de brede-CSV-import. Voorheen viel dit pad stil terug op DEMO_ROLEMAP
    // (demo-sensornamen) → bij afwijkende sensornamen kwam er niets binnen.
    const entities = [...new Set(lines.slice(1)
      .map(l => l.split(sep)[0]?.trim()).filter(Boolean))];
    if (entities.length === 0) throw new Error("Geen sensoren (entity_id) gevonden in de CSV.");

    const guesses = guessRolesFromEntities(entities);
    // Eerdere koppeling (bijv. van een HA-import) als startpunt, indien de sensoren matchen.
    if (_lastRoleMap) for (const role of Object.keys(guesses)) {
      if (_lastRoleMap[role] && entities.includes(_lastRoleMap[role])) guesses[role] = _lastRoleMap[role];
    }

    const selection = await showCsvMapModal(entities, guesses);
    // selection = { imp1, imp2, exp1, exp2, solar, ev, hp, batIn, batOut } (rol → entity_id).
    // Long-format CSV draagt geen eenheid → default kWh (gangbaar voor P1/energie-sensoren).
    const roleMap = {
      ...selection,
      solarUnit: "kWh", evUnit: "kWh", hpUnit: "kWh", batInUnit: "kWh", batOutUnit: "kWh",
    };
    appStore.setState({ _lastRoleMap: roleMap });
    return parseHAHistoryExportCSV(lines, sep, headers, roleMap, digitalTwinEnabled);
  }

  throw new Error("CSV-formaat niet herkend.");
}

// ─── Parser for long/tidy CSV format ────────────────────────────────────────
// Expected columns: timestamp, import_t1, import_t2, export_t1, export_t2

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
      `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Pagina geopend als bestand. Start een lokale server:<br>` +
      `<code style="display:block;margin:0.3rem 0;padding:0.3rem 0.5rem;background:rgba(0,0,0,0.4);border-radius:4px;">python3 -m http.server 8080</code>` +
      `Voeg <strong>http://localhost:8080</strong> toe aan <code>cors_allowed_origins</code> in HA.`;
    statusEl.style.color = "var(--accent-orange)";
    return;
  }

  let cleanUrl = urlInput.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(cleanUrl)) {
    if (window.location.protocol === "https:") {
      statusEl.innerHTML = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <strong>Ongeldige URL:</strong> Geef een volledig adres op dat begint met <code>https://</code> (bijv. <code>https://ha.mydomain.nl</code>).`;
      statusEl.style.color = "var(--accent-orange)";
      return;
    } else {
      cleanUrl = "http://" + cleanUrl;
    }
  }

  // Mixed Content check: if hosted on HTTPS and HA URL starts with http://
  if (window.location.protocol === "https:" && cleanUrl.toLowerCase().startsWith("http://")) {
    statusEl.innerHTML =
      `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <strong>Mixed Content geblokkeerd!</strong><br>` +
      `Je bezoekt deze site via HTTPS, maar probeert te verbinden met een onbeveiligde Home Assistant (HTTP). De browser blokkeert dit om veiligheidsredenen.<br><br>` +
      `<strong>Oplossingen:</strong><br>` +
      `1. Gebruik een <code>https://</code> adres voor Home Assistant (bijv. via Nabu Casa of reverse proxy).<br>` +
      `2. Start de app lokaal via HTTP (bijv. via <code>npm start</code> of Python server) en open <a href="http://localhost:3000/energie/" style="color:var(--accent-cyan); font-weight:600;">http://localhost:3000/energie/</a>.<br>` +
      `3. Exporteer handmatig je data uit HA en upload het CSV/JSON bestand. <a href="#" onclick="showSetupModal('manual'); return false;" style="color:var(--accent-cyan); font-weight:600;">Gids →</a>`;
    statusEl.style.color = "var(--accent-orange)";
    return;
  }

  statusEl.textContent = "Verbinding testen…";
  statusEl.style.color = "var(--accent-cyan)";
  document.getElementById("ha-sensor-picker").style.display = "none";

  try {
    // Auth check
    let apiResp;
    try {
      apiResp = await fetch(`${cleanUrl}/api/`, {
        headers: { "Authorization": `Bearer ${tokenInput}` }
      });
    } catch {
      statusEl.innerHTML =
        `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-right:0.25rem;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Verbinding mislukt (CORS preflight geweigerd).<br>` +
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
        return `<option value="${s.id}" data-unit="${s.unit}"${s.id === selectedId ? " selected" : ""}>${label}${s.unavailable ? " [offline]" : ""}</option>`;
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
        (rec.length ? `<optgroup label="Aanbevolen (op basis van naam)">` + rec.map(opt).join("") + `</optgroup>` : "") +
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
    statusEl.innerHTML = `${ICON_CHECK} <span>Verbonden — ${kwhSensors.length} kWh sensoren${offlineNote}${whNote}. Kies de juiste P1 sensoren hieronder.</span>`;
    statusEl.style.color = "var(--accent-green)";
    document.getElementById("ha-sensor-picker").style.display = "block";
    
    // Do not auto-import on connect; user will press "Data ophalen" manually
    // checkHAAutoImportAndCollapse();

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
      `${s.id}${s.unavailable ? " [offline]" : ""}` +
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

    appStore.setState({ _lastHAStats: stats });
    appStore.setState({ _lastRoleMap: roleMap });
    appStore.setState({ energyData: processHAStatistics(stats, roleMap, digitalTwinEnabled) });
    appStore.setState({ isDemoData: false });   // echte HA-data: verdere uploads mergen erbij

    const untangle = energyData.untangle || { active: false };
    updateDigitalTwinBanner(untangle);

    statusEl.innerHTML = `${ICON_CHECK} <span>${energyData.length} uurrecords geladen · EPEX prijzen ophalen…</span>`;
    statusEl.style.color = "var(--accent-cyan)";

    // Fetch real EPEX prices for the loaded period in the background
    let successMsg = "";
    try {
      await fetchEPEXHistory(energyData[0].timestamp, energyData[energyData.length - 1].timestamp);
      successMsg = `${ICON_CHECK} <span>${energyData.length} uurrecords + ${epexHistory.size} echte EPEX-prijzen geladen (${days} dagen)</span>`;
    } catch (_) {
      successMsg = `${ICON_CHECK} <span>${energyData.length} uurrecords geladen (EPEX-prijzen niet beschikbaar)</span>`;
    }

    if (untangle.batterySensorSuspect) {
      statusEl.innerHTML = `<strong>${successMsg}</strong><br>` +
        `<span style="color:var(--accent-orange);font-size:0.78rem;">${ICON_WARN} <span>Batterij-sensoren controleren: ontladen > laden over de hele periode is fysiek onmogelijk. ` +
        `Kies sensoren die beide aan de net-/AC-zijde meten (of verwissel in/uit).</span></span>`;
    } else {
      statusEl.innerHTML = successMsg;
      statusEl.style.color = "var(--accent-green)";
    }

    document.getElementById("data-status").textContent =
      `HA statistieken — ${energyData.length} uurrecords (${days}d)`;
    localStorage.setItem("ha_url", urlInput);
    localStorage.setItem("ha_token", tokenInput);
    runSimulation();

    // Auto-collapse the Home Assistant card after a timeout if there is no warning
    if (!untangle.batterySensorSuspect) {
      setTimeout(() => {
        const haCard = document.getElementById("ha-card");
        if (haCard) haCard.classList.add("collapsed");
      }, 1500);
    }

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
  appStore.setState({ digitalTwinEnabled: enabled });
  if (!_lastHAStats || !_lastRoleMap) return;
  appStore.setState({ energyData: processHAStatistics(_lastHAStats, _lastRoleMap, digitalTwinEnabled) });
  appStore.setState({ isDemoData: false });
  const untangle = energyData.untangle || { active: false };
  updateDigitalTwinBanner(untangle);
  appStore.setState({ fullYearStamp: "" });   // invalideer cache zodat jaarprojectie opnieuw gebouwd wordt
  runSimulation();
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
    let eb = liveEnergyTax || 0.11084;
    let avgOpslag = parseFloat(document.getElementById("dynamic-markup")?.value || "0.024");

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
      eb = prices[0].energyTaxPrice;
      appStore.setState({ liveEnergyTax: eb });
      setSlider("energy-tax", eb);   // schuif = single source of truth voor runSimulation

      // Average inkoop opslag (constant at Frank, but average across hours)
      avgOpslag = prices.reduce((s, p) => s + p.sourcingMarkupPrice, 0) / prices.length;

      // Update sliders
      setSlider("dynamic-markup", avgOpslag.toFixed(4));

      // Store today's Frank prices in epexHistory (prices incl BTW excl EB+opslag = market+tax)
      prices.forEach(p => {
        const dt = new Date(p.from);
        const marketInclBtw = p.marketPrice + p.marketPriceTax;
        epexHistory.set(epexKey(dt), marketInclBtw);
      });

      status.innerHTML = `${ICON_CHECK} <span>Frank: EB = €${eb.toFixed(5)}/kWh · opslag = €${avgOpslag.toFixed(4)}/kWh · ${prices.length} uurprijzen geladen</span>`;
    }

    // ── 2. EnergyZero: historische EPEX voor geladen energieperiode ──────────
    if (energyData.length > 0) {
      status.innerHTML = status.innerHTML.replace("</span>", "") + " · historische EPEX ophalen…</span>";
      const fromISO = energyData[0].timestamp;
      const tillISO = energyData[energyData.length - 1].timestamp;
      await fetchEPEXHistory(fromISO, tillISO);
      status.innerHTML = `${ICON_CHECK} <span>Frank: EB = €${eb.toFixed(5)}/kWh · opslag = €${avgOpslag.toFixed(4)}/kWh · ${prices.length} uurprijzen geladen · ${epexHistory.size} uurprijzen totaal</span>`;
    }

    status.style.color = "var(--accent-green)";
    runSimulation(); // herbereken met actuele tarieven

  } catch (err) {
    console.error("fetchTarieven:", err);
    status.innerHTML = `${ICON_WARN} <span>Ophalen mislukt: ${err.message}</span>`;
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
  appStore.setState({ energyData: [...byHour.keys()].sort((a, b) => a - b).map(ms => byHour.get(ms)) });

  dataQuality = {
    expectedHours, realHours, interpHours, profileHours,
    completenessPct: expectedHours > 0 ? Math.round(realHours / expectedHours * 100) : 100,
    largePeriods,
    spanFrom: new Date(first).toISOString(), spanTo: new Date(last).toISOString(),
  };
  appStore.setState({ dataQualityDismissed: false });   // nieuwe import → samenvatting weer tonen
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
    appStore.setState({ fullYearData: null, yearScale: 1.0 });
    appStore.setState({ dataMeta: { mode: "none", synthesized: false, realDays: 0, realHours: 0, synthHours: 0, yearScale: 1 } });
    return;
  }

  // Cache-stempel: togglestand + lengte + eerste/laatste timestamp. Sliders → geen herbouw.
  const stamp = `${prognose}|${energyData.length}|${energyData[0].timestamp}|${energyData[energyData.length - 1].timestamp}`;
  if (stamp === fullYearStamp) return;
  appStore.setState({ fullYearStamp: stamp });

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
    appStore.setState({ fullYearData: null });
    appStore.setState({ yearScale: 8760 / realHoursTot });
    appStore.setState({ dataMeta: { mode: "full", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale } });
    return;
  }

  if (!prognose) {
    // Prognose UIT: geen synthese, gemeten periode lineair doorrekenen naar een jaar.
    appStore.setState({ fullYearData: null });
    appStore.setState({ yearScale: 8760 / realHoursTot });
    appStore.setState({ dataMeta: { mode: "linear", synthesized: false, realDays, realHours: realHoursTot, synthHours: 0, yearScale } });
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

  appStore.setState({ fullYearData: out });
  appStore.setState({ yearScale: 1.0 });   // de projectie is al exact 8760u — geen extra normalisatie
  const synthPct = (realHours + synthHours) > 0 ? synthHours / (realHours + synthHours) : 0;
  appStore.setState({ dataMeta: { mode: "seasonal", synthesized: true, realDays, realHours, synthHours, synthPct, yearScale: 1 } });
}

/**
 * Voert de simulatie uit over `energyData` met de gegeven configuratie.
 *
 * @param {object}  cfg  - Alle contract- en hardware-parameters (DOM-vrij, zie runSimulation).
 * @param {boolean} full - true  → bouw ook grafiekprofielen (hourlyProfile, perDayTotals, enz.)
 *                         false → geef alleen { fixedBill, dynBill } terug (snel pad voor hw-deltas).
 * @returns {object} Simulatieresultaat.
 */
// Groepeert de uurreeks per lokale dag (dayKey → rows[]). Gememoïseerd op de identiteit
// van de bron-array: runSimulation() roept _simulateCore 5× met dezelfde simData aan, dus
// zonder cache wordt deze 8760-pass 5× herhaald. Een nieuwe dataset (clean/jaarprojectie,
// of het validatie-harnas dat per scenario een verse array zet) is een nieuwe referentie
// → de cache invalideert vanzelf. Geen gedragswijziging, alleen minder werk.


// Verzamelt de dataset + marktparameters die _simulateCore nodig heeft tot één object,
// zodat de engine zelf géén module-globals meer leest (testbaar, en klaar voor een
// Web Worker). Wordt als default gebruikt zodat bestaande aanroepers (en het validatie-
// harnas, dat deze globals zet) onveranderd blijven werken.




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
    dynamicExportMarkup: parseFloat(document.getElementById("dynamic-export-markup")?.value || 0.0),
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
    batCost: parseFloat(document.getElementById("bat-cost")?.value || 450),
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
  const markupBtw = cfg.dynamicMarkup;   // slider is incl. BTW (Pad 1)
  const exportMarkup = (cfg.dynamicExportMarkup ?? 0.0);   // slider is incl. BTW (Pad 1)

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
    const dynCost = imp * allIn - exp * ((spot / 1.21) - exportMarkup);                  // netto kosten dat uur (dynamisch)
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

const BATTERY_SWEEP_CAPS = [2, 5, 10, 15, 20];   // kWh
const BATTERY_COST_PER_KWH = 450;                // €/kWh investering (industriestandaard)
// ── ROI-realisme: degradatie + levensduur ────────────────────────────────────
// Een LFP-thuisaccu degradeert ~2%/jaar (≈80% restcapaciteit na ~15 jaar). De
// terugverdientijd op basis van het 1e-jaars-voordeel is daardoor te optimistisch:
// over de levensduur levert de accu gemiddeld minder. We schalen het jaarvoordeel met
// de gemiddelde bruikbare capaciteit over de levensduur (1 − degr×levensduur/2 ≈ 0,85)
// en markeren paybacks die de levensduur overschrijden als "niet terugverdiend".
const BATTERY_LIFETIME_YEARS = 15;
const BATTERY_DEGRADATION_PER_YEAR = 0.02;
const BATTERY_AVG_CAPACITY_FACTOR = 1 - (BATTERY_DEGRADATION_PER_YEAR * BATTERY_LIFETIME_YEARS) / 2;   // ≈ 0,85

function optimizeBatterySize() {
  const resEl = document.getElementById("battery-optimization-result");
  if (!resEl) return;
  if (energyData.length === 0) {
    resEl.style.display = "";
    resEl.innerHTML = "Laad eerst data om de optimale accu te berekenen.";
    return;
  }

  // EB + jaarprojectie synchroon met de hoofdsimulatie (read-only voor activeSimulation).
  // De engine leest de EB uit de appStore (buildSimContext) — dus via setState, niet via
  // een bare mirror-assignment (zie B1-fix: anders haalt de schuif de engine nooit).
  const ebEl = document.getElementById("energy-tax");
  if (ebEl) appStore.setState({ liveEnergyTax: parseFloat(ebEl.value) });
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
    const extra = baselineDyn - r.dynBill;      // ROI dynamic (1e-jaars meerwaarde)
    const extraFix = baselineFix - r.fixedBill; // ROI fixed (zelfconsumptie)
    const cost = cap * baseCfg.batCost;
    // Degradatie-gecorrigeerde terugverdientijd: het jaarvoordeel daalt mee met de
    // capaciteit, dus rekenen we met het levensduur-gemiddelde (~85% van jaar 1).
    const effExtra = extra * BATTERY_AVG_CAPACITY_FACTOR;
    const effExtraFix = extraFix * BATTERY_AVG_CAPACITY_FACTOR;
    const payback = effExtra > 0 ? cost / effExtra : Infinity;
    const paybackFix = effExtraFix > 0 ? cost / effExtraFix : Infinity;
    return { cap, power: cap * 0.5, dynBill: r.dynBill, fixedBill: r.fixedBill, extra, extraFix, cost, payback, paybackFix };
  });

  window.lastOptResults = { rows, noBat };
  const currentType = window.optContractType || "dyn";
  renderBatteryOptimization(rows, currentType, resEl);
}

function renderBatteryOptimization(rows, type, resEl) {
  const eur = v => (v >= 0 ? "" : "−") + "€" + Math.abs(v).toFixed(0);
  const eurKwh = v => (v >= 0 ? "" : "−") + "€" + Math.abs(v).toFixed(2);
  const yrs = p => Number.isFinite(p) ? `${p.toFixed(1)} jr` : "—";
  const costEl = document.getElementById("bat-cost");
  const currentCostPerKwh = costEl ? parseFloat(costEl.value) : 450;

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
    const star = sweet ? ` ${ICON_STAR}` : "";
    const extraVal = type === "dyn" ? r.extra : r.extraFix;
    const paybackVal = type === "dyn" ? r.payback : r.paybackFix;
    const perKwh = r.cap > 0 ? extraVal / r.cap : 0;
    return `<tr style="${bg}">
      <td style="padding:0.25rem 0.4rem;">${r.cap} kWh${star}</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${r.power.toFixed(1)} kW</td>
      <td style="padding:0.25rem 0.4rem;text-align:right;color:var(--accent-green);">${eur(extraVal)}/jr <span style="font-size:0.65rem;color:var(--text-muted);">(${eurKwh(perKwh)}/kWh)</span></td>
      <td style="padding:0.25rem 0.4rem;text-align:right;">${yrs(paybackVal)}</td>
    </tr>`;
  }).join("");

  const sweet = rows[sweetIdx];
  const sweetPayback = sweet ? (type === "dyn" ? sweet.payback : sweet.paybackFix) : Infinity;
  const sweetExtra = sweet ? (type === "dyn" ? sweet.extra : sweet.extraFix) : 0;
  const contractLabel = type === "dyn" ? "dynamisch" : "vast";

  // Payback is degradatie-gecorrigeerd (≈85% capaciteit over de levensduur). Overschrijdt
  // hij de verwachte levensduur, dan verdient de accu zichzelf realistisch gezien niet terug.
  const beyondLife = Number.isFinite(sweetPayback) && sweetPayback > BATTERY_LIFETIME_YEARS;
  const verdict = sweet && Number.isFinite(sweetPayback)
    ? `<strong style="color:var(--accent-green);">Sweet spot: ${sweet.cap} kWh</strong> — accu-meerwaarde ${eur(sweetExtra)}/jaar, terugverdiend in ${yrs(sweetPayback)} (bij €${currentCostPerKwh}/kWh).`
      + (beyondLife ? ` <span style="color:var(--accent-orange);">⚠ Dat is lánger dan de verwachte levensduur (~${BATTERY_LIFETIME_YEARS} jr) — de accu verdient zichzelf binnen z'n leven waarschijnlijk niet terug.</span>` : "")
    : `Binnen dit scenario verdient geen enkele accu zichzelf terug op een ${contractLabel} contract (meerwaarde ≤ €0/jaar).`;

  const tabDynActive = type === "dyn" ? "active" : "";
  const tabFixActive = type === "fix" ? "active" : "";

  resEl.style.display = "";
  resEl.innerHTML = `
    <div style="display:flex; justify-content:center; gap:0.5rem; margin-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:0.6rem;">
      <button type="button" class="btn-toggle ${tabDynActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" onclick="window.setOptContract('dyn')">Dynamisch contract</button>
      <button type="button" class="btn-toggle ${tabFixActive}" style="font-size:0.72rem; padding:0.25rem 0.5rem; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main);" onclick="window.setOptContract('fix')">Vast contract</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
      <thead><tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.12);">
        <th style="padding:0.25rem 0.4rem;text-align:left;">Accu</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Vermogen</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Meerwaarde / kWh</th>
        <th style="padding:0.25rem 0.4rem;text-align:right;">Terugverdientijd</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div style="margin-top: 0.6rem; font-size: 0.72rem; line-height: 1.5; color: var(--text-main); margin-bottom:0.5rem;">
      ${verdict}
    </div>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.45rem;line-height:1.45;">
      ${ICON_LIGHTBULB} <strong>Let op:</strong> De besparingen worden berekend ten opzichte van dezelfde opstelling zónder thuisbatterij.
      ${type === "dyn" 
        ? "Bij een <strong>dynamisch contract</strong> laadt de batterij op bij zonnestroom en bij goedkope uren van het net, en levert/ontlaadt bij dure uren."
        : "Bij een <strong>vast contract</strong> doet de batterij uitsluitend aan zelfconsumptie (zonne-overschot opslaan en 's avonds/nachts gebruiken)."}
    </p>
    <p style="font-size:0.66rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.45;">
      Investering €${currentCostPerKwh}/kWh (indicatief). Vermogen = 0,5× capaciteit.
      Terugverdientijd is gecorrigeerd voor ~${(BATTERY_DEGRADATION_PER_YEAR * 100).toFixed(0)}%/jaar degradatie
      (gemiddeld ~${(BATTERY_AVG_CAPACITY_FACTOR * 100).toFixed(0)}% capaciteit over ${BATTERY_LIFETIME_YEARS} jaar).
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
  // Via appStore.setState: de engine (buildSimContext) leest EB uit de store, niet uit
  // de lokale mirror. Een bare `liveEnergyTax = …` zou de store stil laten → schuif dood.
  const ebEl = document.getElementById("energy-tax");
  if (ebEl) appStore.setState({ liveEnergyTax: parseFloat(ebEl.value) });

  // ── Importcheck: opschonen + gaten vullen (idempotent per geladen dataset) ──
  ensureCleanData();

  // ── Jaarprojectie (8760u) opbouwen/cachen vóór de simulatie ──────────────
  ensureFullYearData();

  // ── Fallback kalibreren op opgehaalde EPEX-historie (vult geprojecteerde uren) ──
  buildCalibratedProfile();

  // ── Alle DOM-reads EENMALIG voor de loop ─────────────────────────────────
  const cfg = readSimConfig();

  // Dataset + marktparameters één keer vastleggen en aan alle 5 runs meegeven (de globals
  // zijn hierboven al gezet door ensureFullYearData/buildCalibratedProfile/liveEnergyTax).
  const ctx = buildSimContext();

  // ── Hoofdsimulatie + hardware-deltas (5 x _simulateCore) ─────────────────
  const sim = _simulateCore(cfg, true, ctx);

  const base0 = {
    ...cfg,
    hasHeatPump: false, hpWinterBaseload: 0,
    hasEv: false, evWeeklyDist: 0, evConsumption: 0, evSolarMatch: false,
    hasBattery: false, batCapacity: 0, batPower: 0, batEfficiency: 1, batMode: "zelf",
  };
  const base = _simulateCore(base0, false, ctx);
  const withHp = _simulateCore({ ...base0, hasHeatPump: true, hpWinterBaseload: cfg.hpWinterBaseload }, false, ctx);
  const withEv = _simulateCore({ ...base0, hasEv: true, evWeeklyDist: cfg.evWeeklyDist, evConsumption: cfg.evConsumption, evSolarMatch: cfg.evSolarMatch }, false, ctx);
  const withBat = _simulateCore({ ...base0, hasBattery: true, batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency, batMode: cfg.batMode }, false, ctx);

  // ── activeSimulation bijwerken ────────────────────────────────────────────
  appStore.setState({ activeSimulation: {
    ...sim,
    hwEffects: {
      base,
      hp: { fixed: withHp.fixedBill - base.fixedBill, dyn: withHp.dynBill - base.dynBill, enabled: cfg.hasHeatPump, cfg: { hpWinterBaseload: cfg.hpWinterBaseload } },
      ev: { fixed: withEv.fixedBill - base.fixedBill, dyn: withEv.dynBill - base.dynBill, enabled: cfg.hasEv, cfg: { evDist: cfg.evWeeklyDist, evCons: cfg.evConsumption, evSolar: cfg.evSolarMatch } },
      bat: { fixed: withBat.fixedBill - base.fixedBill, dyn: withBat.dynBill - base.dynBill, enabled: cfg.hasBattery, cfg: { batCapacity: cfg.batCapacity, batPower: cfg.batPower, batEfficiency: cfg.batEfficiency * 100, batMode: cfg.batMode } },
    }
  } });

  // ── EPEX-noot in tabel zetten ─────────────────────────────────────────────
  const pct = sim.epexPct;
  const taxEl = document.getElementById("tbl-dyn-tax-vol");
  if (taxEl) {
    taxEl.title = pct === 100 ? "100% echte EPEX uurprijzen"
      : pct > 0 ? `${pct}% echte EPEX, ${100 - pct}% seizoensprofiel`
        : "Geen echte EPEX — klik 'Ophalen' voor actuele tarieven";
  }

  updateUIElements();
  renderChart();
  renderOverviewChart();
  renderMonthlyChart();
  renderSimChart();
  renderHwChart();
  renderDynPriceExample();
  renderDataQualityBanner();

  // Recalculate ROI Sweet Spot if currently displayed
  const resEl = document.getElementById("battery-optimization-result");
  if (resEl && resEl.style.display !== "none") {
    optimizeBatterySize();
  }
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
  const opslagKaal = markup / 1.21;        // slider is incl. BTW (Pad 1) → kale opslag voor de uitsplitsing
  const btw = (kaleEpex + opslagKaal) * 0.21;
  const allIn = spot + markup + eb;        // Pad 1: opslag is incl. BTW → rechtstreeks optellen
  const pct = activeSimulation?.epexPct ?? 0;
  const bron = pct === 100 ? "echte EPEX" : pct > 0 ? `${pct}% echte EPEX` : "geschatte prijs";

  const part = (val, lbl) => `<span>€${val.toFixed(3)}</span> <span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);">${lbl}</span>`;
  box.innerHTML =
    `${part(kaleEpex, "EPEX")} + ${part(opslagKaal, "opslag")} + ${part(btw, "BTW")} + ${part(eb, "EB")} = ` +
    `<span style="color:var(--accent-cyan);font-weight:700;">€${allIn.toFixed(3)}/kWh</span>` +
    `<span style="color:var(--text-muted);font-size:0.72rem;font-family:var(--font-body);"> &nbsp;(voorbeeld 18:00 · ${bron})</span>`;
}

// Update the DOM Elements with calculated values
function updateUIElements() {
  const sim = activeSimulation;

  setChartsDependencies({
    activeSimulation,
    fullYearData,
    energyData,
    dataMeta
  });

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
  document.getElementById("stat-savings-text").textContent = positive ? "Besparing per jaar" : "Extra kosten per jaar";
  const subEl = document.getElementById("stat-savings-sub");
  subEl.textContent = positive ? "▲ in het voordeel van dynamisch" : "▼ vast contract is goedkoper";
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
  document.getElementById("tbl-fixed-vtk-cost").textContent = `€ ${sim.fixedFeedInFee.toFixed(2)}`;

  const fixedNetCost = sim.fixedImportCost - sim.fixedFeedInCredit + sim.fixedFeedInFee;
  document.getElementById("tbl-fixed-net-energy").textContent = `€ ${fixedNetCost.toFixed(2)}`;

  const fixedVasteLasten = sim.fixedSubscription - (sim.taxRebate ?? 0) + (sim.gridFees ?? 0);
  document.getElementById("tbl-fixed-vaste-lasten").textContent = `€ ${fixedVasteLasten.toFixed(2)}`;

  document.getElementById("tbl-fixed-subcost").textContent = `€ ${sim.fixedSubscription.toFixed(2)}`;
  document.getElementById("tbl-fixed-rebate").textContent = `− € ${(sim.taxRebate ?? 0).toFixed(2)}`;
  document.getElementById("tbl-fixed-grid-fees").textContent = `€ ${(sim.gridFees ?? 0).toFixed(2)}`;
  document.getElementById("tbl-fixed-total").textContent = `€ ${sim.fixedTotalBill.toFixed(2)}`;

  // Dynamic breakdown table
  const dynNetCost = sim.dynamicRawImportCost - sim.dynamicRawExportRevenue + sim.dynamicNetTax;
  document.getElementById("tbl-dyn-net-cost-header").textContent = `€ ${dynNetCost.toFixed(2)}`;

  document.getElementById("tbl-dyn-imp-kwh").innerHTML = `${sim.totalImportKwh.toFixed(1)} kWh${synthTag}`;
  document.getElementById("tbl-dyn-raw-imp").textContent = `€ ${sim.dynamicRawImportCost.toFixed(2)}`;
  document.getElementById("tbl-dyn-exp-kwh").textContent = `${sim.totalExportKwh.toFixed(1)} kWh`;
  // Export revenue: negative = you pay during negative EPEX hours (solar glut)
  const expRev = sim.dynamicRawExportRevenue;
  const expEl = document.getElementById("tbl-dyn-raw-exp");
  if (expRev >= 0) {
    expEl.textContent = `− € ${expRev.toFixed(2)}`;
  } else {
    expEl.innerHTML = `+ € ${Math.abs(expRev).toFixed(2)} <svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);margin-left:0.35rem;vertical-align:-0.12em;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  }
  expEl.style.color = expRev >= 0 ? "var(--accent-green)" : "var(--accent-orange)";
  expEl.title = expRev < 0 ? "Negatief: export tijdens uren met negatieve EPEX-prijs kost geld" : "";
  document.getElementById("tbl-dyn-net-kwh").textContent = `${sim.netDynamicKwh.toFixed(1)} kWh`;
  document.getElementById("tbl-dyn-net-cost").textContent = `€ ${dynNetCost.toFixed(2)}`;

  const dynVasteLasten = sim.dynamicSubscription - (sim.taxRebate ?? 0) + (sim.gridFees ?? 0);
  document.getElementById("tbl-dyn-vaste-lasten").textContent = `€ ${dynVasteLasten.toFixed(2)}`;

  // EB 2027: over BRUTO afname van het net (geen saldering) — volume = totale import,
  // zodat volume × tarief exact gelijk is aan het getoonde bedrag.
  document.getElementById("tbl-dyn-tax-vol").textContent = `${sim.totalImportKwh.toFixed(1)} kWh × €${liveEnergyTax.toFixed(5)}`;
  document.getElementById("tbl-dyn-tax").textContent = `€ ${sim.dynamicNetTax.toFixed(2)}`;
  document.getElementById("tbl-dyn-subcost").textContent = `€ ${sim.dynamicSubscription.toFixed(2)}`;
  document.getElementById("tbl-dyn-rebate").textContent = `− € ${(sim.taxRebate ?? 0).toFixed(2)}`;
  document.getElementById("tbl-dyn-grid-fees").textContent = `€ ${(sim.gridFees ?? 0).toFixed(2)}`;
  document.getElementById("tbl-dyn-total").textContent = `€ ${sim.dynamicTotalBill.toFixed(2)}`;
}

// Custom responsive SVG Chart Renderer

// Window resizing
window.addEventListener("resize", () => { renderChart(); renderOverviewChart(); renderMonthlyChart(); renderSimChart(); renderHwChart(); });

// ── Sim chart mode/drill-down controls ───────────────────────────────────────
function setSimMode(mode) {
  appStore.setState({ simMode: mode });
  appStore.setState({ simDrillDay: null });
  document.getElementById("sim-btn-day").className = mode === "day" ? "btn-primary" : "btn-secondary";
  document.getElementById("sim-btn-week").className = mode === "week" ? "btn-primary" : "btn-secondary";
  document.getElementById("sim-btn-day").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  document.getElementById("sim-btn-week").style.cssText = "padding:0.3rem 0.7rem;font-size:0.75rem;";
  renderSimChart();
}



// ── Hardware effect chart ─────────────────────────────────────────────────────
// ── Afname detail toggle ──────────────────────────────────────────────────────
let afnameDetailOpen = false;

// Maandelijkse kostenvergelijking: aggregeert perDayTotals (energiekosten excl.
// vastrecht) per kalendermaand en tekent 12 gegroepeerde staafparen (vast vs dynamisch).



function setOverviewMode(mode) {
  appStore.setState({ overviewMode: mode });
  ["day", "week", "month"].forEach(m => {
    const btn = document.getElementById(`ov-btn-${m}`);
    if (btn) btn.classList.toggle("active", m === mode);
  });
  renderOverviewChart();
}

function setOverviewMetric(metric) {
  appStore.setState({ overviewMetric: metric });
  ["energy", "cost", "savings"].forEach(m => {
    const btn = document.getElementById(`ov-btn-${m}`);
    if (btn) btn.classList.toggle("active", m === metric);
  });
  renderOverviewChart();
}

function setOverviewViewType(type) {
  appStore.setState({ activeViewType: type });
  const btnBars = document.getElementById("ov-btn-view-bars");
  const btnSankey = document.getElementById("ov-btn-view-sankey");
  
  if (btnBars) btnBars.classList.toggle("active", type === "bars");
  if (btnSankey) btnSankey.classList.toggle("active", type === "sankey");
  
  const barControls = document.getElementById("bar-controls-row");
  const sankeyControls = document.getElementById("sankey-controls-row");
  const legends = document.getElementById("overview-legends");
  
  if (type === "bars") {
    if (barControls) barControls.style.display = "flex";
    if (sankeyControls) sankeyControls.style.display = "none";
    if (legends) legends.style.display = "flex";
    renderOverviewChart();
  } else {
    if (barControls) barControls.style.display = "none";
    if (sankeyControls) sankeyControls.style.display = "flex";
    if (legends) legends.style.display = "none";
    
    initSankeyPickers();
    renderSankeyDiagram();
  }
}

function setSankeyInterval(interval) {
  appStore.setState({ sankeyInterval: interval });
  ["year", "month", "week", "day"].forEach(i => {
    const btn = document.getElementById(`sk-btn-${i}`);
    if (btn) btn.classList.toggle("active", i === interval);
  });
  
  const periods = getUniqueSankeyPeriods();
  if (interval === "month") sankeyValue = periods.months[0] || "";
  else if (interval === "week") sankeyValue = periods.weeks[0] || "";
  else if (interval === "day") sankeyValue = periods.days[0] || "";
  else sankeyValue = "";
  
  initSankeyPickers();
  renderSankeyDiagram();
}

function setSankeyValue(val) {
  appStore.setState({ sankeyValue: val });
  renderSankeyDiagram();
}

function getUniqueSankeyPeriods() {
  const months = new Set();
  const weeks = new Set();
  const days = [];
  
  if (energyData && energyData.length > 0) {
    energyData.forEach(row => {
      const dayKey = row.timestamp.slice(0, 10);
      months.add(dayKey.slice(0, 7));
      weeks.add(isoWeek(dayKey));
      if (days.length === 0 || days[days.length - 1] !== dayKey) {
        days.push(dayKey);
      }
    });
  }
  
  return {
    months: Array.from(months).sort(),
    weeks: Array.from(weeks).sort(),
    days: days.sort()
  };
}

function initSankeyPickers() {
  const container = document.getElementById("sk-picker-container");
  if (!container) return;
  container.innerHTML = "";
  
  const periods = getUniqueSankeyPeriods();
  const prevBtn = document.getElementById("sk-nav-prev");
  const nextBtn = document.getElementById("sk-nav-next");
  
  if (sankeyInterval === "year") {
    container.innerHTML = `<span style="font-size:0.75rem; color:var(--text-main); font-weight:bold; padding:0.25rem 0.5rem;">Hele Jaar</span>`;
    appStore.setState({ sankeyValue: "" });
    if (prevBtn) prevBtn.style.display = "none";
    if (nextBtn) nextBtn.style.display = "none";
  } else if (sankeyInterval === "month") {
    if (prevBtn) prevBtn.style.display = "";
    if (nextBtn) nextBtn.style.display = "";
    
    const select = document.createElement("select");
    select.id = "sk-month-select";
    select.className = "ha-select";
    select.style.cssText = "padding:0.25rem 2rem 0.25rem 0.5rem; font-size:0.75rem; width:auto; height:28px; background-position: right 0.5rem center;";
    select.onchange = (e) => setSankeyValue(e.target.value);
    
    periods.months.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      const d = new Date(m + "-02T12:00:00Z");
      opt.textContent = d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
      select.appendChild(opt);
    });
    
    if (periods.months.length > 0) {
      if (!periods.months.includes(sankeyValue)) {
        appStore.setState({ sankeyValue: periods.months[0] });
      }
      select.value = sankeyValue;
    }
    container.appendChild(select);
    
  } else if (sankeyInterval === "week") {
    if (prevBtn) prevBtn.style.display = "";
    if (nextBtn) nextBtn.style.display = "";
    
    const select = document.createElement("select");
    select.id = "sk-week-select";
    select.className = "ha-select";
    select.style.cssText = "padding:0.25rem 2rem 0.25rem 0.5rem; font-size:0.75rem; width:auto; height:28px; background-position: right 0.5rem center;";
    select.onchange = (e) => setSankeyValue(e.target.value);
    
    periods.weeks.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = w.replace(/(\d{4})-W(\d+)/, (_, y, num) => `Week ${num}, ${y}`);
      select.appendChild(opt);
    });
    
    if (periods.weeks.length > 0) {
      if (!periods.weeks.includes(sankeyValue)) {
        appStore.setState({ sankeyValue: periods.weeks[0] });
      }
      select.value = sankeyValue;
    }
    container.appendChild(select);
    
  } else if (sankeyInterval === "day") {
    if (prevBtn) prevBtn.style.display = "";
    if (nextBtn) nextBtn.style.display = "";
    
    const input = document.createElement("input");
    input.type = "date";
    input.id = "sk-day-picker";
    input.style.cssText = "background:rgba(0,0,0,0.3); border:1px solid var(--border-color); border-radius:6px; padding:0.25rem 0.5rem; color:var(--text-main); font-size:0.75rem; font-family:var(--font-body); height:28px; outline:none;";
    input.onchange = (e) => setSankeyValue(e.target.value);
    
    if (periods.days.length > 0) {
      input.min = periods.days[0];
      input.max = periods.days[periods.days.length - 1];
      if (!periods.days.includes(sankeyValue)) {
        appStore.setState({ sankeyValue: periods.days[0] });
      }
      input.value = sankeyValue;
    }
    container.appendChild(input);
  }
}

function navigateSankey(direction) {
  const periods = getUniqueSankeyPeriods();
  let list = [];
  if (sankeyInterval === "month") list = periods.months;
  else if (sankeyInterval === "week") list = periods.weeks;
  else if (sankeyInterval === "day") list = periods.days;
  
  if (list.length === 0) return;
  
  let idx = list.indexOf(sankeyValue);
  if (idx === -1) {
    appStore.setState({ sankeyValue: list[0] });
  } else {
    idx += direction;
    if (idx < 0) idx = 0;
    if (idx >= list.length) idx = list.length - 1;
    appStore.setState({ sankeyValue: list[idx] });
  }
  
  const selectMonth = document.getElementById("sk-month-select");
  const selectWeek = document.getElementById("sk-week-select");
  const pickerDay = document.getElementById("sk-day-picker");
  
  if (selectMonth) selectMonth.value = sankeyValue;
  else if (selectWeek) selectWeek.value = sankeyValue;
  else if (pickerDay) pickerDay.value = sankeyValue;
  
  renderSankeyDiagram();
}

// ==========================================
// EXPORTS FOR TEST HARNESS
// ==========================================
if (typeof window !== "undefined") {
      window._simulateCore = _simulateCore;
  window.getFallbackSpot = getFallbackSpot;
  window.EPEX_PROFILES = EPEX_PROFILES;
  window.buildCalibratedProfile = buildCalibratedProfile;
  window.ensureCleanData = ensureCleanData;
  window.processHAStatistics = processHAStatistics;
  window.computeBillForConfig = computeBillForConfig;
  window.runSimulation = runSimulation;
  window.parseHAHistoryExportCSV = parseHAHistoryExportCSV;
  window.guessRolesFromEntities = guessRolesFromEntities;
  window.DEMO_ROLEMAP = DEMO_ROLEMAP;

  
  window.__setTestState = function(state) {
    // Update local let bindings (backwards compat for direct reads in app.js)
    if ('energyData' in state) energyData = state.energyData;
    if ('fullYearData' in state) fullYearData = state.fullYearData;
    if ('epexHistory' in state) epexHistory = state.epexHistory;
    if ('liveEnergyTax' in state) liveEnergyTax = state.liveEnergyTax;
    if ('yearScale' in state) yearScale = state.yearScale;
    if ('_cleanedRef' in state) _cleanedRef = state._cleanedRef;
    if ('calibratedProfile' in state) calibratedProfile = state.calibratedProfile;
    // Also sync into appStore so engine.js (buildSimContext) picks up test values
    const storeUpdates = {};
    for (const key of ['energyData', 'fullYearData', 'epexHistory', 'liveEnergyTax', 'yearScale', 'calibratedProfile', 'fullYearStamp']) {
      if (key in state) storeUpdates[key] = state[key];
    }
    // When fullYearData is explicitly set to null, also invalidate the cache stamp
    if ('fullYearData' in state && state.fullYearData === null) {
      fullYearStamp = "";
      storeUpdates.fullYearStamp = "";
    }
    if (Object.keys(storeUpdates).length) appStore.setState(storeUpdates);
  };
  
  window.__getTestState = function() {
    return {
      energyData, fullYearData, epexHistory, liveEnergyTax, yearScale,
      dataQuality, dataMeta, calibratedProfile, calibrationMeta, _cleanedRef,
      activeSimulation
    };
  };
}
