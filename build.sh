#!/bin/bash
set -e

echo "Building the application bundle..."
# Gebruik npm run build (welke npx esbuild aanroept)
npm install
npm run build

echo "Build complete! Open index.html to view the application."
