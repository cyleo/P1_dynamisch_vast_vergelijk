const fs = require('fs');

const src = fs.readFileSync('src/app.js', 'utf8');

function extractFunction(name) {
  const startIdx = src.indexOf(`function ${name}(`);
  if (startIdx === -1) return null;
  
  let braceCount = 0;
  let inFunction = false;
  let endIdx = -1;
  
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') {
      braceCount++;
      inFunction = true;
    } else if (src[i] === '}') {
      braceCount--;
      if (inFunction && braceCount === 0) {
        endIdx = i;
        break;
      }
    }
  }
  
  return src.substring(startIdx, endIdx + 1);
}

const f1 = extractFunction('getFallbackSpot');
const f2 = extractFunction('buildSimContext');
const f3 = extractFunction('_simulateCore');

// add exports to them
const e1 = f1.replace('function getFallbackSpot', 'export function getFallbackSpot');
const e2 = f2.replace('function buildSimContext', 'export function buildSimContext');
const e3 = f3.replace('function _simulateCore', 'export function _simulateCore');

const engineCode = `// src/domain/engine.js
// Extracted simulation engine.
import { appStore } from "./store.js";
import {
  rowMeta, epexKey, toConsumerPrice, seasonOf,
  precomputeEVSchedules, precomputeBatterySchedule,
  applyHeatPumpLoad, applyEVLoad, applyBatteryState, applySmartDimming
} from "./energyMath.js";
import { EPEX_PROFILES } from "./constants.js";

${e1}

${e2}

${e3}
`;

fs.writeFileSync('src/domain/engine.js', engineCode);
console.log('Extracted to src/domain/engine.js');
