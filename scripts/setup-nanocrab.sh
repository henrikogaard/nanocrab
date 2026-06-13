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
APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
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
  echo -e "${CYAN}       _     _     _     _     _     _${NC}"
  echo -e "${CYAN}      / \\___/ \\___/ \\___/ \\___/ \\___/ \\\\${NC}"
  echo -e "${CYAN}     (  o   o   N A N O C R A B   o   o )${NC}"
  echo -e "${CYAN}      \\_/---\\_/---\\_/---\\_/---\\_/---\\_/${NC}"
  echo -e "${CYAN}          \\_V_/                 \\_V_/${NC}"
  echo ""
  echo -e "${BOLD}NanoCrab - NanoCrab Edition${NC}"
  echo -e "${BOLD}Edition 2.0-Beta1 | App $APP_VERSION${NC}"
  echo -e "${BOLD}Standalone Personal AI Assistant${NC}"
  echo ""
}

redact() {
  perl -pe 's/(Bearer\s+)[A-Za-z0-9._~+\/=-]+/${1}[REDACTED]/g; s/(sk-)[A-Za-z0-9._-]+/${1}[REDACTED]/g; s/((?:authorization|cookie|password|secret|token|api[_-]?key|credential[_-]?proxy)[^=:\n]{0,20}[=:]\s*)[^ \t\r\n"&]+/${1}[REDACTED]/ig; s#(/__nanocrab/providers/)[^ \t\r\n"&]+#${1}[REDACTED]#g'
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
  COMPLETED=$(node -e "const fs=require('fs'); const [statePath,...entries]=process.argv.slice(1); const names=entries.map((entry)=>entry.split(':')[0]); let state={version:2,updatedAt:new Date().toISOString(),steps:Object.fromEntries(names.map((name)=>[name,{status:'pending'}]))}; try{const raw=JSON.parse(fs.readFileSync(statePath,'utf8')); if(Array.isArray(raw.completed)){for(const name of raw.completed) if(state.steps[name]) state.steps[name]={status:'completed'};} if(raw.steps){for(const name of names) if(raw.steps[name]) state.steps[name]=raw.steps[name];}}catch{} let changed=false; for(const name of names){if(state.steps[name]?.status==='running'){state.steps[name]={...state.steps[name],status:'failed',failedAt:new Date().toISOString(),error:'Setup was interrupted while this step was running'}; changed=true;}} if(changed) fs.writeFileSync(statePath, JSON.stringify(state,null,2)+'\n', {mode:0o600}); console.log(names.filter((name)=>state.steps[name]?.status==='completed').join(','));" "$STATE_FILE" "${STEPS[@]}" 2>/dev/null || echo "")
  [ -f "$STATE_FILE" ] && chmod 600 "$STATE_FILE" 2>/dev/null || true
}

save_state() {
  local step="$1"
  local status="$2"
  local error="${3:-}"
  node -e "const fs=require('fs'); const [statePath,step,status,error,...entries]=process.argv.slice(1); const names=entries.map((entry)=>entry.split(':')[0]); let state={version:2,updatedAt:new Date().toISOString(),steps:Object.fromEntries(names.map((name)=>[name,{status:'pending'}]))}; try{const raw=JSON.parse(fs.readFileSync(statePath,'utf8')); if(Array.isArray(raw.completed)){for(const name of raw.completed) if(state.steps[name]) state.steps[name]={status:'completed'};} if(raw.steps){for(const name of names) if(raw.steps[name]) state.steps[name]=raw.steps[name];}}catch{} const now=new Date().toISOString(); const next={...(state.steps[step]||{status:'pending'}),status}; if(status==='running'){next.startedAt=now; delete next.completedAt; delete next.failedAt; delete next.error;} if(status==='completed'){next.completedAt=now; delete next.failedAt; delete next.error;} if(status==='failed'){next.failedAt=now; next.error=error||'Step failed';} state.steps[step]=next; state.updatedAt=now; fs.writeFileSync(statePath, JSON.stringify(state,null,2)+'\n', {mode:0o600});" "$STATE_FILE" "$step" "$status" "$error" "${STEPS[@]}" 2>/dev/null || true
  [ -f "$STATE_FILE" ] && chmod 600 "$STATE_FILE" 2>/dev/null || true
}

init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    node -e "const fs=require('fs'); const [statePath,...entries]=process.argv.slice(1); const names=entries.map((entry)=>entry.split(':')[0]); const state={version:2,updatedAt:new Date().toISOString(),steps:Object.fromEntries(names.map((name)=>[name,{status:'pending'}]))}; fs.writeFileSync(statePath, JSON.stringify(state,null,2)+'\n', {mode:0o600});" "$STATE_FILE" "${STEPS[@]}" 2>/dev/null || echo "{\"completed\": [], \"version\": 1}" > "$STATE_FILE"
  fi
  chmod 600 "$STATE_FILE" 2>/dev/null || true
  load_state
}

run_preflight_gate() {
  echo ""
  echo -e "  ${CYAN}›${NC} ${BOLD}preflight${NC} — prerequisite readiness before container build"
  if npx tsx setup/index.ts --preflight 2>&1 | redact | tee -a "$LOG_FILE"; then
    echo -e "  ${GREEN}✓${NC} preflight completed"
    return 0
  fi
  echo -e "  ${RED}✖${NC} preflight failed"
  echo -e "  ${YELLOW}Run:${NC} npm run setup -- --dry-run"
  return 1
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
  save_state "$step_name" "running"

  if npx tsx setup/index.ts --step "$step_name" 2>&1 | redact | tee -a "$LOG_FILE"; then
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
    save_state "$step_name" "failed" "command exited non-zero"
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
    if [ "$step_name" = "container" ]; then
      run_preflight_gate || exit 1
      load_state
    fi
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
