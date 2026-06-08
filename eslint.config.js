// ESLint flat config (ESLint 9+).
// Pragmatische basis: vangt echte fouten (recommended) maar zet de ruis-regels op "warn"
// zodat `npm run lint` slaagt en de bevindingen incrementeel opgepakt kunnen worden.
// NB: de root `app.js`/`worker.js` zijn esbuild-output (gebundeld) → niet linten.
import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "app.js",
      "app.js.map",
      "worker.js",
      "worker.js.map",
      "dist/**",
      "demo-year.js",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  {
    // BOM/unicode-whitespace in strings, comments en regexes is hier bewust (bv. BOM strippen
    // in CSV-parsers) → geen harde fout; alleen stray whitespace in code waarschuwen.
    rules: {
      "no-irregular-whitespace": [
        "warn",
        { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true },
      ],
    },
  },
  {
    // Browser-broncode (ES Modules). Een aantal symbolen leeft bewust in de gebundelde
    // IIFE-scope (bv. getFallbackSpot in energyMath.js) → no-undef als waarschuwing, niet fout.
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["warn", { checkLoops: false }],
    },
  },
  {
    // Node-validatietests (CommonJS).
    files: ["_validate/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
    },
  },
  // Schakelt opmaak-regels uit die met Prettier botsen (Prettier doet de opmaak).
  prettier,
];
