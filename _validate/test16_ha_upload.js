const fs = require('fs');
const path = require('path');
const { sandbox } = require('./harness');

const CSV_FILE = path.join(__dirname, '..', 'home_assistant_export.csv');

try {
  console.log("=== TEST 16: HA HISTORY CSV PARSING WITH DEMO_ROLEMAP ===");
  
  if (!fs.existsSync(CSV_FILE)) {
    console.log("SKIP  test16_ha_upload (home_assistant_export.csv not found)");
    process.exit(0);
  }

  const fileContent = fs.readFileSync(CSV_FILE, 'utf8');
  const lines = fileContent.trim().split('\n');
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim());

  console.log(`Loading CSV file: ${CSV_FILE} (${lines.length} lines)`);

  const records = sandbox.parseHAHistoryExportCSV(
    lines,
    sep,
    headers,
    sandbox.DEMO_ROLEMAP,
    true // dtEnabled
  );

  if (!Array.isArray(records)) {
    throw new Error("Expected parseHAHistoryExportCSV to return an array, got " + typeof records);
  }

  console.log(`Parsed ${records.length} records successfully.`);
  if (records.length === 0) {
    throw new Error("Expected non-empty records list from home_assistant_export.csv");
  }

  // Check structure of first record
  const first = records[0];
  console.log("First parsed record sample:", first);
  if (first.timestamp === undefined || first.import_t1 === undefined || first.export_t1 === undefined) {
    throw new Error("Parsed record is missing key fields: timestamp, import_t1, export_t1");
  }

  console.log("PASS  test16_ha_upload");
  process.exit(0);
} catch (e) {
  console.error("FAIL  test16_ha_upload");
  console.error(e);
  process.exit(1);
}
