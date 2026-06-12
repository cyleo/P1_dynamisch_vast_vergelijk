
import { appStore } from "../domain/store.js";
import { toConsumerPrice, isoWeek } from "../domain/energyMath.js";

let afnameDetailView = "hour"; // "day" | "hour"

// Zoom state per chart (null = volledige weergave)
let _overviewZoom = null; // { start, end, mode } indices in allDays
let _simZoom = null;      // { start, end, mode } indices in allKeys
let _dragJustEnded = false; // onderdrukt klik-na-sleep in sim drill-down

export function setAfnameView(v) {
  afnameDetailView = v;
  renderAfnameDetail();
}
window.setAfnameView = setAfnameView;

export const fmtMoney = v => "€ " + (v || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtKwh = v => (v || 0).toLocaleString("nl-NL", { maximumFractionDigits: 0 }) + " kWh";

// ── Touch-vriendelijke tooltips voor de staaf-grafieken ─────────────────────────
// Muis-events (mouseenter/mouseleave) vuren niet op touch-toestellen → de tooltips
// waren daar onbereikbaar. _bindTouchTip koppelt een staaf-overlay aan dezelfde
// show/hide-closures via een tik: tik op een staaf = tooltip tonen, tik ergens
// anders = sluiten. Er is hooguit één tooltip tegelijk actief (`_activeTouchTip`).
let _activeTouchTip = null; // de hide-functie van de momenteel getoonde touch-tooltip
function _bindTouchTip(overlay, show, hide) {
  overlay.setAttribute("data-charttip", "1"); // markeert "tik hier sluit niet zelf"
  overlay.addEventListener("touchstart", () => {
    if (_activeTouchTip && _activeTouchTip !== hide) _activeTouchTip();
    show();
    _activeTouchTip = hide;
  }, { passive: true });
}
// Eénmalig: een tik buiten élke staaf-overlay sluit de actieve touch-tooltip.
if (typeof document !== "undefined" && !document._chartTipDismissBound) {
  document._chartTipDismissBound = true;
  document.addEventListener("touchstart", (e) => {
    if (!_activeTouchTip) return;
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-charttip") === "1") return; // staaf handelt zelf
    _activeTouchTip();
    _activeTouchTip = null;
  }, { passive: true });
}

/**
 * Voegt drag-to-zoom interactie toe aan een SVG-staafgrafiek.
 * Sleep horizontaal om in te zoomen; dubbelklik of "× Zoom reset" om terug te gaan.
 * Alleen aanroepen als het totale aantal datapunten > 20 is.
 */
function _addDragZoom(svg, W, PAD_L, PAD_T, chartW, chartH, allCount, zoomOffset, currentN, onZoom, onReset) {
  const ns = "http://www.w3.org/2000/svg";
  const mkEl = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  // Selectierechthoek (rubber-band)
  const selRect = mkEl("rect", {
    x: PAD_L, y: PAD_T, width: 0, height: chartH,
    fill: "rgba(100,180,255,0.12)",
    stroke: "rgba(100,180,255,0.55)",
    "stroke-width": "1",
    "pointer-events": "none"
  });
  selRect.style.display = "none";
  svg.appendChild(selRect);

  // "× Zoom reset" knop (alleen zichtbaar als ingezoomd)
  const isZoomed = zoomOffset > 0 || currentN < allCount;
  if (isZoomed) {
    const lbl = mkEl("text", {
      x: PAD_L + 2, y: PAD_T + 11,
      "text-anchor": "start",
      fill: "rgba(100,200,255,0.85)",
      "font-size": "9",
      cursor: "pointer",
      "pointer-events": "all"
    });
    lbl.textContent = "× Zoom reset";
    lbl.addEventListener("click", e => { e.stopPropagation(); onReset(); });
    svg.appendChild(lbl);
  }

  let anchorX = null;
  let dragging = false;
  let lastTouchX = null;

  const svgRelX = e => e.clientX - svg.getBoundingClientRect().left;

  const onStart = x => { anchorX = x; dragging = false; };

  const onMove = x => {
    if (anchorX === null) return;
    if (Math.abs(x - anchorX) > 5) {
      dragging = true;
      const x1 = Math.max(PAD_L, Math.min(anchorX, x));
      const x2 = Math.min(W, Math.max(anchorX, x));
      selRect.setAttribute("x", x1);
      selRect.setAttribute("width", Math.max(0, x2 - x1));
      selRect.style.display = "";
    }
  };

  const onEnd = x => {
    if (anchorX === null) return;
    selRect.style.display = "none";
    if (dragging) {
      _dragJustEnded = true;
      setTimeout(() => { _dragJustEnded = false; }, 150);
      const x1 = Math.min(anchorX, x);
      const x2 = Math.max(anchorX, x);
      const f1 = Math.max(0, (x1 - PAD_L) / chartW);
      const f2 = Math.min(1, (x2 - PAD_L) / chartW);
      const newStart = zoomOffset + Math.floor(f1 * currentN);
      const newEnd = zoomOffset + Math.ceil(f2 * currentN);
      if (newEnd - newStart >= 3) onZoom(newStart, Math.min(allCount, newEnd));
    }
    anchorX = null;
    dragging = false;
  };

  svg.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    onStart(svgRelX(e));
    document.addEventListener("mouseup", e2 => onEnd(svgRelX(e2)), { once: true });
  });
  svg.addEventListener("mousemove", e => onMove(svgRelX(e)));
  svg.addEventListener("dblclick", () => { if (isZoomed) onReset(); });

  svg.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    lastTouchX = e.touches[0].clientX - svg.getBoundingClientRect().left;
    onStart(lastTouchX);
  }, { passive: true });
  svg.addEventListener("touchmove", e => {
    if (e.touches.length !== 1) return;
    lastTouchX = e.touches[0].clientX - svg.getBoundingClientRect().left;
    onMove(lastTouchX);
  }, { passive: true });
  svg.addEventListener("touchend", () => {
    if (lastTouchX !== null) onEnd(lastTouchX);
    lastTouchX = null;
  }, { passive: true });
}

// Premium inline SVG icons to replace emojis
const ICON_CHECK = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-green);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const ICON_WARN = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-orange);"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
const ICON_INFO = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-blue);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
const ICON_BATTERY = `<svg class="icon icon-inline" viewBox="0 0 24 24" style="color:var(--accent-cyan);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>`;

// Bind store variables locally for the charts
let {
  activeViewType, overviewMode, overviewMetric, sankeyInterval,
  sankeyValue, simMode, simDrillDay, profileVisibleLines, activeSimulation,
  epexWarnDismissed, calibratedProfile, calibrationMeta, liveEnergyTax
} = appStore.getState();

appStore.subscribe(state => {
  activeViewType = state.activeViewType;
  overviewMode = state.overviewMode;
  overviewMetric = state.overviewMetric;
  sankeyInterval = state.sankeyInterval;
  sankeyValue = state.sankeyValue;
  simMode = state.simMode;
  simDrillDay = state.simDrillDay;
  profileVisibleLines = state.profileVisibleLines;
  activeSimulation = state.activeSimulation;
  epexWarnDismissed = state.epexWarnDismissed;
  calibratedProfile = state.calibratedProfile;
  calibrationMeta = state.calibrationMeta;
  liveEnergyTax = state.liveEnergyTax;
});

// Placeholder voor de globals totdat we state management toevoegen
export let __chartsDependencies = {
  activeSimulation: null,
  fullYearData: null,
  energyData: null,
  dataMeta: null,
  document: typeof document !== "undefined" ? document : null
};
export function setChartsDependencies(deps) {
  __chartsDependencies = { ...__chartsDependencies, ...deps };
}

// Local UI state for hardware detail expand/collapse
const hwOpenState = { hp: false, ev: false, bat: false, sol: false };


/**
 * Renders the main P1 daily profile chart (import/export and dynamic prices).
 */
export function renderChart() {
  if (!__chartsDependencies.activeSimulation?.hourlyProfile) return;

  const container = document.getElementById("chart-svg-container");
  const svg = document.getElementById("chart-svg");
  const tooltip = document.getElementById("chart-tooltip");

  const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
  const tax = liveEnergyTax;

  const width = container.clientWidth;
  const height = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Clear previous drawing contents
  svg.innerHTML = "";

  const profile = __chartsDependencies.activeSimulation.hourlyProfile;

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

  // "Gemeten"-stand: untangle.active is dan false (niet gestript), maar we tekenen wél
  // de gemeten EV/WP/accu-curve → window.dtMeasuredMode forceert de hardware-lijnen aan.
  const isDtActive = __chartsDependencies.activeSimulation?.records?.untangle?.active
    || (window.digitalTwinMode && window.digitalTwinMode.active)
    || window.dtMeasuredMode;
  
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
  let minPrice = 0.0;
  let maxPrice = 0.40;
  hourMedians.forEach(h => {
    const p = toConsumerPrice(h.spot, markup, tax);
    if (p > maxPrice) maxPrice = p;
    if (p < minPrice) minPrice = p;
  });
  if (minPrice < 0) {
    minPrice = Math.floor(minPrice * 20) / 20;
  }
  if (maxPrice > 0.40) {
    maxPrice = Math.ceil(maxPrice * 20) / 20;
  }

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

  // Draw Price Zero Line if minPrice < 0
  if (minPrice < 0) {
    const zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    zeroLine.setAttribute("x1", paddingLeft);
    zeroLine.setAttribute("y1", getYPrice(0));
    zeroLine.setAttribute("x2", width - paddingRight);
    zeroLine.setAttribute("y2", getYPrice(0));
    zeroLine.setAttribute("stroke", "rgba(234, 179, 8, 0.25)");
    zeroLine.setAttribute("stroke-width", "1");
    zeroLine.setAttribute("stroke-dasharray", "2,2");
    svg.appendChild(zeroLine);
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
    pricePathPoints.push(`${getX(h)},${getYPrice(toConsumerPrice(hm.spot, markup, tax))}`);
    
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
  overlay.style.touchAction = "none"; // verticale veeg scrubt de grafiek i.p.v. te scrollen
  svg.appendChild(overlay);

  const moveTo = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = clientX - rect.left;

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

    // Update Tooltip details — positioneren gebeurt ná het vullen (zie onder), zodat we
    // de echte tooltip-breedte kunnen meten en bij de rechterrand naar links klappen.
    tooltip.style.display = "block";

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
    const consPrice = toConsumerPrice(pureSpot, markup, tax);
    const rawEpex = (pureSpot / 1.21).toFixed(3);

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
        EPEX markt €${rawEpex} × 1.21 + opslag €${markup.toFixed(3)} (incl. BTW) + EB €${tax.toFixed(3)} = all-in €${consPrice.toFixed(3)}
      </div>
    `;

    // Rand-bewuste positionering: meet de echte breedte (na innerHTML) en klap de tooltip
    // naar links van de cursor zodra hij rechts buiten de grafiek zou vallen — zelfde gedrag
    // als de dynamisch-vs-vast grafiek. Voorheen stond 'left' vast op x+15 → clip rechts.
    const ttW = tooltip.offsetWidth || 240;
    let tx = x + 15;
    if (tx + ttW > width) tx = x - ttW - 15;
    if (tx < 0) tx = 5;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${getYEnergy(impVal) - 40}px`;
  };

  const hideAll = () => {
    hoverLine.style.display = "none";
    dotImp.style.display = "none";
    dotExp.style.display = "none";
    tooltip.style.display = "none";
  };

  overlay.addEventListener("mousemove", (e) => moveTo(e.clientX));
  overlay.addEventListener("mouseleave", hideAll);
  // Touch: scrubben met de vinger toont dezelfde uur-tooltip; loslaten verbergt 'm.
  const touchScrub = (e) => { if (e.touches[0]) { e.preventDefault(); moveTo(e.touches[0].clientX); } };
  overlay.addEventListener("touchstart", touchScrub, { passive: false });
  overlay.addEventListener("touchmove", touchScrub, { passive: false });
  overlay.addEventListener("touchend", hideAll);
}

function _updateSimHeader() {
  const modeLabel = document.getElementById("sim-chart-mode-label");
  const subtitle = document.getElementById("sim-chart-subtitle");
  const backBtn = document.getElementById("sim-back-btn");
  const pct = activeSimulation?.epexPct ?? 0;
  const epexNote = pct === 100 ? "" : ` · ${pct > 0 ? pct + "% echte EPEX" : `${ICON_WARN} gesimuleerde prijzen`}`;

  if (simDrillDay) {
    const d = new Date(simDrillDay + "T12:00:00");
    modeLabel.textContent = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
    subtitle.innerHTML = `Kosten per uur · groen = dynamisch goedkoper · rood = duurder${epexNote}`;
    if (backBtn) backBtn.style.display = "";
  } else {
    modeLabel.textContent = simMode === "week" ? "Week" : "Dag";
    subtitle.innerHTML = simMode === "week"
      ? `Totale kosten per week · klik op een balk voor uurdetail${epexNote}`
      : `Totale kosten per dag · klik op een dag voor uurdetail${epexNote}`;
    if (backBtn) backBtn.style.display = "none";
  }
}

// ── Drill-down: uurkosten voor één specifieke dag ────────────────────────────
function _renderSimDrill() {
  const dayData = activeSimulation?.perDayHourly?.[simDrillDay];
  if (!dayData) { appStore.setState({ simDrillDay: null }); renderSimChart(); return; }

  const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
  const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;
  const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
  const tax = liveEnergyTax;

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
    const pricesList = validSpots.map(s => toConsumerPrice(s, markup, tax)).concat([fixedPeak, fixedDal]);
    let priceMin = 0.0;
    let priceMax = 0.10;
    pricesList.forEach(p => {
      if (p > priceMax) priceMax = p;
      if (p < priceMin) priceMin = p;
    });
    priceMax *= 1.15;
    if (priceMin < 0) {
      priceMin *= 1.15;
    }
    const yP = v => PAD_T + cH - ((v - priceMin) / (priceMax - priceMin)) * cH;
    const pRX = W - PAD_R + 4;
    [0, 0.5, 1].forEach(r => {
      const val = priceMin + r * (priceMax - priceMin), y = yP(val);
      // Remove tick mark line because it visually resembles a minus symbol right next to the label (e.g. "- €0.34")
      const lbl = mk("text", { x: W - PAD_R + 6, y: y + 3, "text-anchor": "start", fill: "rgba(255,255,255,0.35)", "font-size": "7" });
      lbl.textContent = `€ ${val.toFixed(2)}`; svg.appendChild(lbl);
    });
    // Add zero line if price is negative
    if (priceMin < 0) {
      svg.appendChild(mk("line", {
        x1: PAD_L,
        y1: yP(0),
        x2: W - PAD_R,
        y2: yP(0),
        stroke: "rgba(0, 242, 254, 0.25)",
        "stroke-dasharray": "2,2",
        "stroke-width": "1"
      }));
    }
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
      const x1 = PAD_L + h * barSlot, x2 = x1 + barSlot, y = yP(toConsumerPrice(s, markup, tax));
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
    const show = () => {
      const dyn = dynVals[h], fx = fixedVals[h], diff = dyn - fx;
      document.getElementById("sim-tt-hour").textContent = `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`;
      document.getElementById("sim-tt-dyn").textContent = `€ ${Math.abs(dyn).toFixed(4)}/uur${dyn < 0 ? " (opbrengst)" : ""}`;
      document.getElementById("sim-tt-fixed").textContent = `€ ${Math.abs(fx).toFixed(4)}/uur${fx < 0 ? " (opbrengst)" : ""}`;
      const de = document.getElementById("sim-tt-diff");
      de.textContent = (diff < 0 ? "−" : "+") + ` € ${Math.abs(diff).toFixed(4)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
      de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
      const s = spots[h];
      document.getElementById("sim-tt-spot").textContent = s != null ? `Consumentenprijs: € ${toConsumerPrice(s, markup, tax).toFixed(3)}/kWh` : "";
      tooltip.style.display = "block";
      let tx = xOf(h) + 12; if (tx + 200 > W) tx = xOf(h) - 210;
      tooltip.style.left = tx + "px"; tooltip.style.top = (PAD_T + 10) + "px";
      ov.setAttribute("fill", "rgba(255,255,255,0.04)");
    };
    const hide = () => { tooltip.style.display = "none"; ov.setAttribute("fill", "transparent"); };
    ov.addEventListener("mouseenter", show);
    ov.addEventListener("mouseleave", hide);
    _bindTouchTip(ov, show, hide);
    svg.appendChild(ov);
  }
}

/**
 * Renders the detailed 24-hour simulation breakdown chart (hardware effects).
 */
export function renderSimChart() {
  const card = document.getElementById("sim-chart-card");
  if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";
  _updateSimHeader();

  if (simDrillDay) { _renderSimDrill(); return; }

  const isWeekMode = simMode === "week";
  const pdt = __chartsDependencies.activeSimulation.perDayTotals;
  if (!pdt) return;

  const buckets = new Map();
  Object.entries(pdt).sort().forEach(([date, v]) => {
    const key = isWeekMode ? isoWeek(date) : date;
    if (!buckets.has(key)) buckets.set(key, { dyn: 0, fixed: 0, firstDate: date });
    const b = buckets.get(key);
    b.dyn += v.dynCost;
    b.fixed += v.fixedCost;
  });
  const allKeys = [...buckets.keys()];
  // Valideer zoom (reset bij moduswissel of verouderde grenzen)
  const simModeKey = isWeekMode ? "week" : "day";
  if (_simZoom && (_simZoom.mode !== simModeKey || _simZoom.end > allKeys.length)) {
    _simZoom = null;
  }
  const keys = _simZoom ? allKeys.slice(_simZoom.start, _simZoom.end) : allKeys;
  const dyns = keys.map(k => buckets.get(k).dyn);
  const fixeds = keys.map(k => buckets.get(k).fixed);
  const N = keys.length;
  if (!N) return;

  let minVal = 0.0;
  let maxVal = 0.01;
  dyns.forEach(v => { if (v > maxVal) maxVal = v; if (v < minVal) minVal = v; });
  fixeds.forEach(v => { if (v > maxVal) maxVal = v; if (v < minVal) minVal = v; });
  maxVal *= 1.15;
  if (minVal < 0) {
    minVal *= 1.15;
  }

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
  const yOf = v => PAD_T + cH - ((v - minVal) / (maxVal - minVal)) * cH;
  const zeroY = yOf(0);
  const xOf = i => PAD_L + i * barSlot + barSlot / 2;

  // Draw grid lines and labels
  [0, 0.25, 0.5, 0.75, 1].forEach(r => {
    const y = PAD_T + cH * (1 - r);
    const val = minVal + r * (maxVal - minVal);
    svg.appendChild(mk("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y, stroke: "rgba(255,255,255,0.04)" }));
    const lbl = mk("text", { x: PAD_L - 5, y: y + 3, "text-anchor": "end", fill: "var(--text-muted)", "font-size": "8" });
    lbl.textContent = (val < 0 ? "−" : "") + `€${Math.abs(val).toFixed(2)}`;
    svg.appendChild(lbl);
  });

  // Solid zero line if minVal < 0
  if (minVal < 0) {
    svg.appendChild(mk("line", {
      x1: PAD_L,
      y1: zeroY,
      x2: W - PAD_R,
      y2: zeroY,
      stroke: "rgba(255,255,255,0.2)",
      "stroke-width": "1"
    }));
  } else {
    // Standard bottom baseline border
    svg.appendChild(mk("line", { x1: PAD_L, y1: PAD_T + cH, x2: W - PAD_R, y2: PAD_T + cH, stroke: "rgba(255,255,255,0.15)", "stroke-width": "1" }));
  }

  for (let i = 0; i < N; i++) {
    svg.appendChild(mk("rect", { x: PAD_L + i * barSlot, y: PAD_T, width: barSlot, height: cH, fill: dyns[i] < fixeds[i] ? "rgba(56,239,125,0.05)" : "rgba(255,100,100,0.05)" }));
    [[dyns[i], "rgba(0,242,254,0.75)", -barW * 0.55], [fixeds[i], "rgba(102,126,234,0.75)", barW * 0.05]].forEach(([val, col, off]) => {
      const yVal = yOf(val);
      const top = Math.min(zeroY, yVal);
      const ht = Math.abs(yVal - zeroY);
      if (ht < 0.5) return;
      svg.appendChild(mk("rect", { x: xOf(i) + off, y: top, width: barW, height: ht, fill: col, rx: "1" }));
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
    const show = () => {
      const diff = dyns[i] - fixeds[i];
      const label = isWeekMode ? keys[i] : (() => { const d = new Date(keys[i] + "T12:00:00"); return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }); })();
      document.getElementById("sim-tt-hour").textContent = label + (isWeekMode ? "" : " · klik voor uurdetail");
      document.getElementById("sim-tt-dyn").textContent = (dyns[i] < 0 ? "− " : "") + `€ ${Math.abs(dyns[i]).toFixed(2)}`;
      document.getElementById("sim-tt-fixed").textContent = (fixeds[i] < 0 ? "− " : "") + `€ ${Math.abs(fixeds[i]).toFixed(2)}`;
      const de = document.getElementById("sim-tt-diff");
      de.textContent = (diff < 0 ? "−" : "+") + ` € ${Math.abs(diff).toFixed(2)} (${diff < 0 ? "dyn goedkoper" : "dyn duurder"})`;
      de.style.color = diff < 0 ? "var(--accent-green)" : "var(--accent-orange)";
      document.getElementById("sim-tt-spot").textContent = "";
      tooltip.style.display = "block";
      let tx = xOf(i) + 12; if (tx + 200 > W) tx = xOf(i) - 210;
      tooltip.style.left = tx + "px"; tooltip.style.top = (PAD_T + 10) + "px";
      ov.setAttribute("fill", "rgba(255,255,255,0.04)");
    };
    const hide = () => { tooltip.style.display = "none"; ov.setAttribute("fill", "transparent"); };
    ov.addEventListener("mouseenter", show);
    ov.addEventListener("mouseleave", hide);
    _bindTouchTip(ov, show, hide);
    // Drill-down on click (day mode only — week mode drills to the first day of that week)
    ov.addEventListener("click", () => {
      if (_dragJustEnded) { _dragJustEnded = false; return; }
      if (!isWeekMode) {
        appStore.setState({ simDrillDay: keys[i] });
      } else {
        appStore.setState({ simDrillDay: buckets.get(keys[i]).firstDate });
      }
      tooltip.style.display = "none";
      renderSimChart();
    });
    svg.appendChild(ov);
  }

  // Drag-to-zoom (alleen bij > 20 datapunten)
  if (allKeys.length > 20) {
    _addDragZoom(
      svg, W, PAD_L, PAD_T, cW, cH,
      allKeys.length, _simZoom ? _simZoom.start : 0, N,
      (s, e) => { _simZoom = { start: s, end: e, mode: simModeKey }; renderSimChart(); },
      () => { _simZoom = null; renderSimChart(); }
    );
  }
}

/**
 * Renders the main cost breakdown table (Vast vs Dynamisch).
 */
export function renderAfnameDetail() {
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
        ${__chartsDependencies.activeSimulation.epexPct === 100 ? `${ICON_CHECK} <span>echte EPEX uurprijzen</span>` : __chartsDependencies.activeSimulation.epexPct > 0 ? `${__chartsDependencies.activeSimulation.epexPct}% echt` : `${ICON_WARN} <span>gesimuleerde prijzen (klik Ophalen)</span>`}
      </span>
    </div>`;

  if (afnameDetailView === 'hour') {
    renderAfnameDetailHour(body, viewToggle);
  } else {
    renderAfnameDetailDay(body, viewToggle);
  }
}

export function renderAfnameDetailHour(body, viewToggle) {
  const hp = __chartsDependencies.activeSimulation?.hourlyProfile;
  if (!hp) { body.innerHTML = viewToggle + "<p>Geen data.</p>"; return; }
  const fixedPeak = parseFloat(document.getElementById("fixed-peak")?.value) || 0.27;
  const fixedDal = parseFloat(document.getElementById("fixed-dal")?.value) || 0.24;
  const markup = parseFloat(document.getElementById("dynamic-markup")?.value) || 0.024;
  const tax = liveEnergyTax;

  const med = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  const hours = Array.from({ length: 24 }, (_, h) => {
    const impKwh = med(hp[h].imports);
    const expKwh = med(hp[h].exports);
    const spot = med(hp[h].spots);
    const consPrice = toConsumerPrice(spot, markup, tax);
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
      ${__chartsDependencies.activeSimulation.epexPct < 100 ? `<br>${ICON_WARN} <span>Gesimuleerde prijzen — met echte EPEX-data (Ophalen) worden winterpieken zichtbaar.</span>` : ""}
    </p>`;
}

export function renderAfnameDetailDay(body, viewToggle) {
  const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
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

/**
 * Renders the monthly cost comparison bar chart.
 */
export function renderMonthlyChart() {
  const card = document.getElementById("monthly-chart-card");
  const perDay = __chartsDependencies.activeSimulation?.perDayTotals;
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
  
  let minV = 0.0;
  let maxV = 1.0;
  months.forEach(m => {
    if (m.has) {
      if (m.fixed > maxV) maxV = m.fixed;
      if (m.dyn > maxV) maxV = m.dyn;
      if (m.fixed < minV) minV = m.fixed;
      if (m.dyn < minV) minV = m.dyn;
    }
  });

  maxV = Math.ceil(maxV * 1.15);
  if (minV < 0) {
    minV = Math.floor(minV * 1.15);
  }

  const yOf = (val) => padT + ch - ((val - minV) / (maxV - minV)) * ch;
  const zeroY = yOf(0);

  // y-as gridlijnen + labels
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const val = minV + ratio * (maxV - minV);
    const y = padT + ch - (ratio * ch);
    svg.appendChild(mk("line", { x1: padL, y1: y, x2: W - padR, y2: y, stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }));
    const lbl = mk("text", { x: padL - 6, y: y + 3, "text-anchor": "end", "font-size": 9, fill: "var(--text-muted)" });
    lbl.textContent = (val < 0 ? "−" : "") + `€${Math.abs(Math.round(val))}`;
    svg.appendChild(lbl);
  }

  // Zero line if minV < 0
  if (minV < 0) {
    svg.appendChild(mk("line", {
      x1: padL,
      y1: zeroY,
      x2: W - padR,
      y2: zeroY,
      stroke: "rgba(255, 255, 255, 0.15)",
      "stroke-width": 1
    }));
  }

  const groupW = cw / 12;
  const barW = Math.min(13, groupW / 2 - 2);
  months.forEach((m, i) => {
    const gx = padL + groupW * i + groupW / 2;
    const bar = (val, offset, color) => {
      const yVal = yOf(val);
      const barTop = Math.min(zeroY, yVal);
      const barHeight = Math.max(0.5, Math.abs(yVal - zeroY));
      const r = mk("rect", {
        x: gx + offset,
        y: barTop,
        width: barW,
        height: barHeight,
        fill: color,
        rx: 2,
        opacity: 0.85
      });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${labels[i]} — ` + (val < 0 ? "−" : "") + `€${Math.abs(val).toFixed(0)}`;
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

export function renderHwChart() {
  const card = document.getElementById("hw-chart-card");
  if (!card || !__chartsDependencies.activeSimulation?.hwEffects) { if (card) card.style.display = "none"; return; }
  card.style.display = "";
  const fx = __chartsDependencies.activeSimulation.hwEffects;
  // De engine levert nu altijd een volledig jaar → effect is al op jaarbasis, geen herschaling.
  const mf = 1.0;

  const deviceDefs = [
    {
      key: "hp", icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-purple);"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`, label: "Warmtepomp", data: fx.hp,
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
      key: "ev", icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-blue);"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`, label: "Auto (EV)", data: fx.ev,
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
      key: "bat", icon: `<svg class="icon" viewBox="0 0 24 24" style="color:var(--accent-orange);"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect><line x1="22" y1="11" x2="22" y2="13"></line></svg>`, label: "Thuisaccu", data: fx.bat,
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

  // Zonnepanelen: alleen tonen als er echte solar_yield data gemeten is.
  if (fx.sol?.enabled) {
    deviceDefs.push({
      key: "sol",
      icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#f59e0b;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
      label: "Zonnepanelen",
      data: fx.sol,
      explanation: (d) => {
        const kWh = d.cfg?.solarKwh ?? 0;
        return `<strong>Opbrengst:</strong> ${kWh.toLocaleString("nl-NL")} kWh/jaar gemeten via de solar-sensor.
          <br><br>
          <strong>Werking (2027-model, geen saldering):</strong> Elk zonne-uur vermindert de bruto import van het net — en daarmee ook de energiebelasting (EB wordt geheven over elke geïmporteerde kWh). Zonne-overschot wordt teruggeleverd aan het net.
          <br><br>
          <strong>Vast contract:</strong> exportoverschot levert het vaste teruglevertarief op (minus eventuele VTK).
          <br><br>
          <strong>Dynamisch contract:</strong> exportopbrengst = kale marktprijs (<em>spot/1,21 − opslag</em>). Op zon-uren kan de spotprijs laag zijn — maar zelfconsumptie bespaart dan alsnog de volledige all-in prijs inclusief energiebelasting.`;
      },
    });
  }

  const container = document.getElementById("hw-chart-body");
  container.innerHTML = "";

  // EPEX warning — onderscheidt 3 lagen: volledig live · gekalibreerd · generiek
  const epexPct = __chartsDependencies.activeSimulation.epexPct ?? 0;
  if (epexPct < 100 && !epexWarnDismissed) {
    const warn = document.createElement("div");
    warn.id = "epex-warn-box";
    warn.style.cssText = "position:relative;background:rgba(255,165,0,0.12);border:1px solid rgba(255,165,0,0.3);border-radius:6px;padding:0.5rem 1.9rem 0.5rem 0.75rem;margin-bottom:0.75rem;font-size:0.75rem;color:var(--accent-orange);";
    const calibrated = calibratedProfile && calibrationMeta.buckets > 0;
    if (epexPct === 0 && !calibrated) {
      // Niets live, geen kalibratie → generiek noodprofiel (grote waarschuwing).
      warn.innerHTML = `${ICON_WARN} <strong>Let op: geen echte EPEX-uurprijzen.</strong> De simulatie gebruikt generieke
         <em>seizoensprofielen</em> als noodoplossing (geijkt op NL-marktpatronen: zon-export ≈ 50% van het
         jaargemiddelde) — een redelijke schatting, maar zonder de echte piek- en negatieve dagen.
         Klik <strong>Ophalen</strong> of laad HA-data om actuele historische EPEX-prijzen te gebruiken.`;
    } else if (epexPct === 0 && calibrated) {
      // Gemeten periode valt buiten de loop, maar projectie draait op eigen prijsprofiel.
      warn.innerHTML = `${ICON_INFO} <span>De jaarprognose is gevuld met een <strong>prijsprofiel uit je eigen EPEX-historie</strong>
         (${calibrationMeta.samples} echte uurprijzen, ${calibrationMeta.buckets} seizoen×uur-buckets) i.p.v. de generieke profielen.</span>`;
    } else {
      // Deels live, rest gevuld via kalibratie of generiek.
      warn.innerHTML = `${ICON_WARN} <span>${epexPct}% echte EPEX-prijzen geladen; de overige ${100 - epexPct}% is `
        + (calibrated
            ? `gevuld met je <strong>eigen gekalibreerde prijsprofiel</strong> (${calibrationMeta.samples} echte uurprijzen).`
            : `geschat via het generieke seizoensprofiel.</span>`);
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

/**
 * Renders the main overview timeline chart (Day/Week/Month).
 */
export function renderOverviewChart() {
  if (activeViewType === "sankey") {
    renderSankeyDiagram();
    return;
  }
  const card = document.getElementById("overview-chart-card");
  if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";

  const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
  const bucketMap = new Map();

  if (pdt && Object.keys(pdt).length > 0) {
    for (const [dayKey, v] of Object.entries(pdt)) {
      const key = overviewMode === "week" ? isoWeek(dayKey) : (overviewMode === "month" ? dayKey.slice(0, 7) : dayKey);
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          rawImp: 0, rawExp: 0,
          evKwh: 0, evCost: 0, evSavings: 0,
          hpKwh: 0, hpCost: 0, hpSavings: 0,
          batCharge: 0, batDischarge: 0, batCost: 0, batSavings: 0,
          batChargeCost: 0, batDischargeValue: 0,
          baseloadCost: 0, baseloadReturn: 0,
          baseloadImportSavings: 0, baseloadExportSavings: 0,
          dynCost: 0, fixedCost: 0, impKwh: 0, expKwh: 0
        });
      }
      const e = bucketMap.get(key);
      e.rawImp += v.rawImp || 0;
      e.rawExp += v.rawExp || 0;
      e.evKwh += v.evKwh || 0;
      e.evCost += v.evCost || 0;
      e.evSavings += v.evSavings || 0;
      e.hpKwh += v.hpKwh || 0;
      e.hpCost += v.hpCost || 0;
      e.hpSavings += v.hpSavings || 0;
      e.batCharge += v.batCharge || 0;
      e.batDischarge += v.batDischarge || 0;
      e.batCost += v.batCost || 0;
      e.batSavings += v.batSavings || 0;
      e.batChargeCost += v.batChargeCost || 0;
      e.batDischargeValue += v.batDischargeValue || 0;
      e.baseloadCost += v.baseloadCost || 0;
      e.baseloadReturn += v.baseloadReturn || 0;
      e.baseloadImportSavings += v.baseloadImportSavings || 0;
      e.baseloadExportSavings += v.baseloadExportSavings || 0;
      e.dynCost += v.dynCost || 0;
      e.fixedCost += v.fixedCost || 0;
      e.impKwh += v.impKwh || 0;
      e.expKwh += v.expKwh || 0;
    }
  } else {
    __chartsDependencies.energyData.forEach(row => {
      const dayKey = row.timestamp.slice(0, 10);
      const key = overviewMode === "week" ? isoWeek(dayKey) : (overviewMode === "month" ? dayKey.slice(0, 7) : dayKey);
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          rawImp: 0, rawExp: 0,
          evKwh: 0, evCost: 0, evSavings: 0,
          hpKwh: 0, hpCost: 0, hpSavings: 0,
          batCharge: 0, batDischarge: 0, batCost: 0, batSavings: 0,
          batChargeCost: 0, batDischargeValue: 0,
          baseloadCost: 0, baseloadReturn: 0,
          baseloadImportSavings: 0, baseloadExportSavings: 0,
          dynCost: 0, fixedCost: 0, impKwh: 0, expKwh: 0
        });
      }
      const e = bucketMap.get(key);
      const imp = (row.import_t1 || 0) + (row.import_t2 || 0);
      const exp = (row.export_t1 || 0) + (row.export_t2 || 0);
      e.rawImp += imp;
      e.rawExp += exp;
      e.baseloadCost += imp * 0.25;
      e.baseloadReturn += exp * 0.08;
      e.impKwh += imp;
      e.expKwh += exp;
    });
  }

  const allDays = Array.from(bucketMap.keys()).sort();
  // Valideer zoom (reset bij moduswissel of verouderde grenzen)
  if (_overviewZoom && (_overviewZoom.mode !== overviewMode || _overviewZoom.end > allDays.length)) {
    _overviewZoom = null;
  }
  const days = _overviewZoom ? allDays.slice(_overviewZoom.start, _overviewZoom.end) : allDays;
  const values = days.map(d => bucketMap.get(d));

  const hasEv = !!__chartsDependencies.activeSimulation?.hwEffects?.ev?.enabled;
  const hasHp = !!__chartsDependencies.activeSimulation?.hwEffects?.hp?.enabled;
  const hasBat = !!__chartsDependencies.activeSimulation?.hwEffects?.bat?.enabled;

  const colors = {
    import: "var(--accent-cyan)",
    return: "var(--accent-green)",
    ev: "var(--accent-blue)",
    hp: "var(--accent-purple)",
    bat_charge: "var(--accent-yellow)",
    bat_discharge: "var(--accent-orange)",
    bat: "var(--accent-orange)"
  };

  // Render Legends
  const legendContainer = document.getElementById("overview-legends");
  legendContainer.innerHTML = "";
  const activeCats = [];
  if (overviewMetric === "energy") {
    activeCats.push({ label: "Overige Afname", color: colors.import });
    if (hasEv) activeCats.push({ label: "EV Lader", color: colors.ev });
    if (hasHp) activeCats.push({ label: "Warmtepomp", color: colors.hp });
    if (hasBat) activeCats.push({ label: "Thuisaccu (Laden)", color: colors.bat_charge });
    activeCats.push({ label: "Overige Teruglevering", color: colors.return });
    if (hasBat) activeCats.push({ label: "Thuisaccu (Ontladen)", color: colors.bat_discharge });
  } else if (overviewMetric === "cost") {
    activeCats.push({ label: "Overige Kosten", color: colors.import });
    if (hasEv) activeCats.push({ label: "EV Lader", color: colors.ev });
    if (hasHp) activeCats.push({ label: "Warmtepomp", color: colors.hp });
    if (hasBat) activeCats.push({ label: "Thuisaccu (Laden)", color: colors.bat_charge });
    activeCats.push({ label: "Overige Teruglevering (Opbrengst)", color: colors.return });
    if (hasBat) activeCats.push({ label: "Thuisaccu (Ontladen)", color: colors.bat_discharge });
  } else { // savings
    activeCats.push({ label: "Besparing Overige Afname", color: colors.import });
    activeCats.push({ label: "Besparing Overige Terug", color: colors.return });
    if (hasEv) activeCats.push({ label: "EV Lader Besparing", color: colors.ev });
    if (hasHp) activeCats.push({ label: "Warmtepomp Besparing", color: colors.hp });
    if (hasBat) activeCats.push({ label: "Thuisaccu Besparing", color: colors.bat });
  }
  activeCats.forEach(c => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-color" style="background:${c.color}; width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:4px;"></span> ${c.label}`;
    legendContainer.appendChild(item);
  });

  // Asymmetrische Y-as: positief en negatief bereik apart berekenen zodat de
  // nul-lijn op de juiste plek staat en er geen lege ruimte verspild wordt.
  let maxPosData = 0, maxNegData = 0;
  days.forEach(d => {
    const e = bucketMap.get(d);
    if (overviewMetric === "energy") {
      const posSum = e.rawImp + (hasEv ? e.evKwh : 0) + (hasHp ? e.hpKwh : 0) + (hasBat ? e.batCharge : 0);
      const negSum = e.rawExp + (hasBat ? e.batDischarge : 0);
      maxPosData = Math.max(maxPosData, posSum);
      maxNegData = Math.max(maxNegData, negSum);
    } else if (overviewMetric === "cost") {
      const posSum = e.baseloadCost + (hasEv ? e.evCost : 0) + (hasHp ? e.hpCost : 0) + (hasBat ? e.batChargeCost : 0);
      const negSum = e.baseloadReturn + (hasBat ? e.batDischargeValue : 0);
      maxPosData = Math.max(maxPosData, posSum);
      maxNegData = Math.max(maxNegData, negSum);
    } else { // savings
      let posSum = 0, negSum = 0;
      const cats = [
        e.baseloadImportSavings,
        e.baseloadExportSavings,
        hasEv ? e.evSavings : 0,
        hasHp ? e.hpSavings : 0,
        hasBat ? e.batSavings : 0
      ];
      cats.forEach(c => {
        if (c > 0) posSum += c;
        else negSum += Math.abs(c);
      });
      maxPosData = Math.max(maxPosData, posSum);
      maxNegData = Math.max(maxNegData, negSum);
    }
  });
  // Headroom 15%; als er nauwelijks negatieve data is, minimaal 6% van de hoogte reserveren
  const maxPos = (maxPosData > 0 ? maxPosData : 0.01) * 1.15;
  const maxNeg = maxNegData > 0 ? maxNegData * 1.15 : maxPos * 0.06;
  const totalRange = maxPos + maxNeg;

  const container = document.getElementById("overview-svg-container");
  const svg = document.getElementById("overview-svg");
  const tooltip = document.getElementById("overview-tooltip");
  const W = container.clientWidth;
  const H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const PAD_L = 52, PAD_R = 12, PAD_T = 16, PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = days.length;
  const barW = Math.max(1.5, (chartW / n) - 2);

  const xOf = i => PAD_L + i * (chartW / n) + 1.0;
  const yOfZero = PAD_T + (maxPos / totalRange) * chartH;
  const pxPerUnit = chartH / totalRange;
  const yOfVal = val => yOfZero - val * pxPerUnit;

  const mk = (tag, attrs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  // Gridlines op de werkelijke data-grenzen (asymmetrisch)
  const gridVals = [
    { v: maxPosData, zero: false },
    { v: maxPosData / 2, zero: false },
    { v: 0, zero: true },
    ...(maxNegData > 0 ? [
      { v: -maxNegData / 2, zero: false },
      { v: -maxNegData, zero: false }
    ] : [])
  ];
  gridVals.forEach(({ v, zero }) => {
    const y = yOfVal(v);
    svg.appendChild(mk("line", {
      x1: PAD_L, y1: y, x2: W - PAD_R, y2: y,
      stroke: zero ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)",
      "stroke-dasharray": zero ? "none" : "2,2"
    }));
    const lbl = mk("text", {
      x: PAD_L - 6, y: y + 3, "text-anchor": "end",
      fill: "var(--text-muted)", "font-size": 9
    });
    if (overviewMetric === "energy") {
      lbl.textContent = (v > 0 ? "+" : "") + v.toFixed(0) + " kWh";
    } else {
      lbl.textContent = (v >= 0 ? "+" : "-") + "€" + Math.abs(v).toFixed(0);
    }
    svg.appendChild(lbl);
  });

  const drawSegment = (x, yStart, yEnd, color, rx = 0) => {
    const y = Math.min(yStart, yEnd);
    const height = Math.abs(yStart - yEnd);
    if (height < 0.5) return null;
    const rect = mk("rect", {
      x, y, width: barW, height,
      fill: color, rx
    });
    svg.appendChild(rect);
    return rect;
  };

  // Draw Stacked Bars
  days.forEach((d, i) => {
    const x = xOf(i);
    const e = bucketMap.get(d);

    if (overviewMetric === "energy") {
      // Positive Stack (import/consumption)
      let currentPosVal = 0;
      
      // 1. Baseload Import
      let nextPosVal = currentPosVal + e.rawImp;
      drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.import, 1);
      currentPosVal = nextPosVal;

      // 2. EV Lader
      if (hasEv && e.evKwh > 0) {
        nextPosVal = currentPosVal + e.evKwh;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.ev, 0);
        currentPosVal = nextPosVal;
      }

      // 3. Warmtepomp
      if (hasHp && e.hpKwh > 0) {
        nextPosVal = currentPosVal + e.hpKwh;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.hp, 0);
        currentPosVal = nextPosVal;
      }

      // 4. Thuisaccu Laden
      if (hasBat && e.batCharge > 0) {
        nextPosVal = currentPosVal + e.batCharge;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.bat_charge, 1);
        currentPosVal = nextPosVal;
      }

      // Negative Stack (export/generation)
      let currentNegVal = 0;

      // 1. Baseload Export
      let nextNegVal = currentNegVal - e.rawExp;
      drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.return, 1);
      currentNegVal = nextNegVal;

      // 2. Thuisaccu Ontladen
      if (hasBat && e.batDischarge > 0) {
        nextNegVal = currentNegVal - e.batDischarge;
        drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.bat_discharge, 1);
        currentNegVal = nextNegVal;
      }

      // Net marker
      const net = (e.rawImp + (hasEv ? e.evKwh : 0) + (hasHp ? e.hpKwh : 0) + (hasBat ? e.batCharge : 0))
                - (e.rawExp + (hasBat ? e.batDischarge : 0));
      const yNet = yOfVal(net);
      svg.appendChild(mk("line", {
        x1: x - 1, y1: yNet, x2: x + barW + 1, y2: yNet,
        stroke: "#ffffff", "stroke-width": 1.5, "stroke-linecap": "round"
      }));

    } else if (overviewMetric === "cost") {
      // Positive Stack (Costs)
      let currentPosVal = 0;

      // 1. Baseload Cost
      let nextPosVal = currentPosVal + e.baseloadCost;
      drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.import, 1);
      currentPosVal = nextPosVal;

      // 2. EV Cost
      if (hasEv && e.evCost > 0) {
        nextPosVal = currentPosVal + e.evCost;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.ev, 0);
        currentPosVal = nextPosVal;
      }

      // 3. HP Cost
      if (hasHp && e.hpCost > 0) {
        nextPosVal = currentPosVal + e.hpCost;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.hp, 0);
        currentPosVal = nextPosVal;
      }

      // 4. Battery Charge Cost
      if (hasBat && e.batChargeCost > 0) {
        nextPosVal = currentPosVal + e.batChargeCost;
        drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPosVal), colors.bat_charge, 1);
        currentPosVal = nextPosVal;
      }

      // Negative Stack (Revenues)
      let currentNegVal = 0;

      // 1. Baseload Return
      let nextNegVal = currentNegVal - e.baseloadReturn;
      drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.return, 1);
      currentNegVal = nextNegVal;

      // 2. Battery Discharge Value
      if (hasBat && e.batDischargeValue > 0) {
        nextNegVal = currentNegVal - e.batDischargeValue;
        drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNegVal), colors.bat_discharge, 1);
        currentNegVal = nextNegVal;
      }

      // Net marker
      const net = (e.baseloadCost + (hasEv ? e.evCost : 0) + (hasHp ? e.hpCost : 0) + (hasBat ? e.batChargeCost : 0))
                - (e.baseloadReturn + (hasBat ? e.batDischargeValue : 0));
      const yNet = yOfVal(net);
      svg.appendChild(mk("line", {
        x1: x - 1, y1: yNet, x2: x + barW + 1, y2: yNet,
        stroke: "#ffffff", "stroke-width": 1.5, "stroke-linecap": "round"
      }));

    } else { // savings
      let currentPosVal = 0;
      let currentNegVal = 0;

      const segments = [
        { val: e.baseloadImportSavings, color: colors.import },
        { val: e.baseloadExportSavings, color: colors.return },
        { val: hasEv ? e.evSavings : 0, color: colors.ev },
        { val: hasHp ? e.hpSavings : 0, color: colors.hp },
        { val: hasBat ? e.batSavings : 0, color: colors.bat }
      ];

      segments.forEach(seg => {
        if (seg.val > 0) {
          const nextPos = currentPosVal + seg.val;
          drawSegment(x, yOfVal(currentPosVal), yOfVal(nextPos), seg.color, 1);
          currentPosVal = nextPos;
        } else if (seg.val < 0) {
          const nextNeg = currentNegVal + seg.val;
          drawSegment(x, yOfVal(currentNegVal), yOfVal(nextNeg), seg.color, 1);
          currentNegVal = nextNeg;
        }
      });

      // Net marker
      const net = e.baseloadImportSavings + e.baseloadExportSavings + (hasEv ? e.evSavings : 0) + (hasHp ? e.hpSavings : 0) + (hasBat ? e.batSavings : 0);
      const yNet = yOfVal(net);
      svg.appendChild(mk("line", {
        x1: x - 1, y1: yNet, x2: x + barW + 1, y2: yNet,
        stroke: "#ffffff", "stroke-width": 1.5, "stroke-linecap": "round"
      }));
    }
  });

  // X-axis date labels
  const step = Math.max(1, Math.floor(n / 8));
  days.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const lbl = mk("text", {
      x: xOf(i) + barW / 2, y: H - 8,
      "text-anchor": "middle", fill: "var(--text-muted)", "font-size": 9
    });
    
    const labelText = overviewMode === "week"
      ? d.replace(/(\d{4})-W(\d+)/, (_, y, w) => `W${w} '${y.slice(2)}`)
      : (overviewMode === "month"
         ? new Date(d + "-02T12:00:00Z").toLocaleDateString("nl-NL", { month: "short", year: "2-digit" })
         : new Date(d + "T12:00:00Z").toLocaleDateString("nl-NL", { day: "numeric", month: "short" })
        );
        
    lbl.textContent = labelText;
    svg.appendChild(lbl);
  });

  // Invisible Hover Overlays for Tooltip
  values.forEach((v, i) => {
    const x = xOf(i);
    const overlay = mk("rect", {
      x: x - 0.5, y: PAD_T, width: barW + 1.0, height: chartH,
      fill: "transparent", cursor: "crosshair"
    });
    
    const show = () => {
      const key = days[i];
      const val = bucketMap.get(key);
      
      let dateStr = "";
      if (overviewMode === "week") {
        dateStr = key.replace(/(\d{4})-W(\d+)/, (_, y, w) => `Week ${w}, ${y}`);
      } else if (overviewMode === "month") {
        const date = new Date(key + "-02T12:00:00Z");
        dateStr = date.toLocaleDateString("nl-NL", { year: "numeric", month: "long" });
      } else {
        dateStr = new Date(key + "T12:00:00Z").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
      }
      
      let html = `<h4 style="font-family:var(--font-display); border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.2rem; margin-bottom:0.4rem; color:var(--accent-cyan); font-size:0.85rem;">${dateStr}</h4>`;
      
      if (overviewMetric === "energy") {
        html += `<div class="tooltip-row"><span>Overige Afname:</span><span class="val" style="color:${colors.import}">${val.rawImp.toFixed(1)} kWh</span></div>`;
        if (hasEv) html += `<div class="tooltip-row"><span>EV Lader:</span><span class="val" style="color:${colors.ev}">${val.evKwh.toFixed(1)} kWh</span></div>`;
        if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:${colors.hp}">${val.hpKwh.toFixed(1)} kWh</span></div>`;
        if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Laden):</span><span class="val" style="color:${colors.bat_charge}">${val.batCharge.toFixed(1)} kWh</span></div>`;
        html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px dashed rgba(255,255,255,0.08); padding-top:0.3rem;"><span>Overige Teruglevering:</span><span class="val" style="color:${colors.return}">${val.rawExp.toFixed(1)} kWh</span></div>`;
        if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Ontladen):</span><span class="val" style="color:${colors.bat_discharge}">${val.batDischarge.toFixed(1)} kWh</span></div>`;
        
        const net = (val.rawImp + (hasEv ? val.evKwh : 0) + (hasHp ? val.hpKwh : 0) + (hasBat ? val.batCharge : 0))
                  - (val.rawExp + (hasBat ? val.batDischarge : 0));
        html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Netto Netbalans:</span><span class="val" style="color:${net >= 0 ? "var(--accent-orange)" : "var(--accent-green)"}">${net >= 0 ? "+" : ""}${net.toFixed(1)} kWh</span></div>`;
      } else if (overviewMetric === "cost") {
        html += `<div class="tooltip-row"><span>Overige Kosten:</span><span class="val" style="color:${colors.import}">€ ${val.baseloadCost.toFixed(2)}</span></div>`;
        if (hasEv) html += `<div class="tooltip-row"><span>EV Lader:</span><span class="val" style="color:${colors.ev}">€ ${val.evCost.toFixed(2)}</span></div>`;
        if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp:</span><span class="val" style="color:${colors.hp}">€ ${val.hpCost.toFixed(2)}</span></div>`;
        if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Laden):</span><span class="val" style="color:${colors.bat_charge}">€ ${val.batChargeCost.toFixed(2)}</span></div>`;
        html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px dashed rgba(255,255,255,0.08); padding-top:0.3rem;"><span>Overige Teruglevering:</span><span class="val" style="color:${colors.return}">€ ${val.baseloadReturn.toFixed(2)}</span></div>`;
        if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu (Ontladen):</span><span class="val" style="color:${colors.bat_discharge}">€ ${val.batDischargeValue.toFixed(2)}</span></div>`;
        
        const net = (val.baseloadCost + (hasEv ? val.evCost : 0) + (hasHp ? val.hpCost : 0) + (hasBat ? val.batChargeCost : 0))
                  - (val.baseloadReturn + (hasBat ? val.batDischargeValue : 0));
        html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Netto Variabele Kosten:</span><span class="val" style="color:${net >= 0 ? "var(--accent-orange)" : "var(--accent-green)"}">€ ${net.toFixed(2)}</span></div>`;
      } else { // savings
        html += `<div class="tooltip-row"><span>Besparing Overige Afname:</span><span class="val" style="color:${colors.import}">€ ${val.baseloadImportSavings.toFixed(2)}</span></div>`;
        html += `<div class="tooltip-row"><span>Besparing Overige Terug:</span><span class="val" style="color:${colors.return}">€ ${val.baseloadExportSavings.toFixed(2)}</span></div>`;
        if (hasEv) html += `<div class="tooltip-row"><span>EV Lader Besparing:</span><span class="val" style="color:${colors.ev}">€ ${val.evSavings.toFixed(2)}</span></div>`;
        if (hasHp) html += `<div class="tooltip-row"><span>Warmtepomp Besparing:</span><span class="val" style="color:${colors.hp}">€ ${val.hpSavings.toFixed(2)}</span></div>`;
        if (hasBat) html += `<div class="tooltip-row"><span>Thuisaccu Besparing:</span><span class="val" style="color:${colors.bat}">€ ${val.batSavings.toFixed(2)}</span></div>`;
        
        const net = val.baseloadImportSavings + val.baseloadExportSavings + (hasEv ? val.evSavings : 0) + (hasHp ? val.hpSavings : 0) + (hasBat ? val.batSavings : 0);
        html += `<div class="tooltip-row" style="margin-top:0.3rem; border-top:1px solid rgba(255,255,255,0.15); padding-top:0.3rem; font-weight:700;"><span>Totale Besparing:</span><span class="val" style="color:${net >= 0 ? "var(--accent-green)" : "var(--accent-orange)"}">€ ${net.toFixed(2)}</span></div>`;
      }
      
      tooltip.innerHTML = html;
      tooltip.style.display = "block";
      
      let tx = x + barW + 8;
      if (tx + 220 > W) tx = x - 228;
      tooltip.style.left = tx + "px";
      
      let yRef = yOfZero;
      if (overviewMetric === "energy") {
        const posSum = val.rawImp + (hasEv ? val.evKwh : 0) + (hasHp ? val.hpKwh : 0) + (hasBat ? val.batCharge : 0);
        const negSum = val.rawExp + (hasBat ? val.batDischarge : 0);
        yRef = yOfVal(Math.max(posSum, negSum));
      } else if (overviewMetric === "cost") {
        const posSum = val.baseloadCost + (hasEv ? val.evCost : 0) + (hasHp ? val.hpCost : 0) + (hasBat ? val.batChargeCost : 0);
        const negSum = val.baseloadReturn + (hasBat ? val.batDischargeValue : 0);
        yRef = yOfVal(Math.max(posSum, negSum));
      } else {
        let posSum = 0;
        const cats = [
          val.baseloadImportSavings,
          val.baseloadExportSavings,
          hasEv ? val.evSavings : 0,
          hasHp ? val.hpSavings : 0,
          hasBat ? val.batSavings : 0
        ];
        cats.forEach(c => { if (c > 0) posSum += c; });
        yRef = yOfVal(posSum);
      }
      tooltip.style.top = Math.max(0, yRef - 20) + "px";
      overlay.setAttribute("fill", "rgba(255,255,255,0.06)");
    };

    const hide = () => {
      tooltip.style.display = "none";
      overlay.setAttribute("fill", "transparent");
    };
    overlay.addEventListener("mouseenter", show);
    overlay.addEventListener("mouseleave", hide);
    _bindTouchTip(overlay, show, hide);

    svg.appendChild(overlay);
  });

  // Drag-to-zoom (alleen bij > 20 datapunten)
  if (allDays.length > 20) {
    _addDragZoom(
      svg, W, PAD_L, PAD_T, chartW, chartH,
      allDays.length, _overviewZoom ? _overviewZoom.start : 0, n,
      (s, e) => { _overviewZoom = { start: s, end: e, mode: overviewMode }; renderOverviewChart(); },
      () => { _overviewZoom = null; renderOverviewChart(); }
    );
  }
}

/**
 * Renders the Sankey energy flow diagram for a specific period.
 */
export function renderSankeyDiagram() {
  const card = document.getElementById("overview-chart-card");
  if (!__chartsDependencies.energyData || __chartsDependencies.energyData.length === 0) { card.style.display = "none"; return; }
  card.style.display = "";

  const pdt = __chartsDependencies.activeSimulation?.perDayTotals;
  const container = document.getElementById("overview-svg-container");
  const svg = document.getElementById("overview-svg");
  const tooltip = document.getElementById("overview-tooltip");
  const W = container.clientWidth;
  const H = container.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  
  if (!pdt || Object.keys(pdt).length === 0) return;

  const hasEv = !!__chartsDependencies.activeSimulation?.hwEffects?.ev?.enabled;
  const hasHp = !!__chartsDependencies.activeSimulation?.hwEffects?.hp?.enabled;
  const hasBat = !!__chartsDependencies.activeSimulation?.hwEffects?.bat?.enabled;

  // 1. Gather all volumes
  let solarYield = 0;
  let rawExp = 0;
  let evSolar = 0;
  let evGrid = 0;
  let hpSolar = 0;
  let hpGrid = 0;
  let batChargeSolar = 0;
  let batChargeGrid = 0;
  let batChargeGridCost = 0;
  let rawImp = 0;
  let batDischargeToHouse = 0;
  let batDischargeToGrid = 0;

  for (const [dayKey, v] of Object.entries(pdt)) {
    let match = false;
    if (sankeyInterval === "year") match = true;
    else if (sankeyInterval === "month") match = dayKey.slice(0, 7) === sankeyValue;
    else if (sankeyInterval === "week") match = isoWeek(dayKey) === sankeyValue;
    else if (sankeyInterval === "day") match = dayKey === sankeyValue;

    if (match) {
      solarYield += v.solarYield || 0;
      rawExp += v.rawExp || 0;
      evSolar += v.evSolar || 0;
      evGrid += v.evGrid || 0;
      hpSolar += v.hpSolar || 0;
      hpGrid += v.hpGrid || 0;
      batChargeSolar += v.batChargeSolar || 0;
      batChargeGrid += v.batChargeGrid || 0;
      batChargeGridCost += v.batChargeGridCost || 0;
      rawImp += v.rawImp || 0;
      batDischargeToHouse += v.batDischargeToHouse || 0;
      batDischargeToGrid += v.batDischargeToGrid || 0;
    }
  }

  // Calculate flow components
  const solarDirectHouse = Math.max(0, solarYield - rawExp);
  const baseloadExport = Math.max(0, rawExp - hpSolar - evSolar - batChargeSolar);
  const baseloadImport = Math.max(0, rawImp - batDischargeToHouse);
  const netImportVal = baseloadImport + evGrid + hpGrid + batChargeGrid;
  
  const batInflow = batChargeSolar + batChargeGrid;
  const batOutflow = batDischargeToHouse + batDischargeToGrid;
  
  const batSoCDraw = hasBat && batOutflow > batInflow ? batOutflow - batInflow : 0;
  const batLoss = hasBat && batInflow > batOutflow ? batInflow - batOutflow : 0;

  const houseVal = solarDirectHouse + baseloadImport + batDischargeToHouse;
  const evVal = evSolar + evGrid;
  const hpVal = hpSolar + hpGrid;
  const netExportVal = baseloadExport + batDischargeToGrid;

  // Battery bought highlights display
  const highlightEl = document.getElementById("sk-battery-price-highlight");
  if (highlightEl) {
    if (hasBat && batChargeGrid > 0) {
      const avgPrice = batChargeGridCost / batChargeGrid;
      highlightEl.innerHTML = `${ICON_BATTERY} <span>Gekocht: <span style="color:#ffffff;">${batChargeGrid.toFixed(1)} kWh</span> voor gem. <span style="color:var(--accent-yellow);">€ ${avgPrice.toFixed(3)}/kWh</span></span>`;
    } else if (hasBat) {
      highlightEl.innerHTML = `${ICON_BATTERY} <span>Geen net-laadstroom ingekocht in deze periode.</span>`;
    } else {
      highlightEl.innerHTML = "";
    }
  }

  // Nodes definition
  const PAD_L = 80, PAD_R = 110, PAD_T = 24, PAD_B = 24;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const nodeW = 16;

  // Column 0 inputs total, Column 2 outputs total
  const col0Val = solarYield + netImportVal + batSoCDraw;
  const totalFlow = Math.max(col0Val, 1);
  const availableH = chartH - 40;
  const scale = availableH / totalFlow;

  const nodes = {};
  const defineNode = (id, label, column, value, color) => {
    if (value <= 0) return;
    const h = Math.max(8, value * scale);
    if (!nodes[column]) nodes[column] = [];
    nodes[column].push({ id, label, value, h, color });
  };

  defineNode("solar", "Zon", 0, solarYield, "var(--accent-green)");
  defineNode("net_imp", "Net (Afname)", 0, netImportVal, "var(--accent-cyan)");
  if (hasBat && batSoCDraw > 0) {
    defineNode("bat_buf", "Accu Ontlading", 0, batSoCDraw, "var(--accent-orange)");
  }

  const batNodeVal = Math.max(batInflow, batOutflow);
  if (hasBat && batNodeVal > 0) {
    defineNode("battery", "Thuisaccu", 1, batNodeVal, "var(--accent-yellow)");
  }

  defineNode("house", "Woning (Overig)", 2, houseVal, "var(--accent-cyan)");
  if (hasEv && evVal > 0) {
    defineNode("ev", "EV Lader", 2, evVal, "var(--accent-blue)");
  }
  if (hasHp && hpVal > 0) {
    defineNode("hp", "Warmtepomp", 2, hpVal, "var(--accent-purple)");
  }
  defineNode("net_exp", "Net (Teruglevering)", 2, netExportVal, "var(--accent-green)");
  if (hasBat && batLoss > 0) {
    defineNode("loss", "Rendementsverlies", 2, batLoss, "var(--accent-orange)");
  }

  // Calculate coordinates
  const xCoords = [
    PAD_L,
    PAD_L + chartW / 2 - nodeW / 2,
    PAD_L + chartW - nodeW
  ];

  const allNodesList = [];
  [0, 1, 2].forEach(col => {
    const colNodes = nodes[col] || [];
    if (colNodes.length === 0) return;
    
    const totalH = colNodes.reduce((sum, n) => sum + n.h, 0);
    const gap = colNodes.length > 1 ? (chartH - totalH) / (colNodes.length - 1) : 0;
    
    let currentY = PAD_T;
    if (colNodes.length === 1) {
      currentY = PAD_T + (chartH - totalH) / 2;
    }
    
    colNodes.forEach(node => {
      node.x = xCoords[col];
      node.y = currentY;
      node.w = nodeW;
      node.sourceY = node.y;
      node.targetY = node.y;
      currentY += node.h + gap;
      allNodesList.push(node);
    });
  });

  const mk = (tag, attrs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  const drawLink = (sourceId, targetId, value, color) => {
    if (value <= 0) return;
    let srcNode = null, tgtNode = null;
    allNodesList.forEach(n => {
      if (n.id === sourceId) srcNode = n;
      if (n.id === targetId) tgtNode = n;
    });
    if (!srcNode || !tgtNode) return;

    const flowH = value * scale;
    const sy = srcNode.sourceY + flowH / 2;
    const ty = tgtNode.targetY + flowH / 2;
    srcNode.sourceY += flowH;
    tgtNode.targetY += flowH;

    const x1 = srcNode.x + srcNode.w;
    const x2 = tgtNode.x;
    const dx = x2 - x1;
    const c1 = x1 + dx * 0.45;
    const c2 = x2 - dx * 0.45;

    const d = `M ${x1} ${sy} C ${c1} ${sy}, ${c2} ${ty}, ${x2} ${ty}`;
    const path = mk("path", {
      d, fill: "none", stroke: color,
      "stroke-width": Math.max(0.5, flowH),
      "stroke-opacity": 0.22,
      cursor: "pointer"
    });

    path.addEventListener("mouseenter", () => {
      path.setAttribute("stroke-opacity", 0.65);
      tooltip.innerHTML = `<div style="font-size:0.78rem;"><strong style="color:${color};">${srcNode.label} ➔ ${tgtNode.label}</strong><br/>Volume: <span style="font-family:var(--font-display); font-weight:700; color:#ffffff;">${value.toFixed(1)} kWh</span></div>`;
      tooltip.style.display = "block";
      
      const tx = (x1 + x2) / 2 - 60;
      const ty_coord = (sy + ty) / 2 - 20;
      tooltip.style.left = Math.max(5, Math.min(W - 150, tx)) + "px";
      tooltip.style.top = Math.max(5, Math.min(H - 60, ty_coord)) + "px";
    });

    path.addEventListener("mouseleave", () => {
      path.setAttribute("stroke-opacity", 0.22);
      tooltip.style.display = "none";
    });

    svg.appendChild(path);
  };

  // Draw links
  // 1. Out from Solar (green)
  drawLink("solar", "house", solarDirectHouse, "var(--accent-green)");
  if (hasEv) drawLink("solar", "ev", evSolar, "var(--accent-green)");
  if (hasHp) drawLink("solar", "hp", hpSolar, "var(--accent-green)");
  if (hasBat) drawLink("solar", "battery", batChargeSolar, "var(--accent-green)");
  drawLink("solar", "net_exp", baseloadExport, "var(--accent-green)");

  // 2. Out from Net Import (cyan)
  drawLink("net_imp", "house", baseloadImport, "var(--accent-cyan)");
  if (hasEv) drawLink("net_imp", "ev", evGrid, "var(--accent-cyan)");
  if (hasHp) drawLink("net_imp", "hp", hpGrid, "var(--accent-cyan)");
  if (hasBat) drawLink("net_imp", "battery", batChargeGrid, "var(--accent-cyan)");

  // 3. Out from Battery buffer (orange)
  if (hasBat && batSoCDraw > 0) {
    drawLink("bat_buf", "battery", batSoCDraw, "var(--accent-orange)");
  }

  // 4. Out from Battery (yellow/orange)
  if (hasBat) {
    drawLink("battery", "house", batDischargeToHouse, "var(--accent-yellow)");
    drawLink("battery", "net_exp", batDischargeToGrid, "var(--accent-yellow)");
    if (batLoss > 0) {
      drawLink("battery", "loss", batLoss, "var(--accent-orange)");
    }
  }

  // Render node rectangles & labels
  allNodesList.forEach(node => {
    const rect = mk("rect", {
      x: node.x, y: node.y, width: node.w, height: node.h,
      fill: node.color, rx: 3, "fill-opacity": 0.85,
      stroke: "rgba(255,255,255,0.15)", "stroke-width": 1.2
    });
    svg.appendChild(rect);

    const isCol0 = node.x < W / 3;
    const isCol2 = node.x > (2 * W) / 3;
    const textAnchor = isCol0 ? "end" : (isCol2 ? "start" : "middle");
    const textX = isCol0 ? node.x - 8 : (isCol2 ? node.x + node.w + 8 : node.x + node.w / 2);

    const lbl = mk("text", {
      x: textX, y: node.y + node.h / 2 - 2,
      "text-anchor": textAnchor, fill: "#ffffff",
      "font-size": 9.5, "font-weight": 600,
      "font-family": "var(--font-display)"
    });
    lbl.textContent = node.label;
    svg.appendChild(lbl);

    const valLbl = mk("text", {
      x: textX, y: node.y + node.h / 2 + 8,
      "text-anchor": textAnchor, fill: "var(--text-muted)",
      "font-size": 8, "font-family": "var(--font-body)"
    });
    valLbl.textContent = `${node.value.toFixed(1)} kWh`;
    svg.appendChild(valLbl);
  });
}

