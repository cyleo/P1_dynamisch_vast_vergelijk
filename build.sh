#!/usr/bin/env bash
set -e

echo "Building P1 Energie Contract Analysator..."

# Verify esbuild is installed
if ! command -v npx >/dev/null 2>&1; then
    echo "Error: npx is not installed. Please install Node.js."
    exit 1
fi

# Run esbuild bundling
npx esbuild src/app.js --bundle --outfile=dist/app.bundle.js --minify --sourcemap

echo "Build complete! Output in dist/app.bundle.js"
