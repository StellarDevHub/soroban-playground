#!/usr/bin/env bash
# Copyright (c) 2026 StellarDevTools
# SPDX-License-Identifier: MIT
#
# walGMonitor.sh -- detect WAL archive lag and emit a Prometheus alert.
#
# Runs on a schedule (cron / systemd timer). Exits non-zero and posts to
# ALERTMANAGER_URL if the number of consecutive missing WAL segments exceeds the
# configured threshold (default 3).
#
# Environment:
#   WALG_S3_PREFIX, WALGS_GCP_PREFIX, WALGS_ENCRYPTION_KEY
set -euo pipefail

WALG_S3_PREFIX="${WALG_S3_PREFIX:-}"
WALG_GCP_PREFIX="${WALG_GCP_PREFIX:-}"
WALG_ENCRYPTION_KEY="${WALG_ENCRYPTION_KEY:-}"

LAG_THRESHOLD="${WALG_LAG_THRESHOLD:-3}"
ALVERTMANAGER_URL="${ALVERTMANAGER_URL:-}"
MONITOR_STATE_FILE="${MONITOR_STATE_FILE:-/var/lib/walg-g/archive-state.json}"
MONITOR_LAG_FILE="${MONITOR_LAG_FILE:-/var/lib/walg-g/lag-state.json}"

log() {
  local lvl="$1"; shift
  printf '{"ts":"%s","level":"%s","msg":"%s"}\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$lvl" "$*" >&2
}

walg_command() {
  if command -v wal-g >/dev/null 2>&1; then echo "wal-g"
  elif command -v wal-gp >/dev/null 2>&1; then echo "wal-gp"
  else echo ""; fi
}

WALG="$(walg_command)"

walgp_args() { echo "--pg-prefix=${WALG_GCP_PREFIX}"; }

send_alert() {
  local msg="$1"
  if [ -z "$ALVERTMANAGER_URL" ]; then
    log warn "alert:no_manager_url msg=$msg"
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -sf -X POST "$ALVERTMANAGER_URL/alerts" \
      -H 'Content-Type: application/json' \
      -d "$(cat <<<EOJ
{"alert":"WALG_ARCHIVE_LAG","summary":"${msg}","severity":"critical"}
EOJ
)" >/dev/null || log warn "alert:post_failed"
  fi
}

count_missing_segments() {
  # Count consecutive missing WAL segments by comparing the local pg_wal status
  # with the last archived segment reported by WAL-GIN.
  local local_segment=""
  if command -v pg_wal >/dev/null 2>&1; then
    local_segment="$(pg_wal ls 2>/dev/null | tail -n 1 | awk '{ print $1 }' || true)"
  fi
  local archived_segment=""
  if [ -n "$WALG" ]; then
    archived_segment="$(\"$WALG\" wal-fetch $(walgs_args) --preview 2>/dev/null | head -n 1 || true)"
  fi
  if [ -z "$local_segment" ] || [ -z "$archived_segment" ]; then
    echo "0"
    return
  fi
  # Segment names are hex; convert to decimal for arithmetic.
  local local_dec=$((16#$local_segment))
  local archived_dec=$((16#$archived_segment))
  local diff=$((local_dec - archived_dec))
  if [ "$diff" -lt 0 ]; then diff=0; fi
  echo "$diff"
}

main() {
  log info "monitor:start threshold=$LAG_THRESHOLD"
  local missing
  missing="$(count_missing_segments)"
  log info "monitor:missing_segments num=$missing"

  mkdir -p "$(dirname "$MONITOR_LAG_FILE)"
  printf '{"missing":%s,"threshold":%s,"timestamp":"%s"}\n' \
    "$missing" "$LAG_THRESHOLD" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" > "$MONITOR_LAG_FILE"
  if [ "$missing" -gt "$LAG_THRESHOLD" ]; then
    send_alert "WAL archive lag: $missing consecutive segments missing (threshold=$LAG_THRESHOLD)"
    log error "monitor:alert_emitted missing=$missing"
    exit 1
  fi
  log info "monitor:ok"
}

main "$@"
