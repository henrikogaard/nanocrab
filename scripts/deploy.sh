#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Typecheck"
npm run typecheck

echo "==> Focused tests"
npm test -- src/formatting.test.ts src/container-runner.test.ts

echo "==> Build host app"
npm run build

echo "==> Build agent image"
./container/build.sh latest

echo "==> MCP smoke check"
npm run mcp:smoke

if command -v systemctl >/dev/null 2>&1; then
  echo "==> Restart nanocrab user service"
  systemctl --user restart nanocrab
  systemctl --user status nanocrab --no-pager
else
  echo "systemctl not available; skipping service restart"
fi

echo "Deploy complete"
