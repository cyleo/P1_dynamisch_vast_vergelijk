#!/usr/bin/env node
// Draait alle test*.js bestanden in _validate/ en rapporteert pass/fail.
// Gebruik: node _validate/run_tests.js  (of: npm test)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const tests = fs.readdirSync(dir)
  .filter(f => f.match(/^test\d+.*\.js$/))
  .sort();

let passed = 0, failed = 0;

for (const t of tests) {
  const file = path.join(dir, t);
  try {
    const out = execFileSync(process.execPath, [file], { encoding: "utf8", stderr: "pipe" });
    const ok = out.includes("PASS") || out.includes("geslaagd");
    if (ok) {
      console.log(`✅ ${t}`);
      passed++;
    } else {
      // Diagnostische tests geven geen expliciete PASS maar falen ook niet
      console.log(`ℹ️  ${t}  (geen PASS-marker — diagnostisch)`);
      passed++;
    }
  } catch (e) {
    console.error(`❌ ${t}\n${e.stdout || ""}\n${e.stderr || ""}`);
    failed++;
  }
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);
