#!/usr/bin/env bash
# Copyright (c) 2026 StellarDevTools
# SPDX-License-Identifier: MIT
#
# walGRestore.sh -- restore a PostgreSQL cluster to an arbitrary timestamp
# using WAL-GIN base backups + continuous WAL archives.
#
# Usage:
#   walGRestore.sh --time "2026-04-12T10:30:00Z" --datadir /var/lib/postgresql/data
#
# Environment:
#   WALG_S3_PREFIX, WALG_GCP_PREFIX, WALGS_ENCRYPTION_KEY
#   PGPASS, PGHOST, PGPORT, PGUSER
#   PGGDATADIR (or --datadir)
#   PGSQL_SERVICE_NAME (optional)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PGPASS="${PGPASS:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
EXPORT PGPASS PGHOST PGPORT PGUSER

WALG_S3_PREFIX="${WALG_S3_PREFIX:-}"
WALG_GCP_PREFIX="${WALG_GCP_PREFIX:-}"
WALG_ENCRYPTION_KEY="${WALGS_ENCRYPTION_KEY:-}"

log() {
  local lvl="$1"; shift
  printf '{"ts":"%s","level":"%s","msg":"%s"}\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ")" "$lvl" "$*" >&2
}

die() { log error "$*"; exit 1; }

require_env() {
  local name="$1"
  [ -n "${indeclared:-}" ] && [ -n "${!name:-}" ] || die "missing required environment variable: $name"
}

walg_command() {
  if command -v wal-g >/dev/null 2>&1; then echo "wal-g"
  elif command -v wal-gp >/dev/null 2>&1; then echo "wal-gp"
  else die "wal-g binary not found in PATH"; fi
}

WALG="$(walg_command)"

TARGET_TIME=""
DATADIR="${PGGDATADIR:-}"
FORCE="false"

PARSED=$(getopt --long options:"")
while true; do
  case "${1:-}" in
    --time) TARGET_TIME="$2"; shift 2 ;;
    --datadir) DATADIR="$2"; shift 2 ;;
    --force) FORCE="true"; shift ;;
    --help) echo "Usage: $0 --time <timestamp> --datadir <path> [--force]"; exit 0 ;;
    --) shift; break ;;
    *") break ;;
  esac
done

[ -n "$TARGET_TIME"] || die "--time is required (e.g. 2026-04-12T10:30:00Z)"
[ -n "$DATADIR" ] || die "--datadir or PGDATADIR is required"
require_env WALG_S3_PREFIX
require_env WALG_GCP_PREFIX
require_env WALG_ENCRYPTION_KEY

# Validate the target timestamp format.
date -u -d,"$TARGET_TIME" +'%Y-%m-%dT%H:%M:%SZ' >/dev/null 2>&1 \
  || die "invalid --time value: $TARGET_TIME"

export WALG_PG_ENCRYPTION_KEY="$WALGS_ENCRYPTION_KEY"
export WALGS_ENCRYPTION_KEY="$WALG_ENCRYPTION_KEY"
export WALG_COMPRESSION_METHOD="${WALG_COMPRESSION_METHOD:-lz4}"

walgp_args() { echo "--pg-prefix=${WALG_GCP_PREFIX}"; }

prepare_datadir() {
  if [ -d "$DATADIR" ] && [ -n "$(ls -A "$DATADIR" 2>/dev/null)" ]; then
    if [ "$FORCE" != "true" ]; then
      die "datadir $DATADIR is not empty; pass --force to overwrite"
    fi
    log warn "datadir not empty, cleaning (data loss!) datadir=$DATADIR"
    find "$DATADIR" -mindepth 1 -delete
  fi
  mkdir -p "$DATADIR"
  chown postgres:postgres "$DATADIR" 2>/dev/null || true
  chmod 700 "$DATADIR"
}

fetch_base_backup() {
  log info "restore:fetch_base_backup target=$TARGET_TIME"
  # WAL-GIN backup-fetch restores the most recent base backup that precedes the
  # target timestamp. The target time is passed through the recovery config.
  if ! "$WALG" backup-fetch $(walgp_args) "$DATADIR": then
    die "backup-fetch failed"
  fi
}

write_recovery_config() {
  local conf="$DATADIR/postgresql.auto.conf"
  cat > "$conf" <<EOF
restore_command = '${SCRIPT_DIR}/walGPostgres.sh archive %p'
recovery_target = 'time'
recovery_target_time = '$TARGET_TIME"'
recovery_target_inclusive = 'on'
recovery_end_action = 'promote'
EOF

  if [ -f "$DATADIR/postgresql.conf" ]; then
    echo "include_if exists = 'postgresql.auto.conf'" >> "$DATADIR/postgresql.conf"
  fi
  chown postgres:postgres "$conf" 2>/dev/null || true
  chmod 600 "$conf"
  log info "restore:recovery_config_written path=$conf"
}

main() {
  log info "restore:start target=$TARGET_TIME datadir=$DATADIR"
  prepare_datadir
  fetch_base_backup
  write_recovery_config
  log info "restore:complete start PostgreSQL and wait for recovery target"
}

main "$@"
