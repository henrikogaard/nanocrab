#!/usr/bin/env bash
set -euo pipefail

# NanoCrab Setup Orchestrator
# Runs all setup steps in order with resume support.
# Safe to re-run after partial failure.
# Usage: bash scripts/setup-nanocrab.sh [--step <name>]
#        bash scripts/setup-nanocrab.sh --all   (runs everything)
#        bash scripts/setup-nanocrab.sh --resume (continues from last failed step)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

STATE_FILE=".setup-state.json"
LOG_FILE="logs/setup.log"
mkdir -p logs

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── ASCII Banner ──
print_banner() {
  echo ""
  echo -e "${CYAN}                 ╱|、${NC}"
  echo -e "${CYAN}               (˚ˎ 。7${NC}"
  echo -e "${CYAN}                |、˜〵${NC}"
  echo -e "${CYAN}                じしˍ,)ノ${NC}"
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║        🦀  N A N O C R A B          ║${NC}"
  echo -e "${BOLD}║   Standalone Personal AI Assistant   ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
}

# ── Step definitions ──
STEPS=(
  "environment:Check prerequisites (Node, Docker, ports)"
  "timezone:Detect system timezone"
  "admin:Create admin account (username/password)"
  "provider:Select default AI provider"
  "container:Build agent container image"
  "mounts:Configure filesystem mounts"
  "register:Register primary chat group"
  "service:Install system service (launchd/systemd)"
  "verify:End-to-end verification"
)

# ── State tracking ──
load_state() {
  if [ -f "$STATE_FILE" ]; then
    COMPLETED=$(python3 -c "import json; d=json.load(open('$STATE_FILE')); print(','.join(d.get('completed', [])))" 2>/dev/null || echo "")
  else
    COMPLETED=""
  fi
}

save_state() {
  local step="$1"
  local status="$2"
  local completed_list=""
  if [ -f "$STATE_FILE" ]; then
    completed_list=$(python3 -c "
import json
with open('$STATE_FILE') as f:
    d = json.load(f)
if '$status' == 'completed' and '$step' not in d.get('completed', []):
    d.setdefault('completed', []).append('$step')
with open('$STATE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
" 2>/dev/null || true)
  else
    if [ "$status" = "completed" ]; then
      echo "{\"completed\": [\"$step\"], \"version\": 1}" > "$STATE_FILE"
    fi
  fi
}

init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    echo "{\"completed\": [], \"version\": 1}" > "$STATE_FILE"
  fi
  load_state
}

# ── Run a single step ──
run_step() {
  local step_name="$1"
  local step_desc="$2"

  # Check if already completed
  if echo "$COMPLETED" | grep -q "$step_name"; then
    echo -e "  ${YELLOW}↻${NC} $step_name — already completed, skipping"
    return 0
  fi

  echo ""
  echo -e "  ${CYAN}›${NC} ${BOLD}$step_name${NC} — $step_desc"
  echo -e "  ${CYAN}${BOLD}$(printf '─%.0s' $(seq 1 $((${#step_name} + ${#step_desc} + 5))))${NC}"

  local start_time
  start_time=$(date +%s)

  if npx tsx setup/index.ts --step "$step_name" 2>&1 | tee -a "$LOG_FILE"; then
    local end_time
    end_time=$(date +%s)
    local elapsed=$((end_time - start_time))
    echo -e "  ${GREEN}✓${NC} $step_name completed (${elapsed}s)"
    save_state "$step_name" "completed"
    return 0
  else
    local end_time
    end_time=$(date +%s)
    local elapsed=$((end_time - start_time))
    echo -e "  ${RED}✖${NC} $step_name failed after ${elapsed}s"
    echo ""
    echo -e "  ${YELLOW}Recovery:${NC}"
    echo -e "    • Fix the issue above"
    echo -e "    • Re-run: ${BOLD}bash scripts/setup-nanocrab.sh --resume${NC}"
    echo -e "    • Or skip: ${BOLD}bash scripts/setup-nanocrab.sh --step $(echo "$step_name" | sed 's/ .*//')${NC}"
    echo ""
    return 1
  fi
}

# ── Run all steps ──
run_all() {
  print_banner
  echo -e "  ${BOLD}Starting NanoCrab setup${NC}"
  echo -e "  Log: $LOG_FILE"
  echo ""
  init_state
  load_state

  for step_entry in "${STEPS[@]}"; do
    local step_name="${step_entry%%:*}"
    local step_desc="${step_entry#*:}"
    if ! run_step "$step_name" "$step_desc"; then
      echo -e "  ${RED}Setup aborted at: $step_name${NC}"
      exit 1
    fi
  done

  echo ""
  echo -e "  ${GREEN}${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "  ${GREEN}${BOLD}║   Setup complete!                    ║${NC}"
  echo -e "  ${GREEN}${BOLD}║   Run  npm run start  to launch       ║${NC}"
  echo -e "  ${GREEN}${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
}

# ── Main ──
main() {
  local mode="${1:---all}"

  case "$mode" in
    --all)
      run_all
      ;;
    --resume)
      run_all
      ;;
    --step)
      if [ -z "${2:-}" ]; then
        echo "Usage: $0 --step <name>"
        echo "Available steps:"
        for step_entry in "${STEPS[@]}"; do
          echo "  ${step_entry%%:*}"
        done
        exit 1
      fi
      print_banner
      init_state
      load_state
      local found=false
      for step_entry in "${STEPS[@]}"; do
        if [ "${step_entry%%:*}" = "$2" ]; then
          run_step "$2" "${step_entry#*:}"
          found=true
          break
        fi
      done
      if [ "$found" = false ]; then
        echo "Unknown step: $2"
        exit 1
      fi
      ;;
    --help|-h)
      echo "NanoCrab Setup Orchestrator"
      echo ""
      echo "Usage:"
      echo "  bash scripts/setup-nanocrab.sh --all       Run all steps"
      echo "  bash scripts/setup-nanocrab.sh --resume    Resume from last failure"
      echo "  bash scripts/setup-nanocrab.sh --step <n>  Run single step"
      echo ""
      echo "Steps (in order):"
      for step_entry in "${STEPS[@]}"; do
        echo "  ${step_entry%%:*}: ${step_entry#*:}"
      done
      ;;
    *)
      echo "Unknown mode: $mode"
      echo "Usage: bash scripts/setup-nanocrab.sh [--all|--resume|--step <name>]"
      exit 1
      ;;
  esac
}

main "$@"
