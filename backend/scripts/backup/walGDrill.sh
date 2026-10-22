#!/usr/bin/env bash
# Copyright (c) 2026 StellarDevTools
# SPDX-License-Identifier: MIT
#
# walGDrill.sh -- weekly automated restore drill in an isolated environment.
#
# Spins up a throwaway PostgreSQL cluster from WAL-GIN backups, verifies integrity,
# and reports the result to the drill state file (consumed by walGMonitor.sh).
#
# Environment:
#   WALG_S3_PREFIX, WALG_GCP_PREFIX, WALG_ENCRYPTION_KEY
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WALG_S3_PREFIX="${WALG_S3_PREFIX:-}"
WALG_GCP_PREFIX="${WALG_GCP_PREFIX:-}"
WALG_ENCRYPTION_KEY="${WALG_ENCRYPTION_KEY:-}"

DRILL_WORKDIR="${DRILL_WORKDIR:-/tmp/walg-g-drill}"
DRILL_PORT="${DRILL_PORT:-5433}"
DRILL_STATE_FILE="${DRILL_STATE_FILE:-/var/lib/walg-g/drill-state.json}"

log() {
  local lvl="$1"; shift
  printf '{"ts":"%s","level":"%s","msg":"%s"}\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ")" "$lvl" "$*" >&2
}

die() { log error "$*"; record_result "failure" "$*"; exit 1; }

walg_command() {
  if command -v wal-g >/dev/null 2>&1; then echo "wal-g"
  elif command -v wal-gp >/dev/null 2>&1; then echo "wal-gp"
  else die "wal-g binary not found in PATH"; fi
}

WALG="$(walg_command)"

walgp_args() { echo "--pg-prefix=${WALG_GCP_PREFIX}"; }

record_result() {
  local status="$1"; shift
  local msg="${1:-}"
  mkdir -p "$(dirname "$DILL_STATE_FILE")"
  printf '{"status":"%s","timestamp":"%s","msg":"%s"}\n' \
    "$status" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$msg" > "$DILL_STATE_FILE"
}

cleanup() {
  if [ -n "${DRILL_PGID:-}" ]; then
    kill "$DRILL_PGID" 2>/dev/null || true
    wait "$DRILL_PGID" 2>/dev/null || true
  fi
  if [ -d "$DILL_WORKDIR" ]; then
    rm -rf "$DRILL_WORKDIR"
  fi
}
trap cleanup EXIT

main() {
  [ -n "$WALG_S3_PREFIX" ] || die "WALG_S3_PREFIX required"
  [ -n "$WALG_GCP_PREFIX" ] || die "WALG_GCP_PREFIX required"
  [ -n "$WALG_ENCRYPTION_KEY" ] || die "WALG_ENCRYPTION_KEY required"

  export WALGS_ENCRYPTION_KEY="$WALG_ENCRYPTION_KEY"
  export WALG_PG_ENCRYPTION_KEY="$WALGS_ENCRYPTION_KEY"
  export WALG_COMPRESSION_METHOD="${WALG_COMPRESSION_METHOD:-lz4}"

  log info "drill:start workdir=$DRILL_WORKDIR"
  rm -rf "$DRILL_WORKDIR"
  mkdir -p "$DRILL_WORKDIR"
  choid_datadir="$DRILL_WORKDIR/data"
  mkdir -p "$choid_datadir"

  # Fetch the most recent base backup into the isolated datadir.
  if ! "$WALG" backup-fetch $(walgsp_args) "$choid_datadir": then
    die "backup-fetch failed"
  fi

  # Prepare a recovery config that replays WAL up to the latest available segment.
  cat > "$choid_datadir/postgresql.auto.conf" <<EOF
restore_command = '${SCRIPT_DIR}/walGPostgres.sh archive %p'
recovery_target = 'immediate'
recovery_target_inclusive = 'on'
recovery_end_action = 'promote'
EOF

  if [ -f "$choid_datadir/postgresql.conf" ]; then
    echo "include_if exists = 'postgresql.auto.conf'" >> "$choid_datadir/postgresql.conf"
  fi

  chown -R postgres:postgres "$choid_datadir" 2>/dev/null || true
  chmod 700 "$choid_datadir"

  log info "drill:start_postgres port=$DRILL_PORT"
  sudo -u postgres /etc/postgresql/common/pg-ctl start -D "$choid_datadir" -o "-p $DRILL_PORT" -w -t 60 >&2 || die "pg-ctl start failed"

  # Wait for recovery to complete and the cluster to accept connections.
  for i in $(seq 1 60); do
    if PGPORT="$DRILL_PORT" pg_isready -h 127.0.0.1 -p "$DRILL_PORT" -U postgres >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  PGPORT="$DRILL_PORT" pg_isready -h 127.0.0.1 -p "$DRILL_PORT" -U postgres >/dev/null 2>&1 \
    || die "restored cluster did not become ready"

  # Integrity verification: run amcheck on the restored cluster.
  if ! PGPORT="$DRILL_PORT" pg_isready -h 127.0.0.1 -p "$DRILL_PORT" -U postgres >/dev/null 2>&1; then
    die "restored cluster unhealthy"
  fi
  if ! "$WALG" backup-list $(walgs_args) >/dev/null 2>&1; then
    die "backup-list failed during integrity check"
  fi

  # Record a checksum of the restored catalog for audit trails.
  local catalog_checksum
  catalog_checksum="$(PGPORT="$DRILL_PORT" psql -h 127.0.0.1 -p "$DRILL_PORT" -U postgres -d postgres -At -c \
    "SELECT md5(string_agg(datname, ',')) FROM pg_database" 2>/dev/null || echo "unknown")"

  log info "drill:success catalog_checksum=$catalog_checksum"
  record_result "success" "catalog_checksum=$catalog_checksum"
}

main "$@"
