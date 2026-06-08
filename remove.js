const fs = require('fs');

let src = fs.readFileSync('src/app.js', 'utf8');

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
  
  return { start: startIdx, end: endIdx };
}

const f1 = extractFunction('getFallbackSpot');
const f2 = extractFunction('buildSimContext');
const f3 = extractFunction('_simulateCore');

let bounds = [f1, f2, f3].filter(Boolean).sort((a,b) => b.start - a.start);

for (const b of bounds) {
  src = src.substring(0, b.start) + src.substring(b.end + 1);
}

const importBlock = `
import { getFallbackSpot, buildSimContext, _simulateCore } from "./domain/engine.js";
`;

src = src.replace('import { appStore } from "./domain/store.js";', 'import { appStore } from "./domain/store.js";\n' + importBlock);

// remove the _simulateCore global leak from the window
src = src.replace('window._simulateCore = _simulateCore;\n', '');
src = src.replace('window.getFallbackSpot = getFallbackSpot;\n', '');

fs.writeFileSync('src/app.js', src);
console.log('Removed functions from src/app.js and added import.');
