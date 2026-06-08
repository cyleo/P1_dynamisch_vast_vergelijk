const fs = require('fs');

let lines = fs.readFileSync('src/app.js', 'utf8').split('\n');

const globals = [
  "energyData", "overviewMode", "overviewMetric", "activeViewType",
  "sankeyInterval", "sankeyValue", "simMode", "simDrillDay", "activeSimulation",
  "profileVisibleLines", "epexHistory", "liveEnergyTax", "_lastHAStats",
  "_lastRoleMap", "digitalTwinEnabled", "isDemoData", "fullYearData",
  "fullYearStamp", "yearScale", "dataMeta", "epexWarnDismissed",
  "prognosisDismissed", "dataQualityDismissed", "calibratedProfile", "calibrationMeta"
];

// Step 1: Replace all writes
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const g of globals) {
    // Only replace true assignments `var = value;` and not object properties `obj.var = value;`
    if (line.match(new RegExp(`^(\\s*)${g}\\s*=\\s*([^=].*)`)) && !line.includes('let ' + g)) {
      lines[i] = line.replace(new RegExp(`^(\\s*)${g}\\s*=\\s*(.+?)(;\\s*(?://.*)?)$`), `$1appStore.setState({ ${g}: $2 })$3`);
      
      // If it missed because of no semicolon, do a more aggressive replacement
      if (lines[i] === line) {
         lines[i] = line.replace(new RegExp(`^(\\s*)${g}\\s*=\\s*(.+?)$`), `$1appStore.setState({ ${g}: $2 })`);
      }
    }
  }
}

// Write the lines back to a single string
let src = lines.join('\n');

// Step 2: Inject the Store Sync block right under the global definitions.
// Actually, let's just find `// Global state` and replace the block down to `let calibratedProfile = null;`
const storeImportBlock = `
import { appStore } from "./domain/store.js";

// Keep local let bindings for READS, but sync them via Pub/Sub to allow zero-risk refactoring
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
`;

src = src.replace(/\/\/ Global state\nlet energyData[\s\S]*?let calibratedProfile = null;\s*(?:\/\/[^\n]+)?/, storeImportBlock.trim());

fs.writeFileSync('src/app.js', src);
console.log("Safely refactored app.js using Pub/Sub Sync!");
