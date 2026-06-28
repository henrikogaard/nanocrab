#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE_INPUT="${LOG_FILE:-logs/nanocrab.log}"
DB_FILE_INPUT="${DB_FILE:-store/messages.db}"
TAIL_LINES="${TAIL_LINES:-200}"

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$ROOT_DIR" "$1" ;;
  esac
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command missing: $1"
}

require_file() {
  [ -f "$1" ] || die "Required file missing: $1"
}

section() {
  echo
  echo "== $1 =="
}

has_column() {
  local table="$1"
  local column="$2"
  local match
  match="$(sqlite3 -readonly "$DB_FILE_PATH" "SELECT 1 FROM pragma_table_info('$table') WHERE name = '$column' LIMIT 1;" 2>/dev/null || true)"
  [ "$match" = "1" ]
}

case "$TAIL_LINES" in
  ''|*[!0-9]*) die "TAIL_LINES must be a positive integer (got: $TAIL_LINES)" ;;
  0) die 'TAIL_LINES must be greater than 0' ;;
esac

require_cmd ps
require_cmd grep
require_cmd tail
require_cmd sqlite3

LOG_FILE_PATH="$(resolve_path "$LOG_FILE_INPUT")"
DB_FILE_PATH="$(resolve_path "$DB_FILE_INPUT")"

require_file "$LOG_FILE_PATH"
require_file "$DB_FILE_PATH"

section "Signal runtime inputs"
echo "LOG_FILE=$LOG_FILE_PATH"
echo "DB_FILE=$DB_FILE_PATH"
echo "TAIL_LINES=$TAIL_LINES"

section "Process check"
echo "signal-cli processes:"
SIGNAL_PROCESSES="$(ps -ax -o pid=,command= | grep -E '[s]ignal-cli' || true)"
if [ -n "$SIGNAL_PROCESSES" ]; then
  echo "$SIGNAL_PROCESSES"
else
  echo "(none found)"
fi

echo
echo "nanocrab processes:"
NANOCRAB_PROCESSES="$(ps -ax -o pid=,command= | grep -E '[n]anocrab|dist/index\.js|src/index\.ts' || true)"
if [ -n "$NANOCRAB_PROCESSES" ]; then
  echo "$NANOCRAB_PROCESSES"
else
  echo "(none found)"
fi

section "Signal log snippets"
if ! grep -E 'Connected to Signal|Signal: reusing existing daemon|signal-cli daemon|Signal message stored|Message from unregistered Signal chat|Signal event stream disconnected|queue|drop' "$LOG_FILE_PATH" | tail -n "$TAIL_LINES"; then
  echo "No matching Signal diagnostic lines found in log."
fi

section "registered_groups rows (Signal)"
REGISTERED_GROUP_COLUMNS='jid, name'
for optional_column in folder enabled is_primary requires_trigger trigger_pattern is_main; do
  if has_column "registered_groups" "$optional_column"; then
    REGISTERED_GROUP_COLUMNS="$REGISTERED_GROUP_COLUMNS, $optional_column"
  fi
done

sqlite3 -readonly "$DB_FILE_PATH" <<SQL
.headers on
.mode column
SELECT $REGISTERED_GROUP_COLUMNS
FROM registered_groups
WHERE jid LIKE 'sig:%'
ORDER BY jid;
SQL

section "Recent Signal messages"
sqlite3 -readonly "$DB_FILE_PATH" <<'SQL'
.headers on
.mode column
SELECT timestamp,
       chat_jid,
       sender_name,
       substr(replace(replace(content, char(10), ' '), char(13), ' '), 1, 120) AS content_preview
FROM messages
WHERE chat_jid LIKE 'sig:%'
ORDER BY timestamp DESC
LIMIT 20;
SQL
