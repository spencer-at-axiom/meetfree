#!/usr/bin/env bash
set -euo pipefail

run_step() {
  local name="$1"
  shift
  echo
  echo "==> ${name}"
  "$@"
}

run_step "Verify Tauri command contract" node scripts/check-tauri-command-contract.js
run_step "Frontend lint" pnpm --dir desktop lint
run_step "Frontend tests" pnpm --dir desktop test
run_step "Frontend build" pnpm --dir desktop build
run_step "Rust check" cargo check -p meetfree --locked
run_step "Rust lib tests" cargo test -p meetfree --lib --locked

echo
echo "Release smoke gate passed."
