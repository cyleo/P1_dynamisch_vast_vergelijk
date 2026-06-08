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

// Een test FAALT als: (a) hij een niet-nul exitcode geeft (assert-tests zetten
// process.exitCode=1), of (b) de output een FAIL/GEFAALD/❌-regel bevat — ook als de
// exitcode per ongeluk 0 bleef. Anders geslaagd (assert-test met PASS, óf diagnostisch).
const FAIL_RE = /^(FAIL\b|❌)|GEFAALD/m;

for (const t of tests) {
  const file = path.join(dir, t);
  let out = "", code = 0, err = "";
  try {
    out = execFileSync(process.execPath, [file], { encoding: "utf8" });
  } catch (e) {
    code = e.status ?? 1;
    out = e.stdout || "";
    err = e.stderr || "";
  }

  if (code !== 0 || FAIL_RE.test(out)) {
    console.error(`❌ ${t}\n${out}\n${err}`);
    failed++;
    continue;
  }

  if (/\bPASS\b|geslaagd/.test(out)) {
    console.log(`✅ ${t}`);
  } else {
    console.log(`ℹ️  ${t}  (geen PASS-marker — diagnostisch)`);
  }
  passed++;
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed > 0 ? 1 : 0);
