#!/usr/bin/env bash
# Builds a distributable copy in dist/: an obfuscated/minified script, plus
# the same html/css, with index.html pointed at that file instead of the
# readable source. Ship dist/, keep script.js (the commented source) private.
#
# Usage: ./build.sh   (run from the pressurevalve/ folder)
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

if command -v javascript-obfuscator >/dev/null 2>&1 || npm install -g javascript-obfuscator >/dev/null 2>&1; then
  javascript-obfuscator script.js \
    --output dist/script.min.js \
    --compact true \
    --control-flow-flattening true \
    --control-flow-flattening-threshold 0.75 \
    --dead-code-injection true \
    --dead-code-injection-threshold 0.3 \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-threshold 0.75 \
    --self-defending true \
    --disable-console-output false
  echo "Built dist/script.min.js with javascript-obfuscator."
else
  echo "javascript-obfuscator unavailable (no network) — falling back to the built-in minifier." >&2
  node minify.js script.js dist/script.min.js
  echo "Built dist/script.min.js with the fallback minifier (comments and whitespace stripped, names unchanged)."
  echo "For real obfuscation (renamed identifiers, string encoding, control-flow flattening), run this again with network access."
fi

sed 's/script\.js/script.min.js/' index.html > dist/index.html
cp style.css dist/style.css

echo "dist/ is ready to ship."
