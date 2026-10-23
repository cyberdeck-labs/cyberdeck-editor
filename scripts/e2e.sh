#!/usr/bin/env bash
# Headless-E2E-Test: frischer Test-Vault, Electron ohne Bildschirm, Ergebnisse in $OUT
set -euo pipefail
cd "$(dirname "$0")/.."
T=${EDITOR_TESTDIR:-${TMPDIR:-/tmp}/editor-test}
SRC_VAULT=${1:-}
OUT=$T/out
rm -rf "$OUT" "$T/ud"
mkdir -p "$OUT"
node scripts/make-test-vault.mjs "$T/vault" $SRC_VAULT
EDITOR_USERDATA=$T/ud EDITOR_VAULT=$T/vault EDITOR_TEST=scripts/e2e-test.js EDITOR_OUT=$OUT \
  timeout 180 npx electron . --ozone-platform=headless --disable-gpu --force-device-scale-factor=1 --ozone-override-screen-size=1600,1000 > "$OUT/electron.log" 2>&1 || true
node -e "const r=require('$OUT/e2e-test.json'); if(r.fatal){console.log('FATAL',r.fatal);process.exit(1)} for(const [k,v] of Object.entries(r.checks)) console.log((v.pass?'PASS ':'FAIL ')+k+(v.pass?'':'  '+JSON.stringify(v).slice(0,400))); console.log(r.passed+'/'+r.total+' bestanden; JS-Fehler: '+JSON.stringify(r.errors).slice(0,300)); process.exit(r.passed===r.total?0:1)"
