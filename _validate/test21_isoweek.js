// TEST 21 — ISO week-year correctheid (jaargrens-gevallen).
// Bouwt energyMath.js apart als CJS-module om isoWeek te kunnen testen zonder de
// volledige app-bundle te laden.
const esbuild = require("esbuild");
const path = require("path");
const vm = require("vm");

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "domain", "energyMath.js")],
  bundle: true,
  format: "cjs",
  write: false,
});

const mod = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module: mod, exports: mod.exports, require });
const { isoWeek } = mod.exports;

let pass = true;
function check(dateStr, expected) {
  const got = isoWeek(dateStr);
  if (got !== expected) {
    console.error(`FAIL isoWeek("${dateStr}"): verwacht ${expected}, kreeg ${got}`);
    pass = false;
  }
}

// Jaargrens: late december valt in het ISO-jaar van zijn donderdag.
// 2024-12-29 = zondag → donderdag = 2024-12-26 → ISO 2024-W52 (blijft in 2024)
check("2024-12-29", "2024-W52");
// 2024-12-30 = maandag → donderdag = 2025-01-02 → ISO 2025-W01 (over naar volgend jaar)
check("2024-12-30", "2025-W01");

// 2027-01-01 = vrijdag → donderdag van die week = 2026-12-31 → ISO 2026-W53
check("2027-01-01", "2026-W53");

// 2027-01-04 = maandag → donderdag = 2027-01-07 → ISO 2027-W01
check("2027-01-04", "2027-W01");

// 2026-12-29 = dinsdag → donderdag = 2026-12-31 → ISO 2026-W53
check("2026-12-29", "2026-W53");

// Midden-in-het-jaar: geen verandering verwacht (referentiepunt)
// 2026-06-10 = woensdag → donderdag = 2026-06-11 → ISO 2026-W24
check("2026-06-10", "2026-W24");

// 2026-01-01 = donderdag → zelf de donderdag → ISO 2026-W01
check("2026-01-01", "2026-W01");

if (pass) {
  console.log("PASS test21_isoweek — alle ISO-jaargrens-gevallen correct");
} else {
  process.exitCode = 1;
}
