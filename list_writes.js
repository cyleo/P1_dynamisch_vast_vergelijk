const fs = require('fs');
const lines = fs.readFileSync('src/app.js', 'utf8').split('\n');

const globals = [
  "energyData", "overviewMode", "overviewMetric", "activeViewType",
  "sankeyInterval", "sankeyValue", "simMode", "simDrillDay", "activeSimulation",
  "profileVisibleLines", "epexHistory", "liveEnergyTax", "_lastHAStats",
  "_lastRoleMap", "digitalTwinEnabled", "isDemoData", "fullYearData",
  "fullYearStamp", "yearScale", "dataMeta", "epexWarnDismissed",
  "prognosisDismissed", "dataQualityDismissed", "calibratedProfile", "calibrationMeta"
];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (const g of globals) {
    if (line.match(new RegExp(`^\\s*${g}\\s*=[^=]`, 'g')) && !line.includes('let ' + g)) {
      console.log(`${i+1}: ${line.trim()}`);
    }
  }
}
