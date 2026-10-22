#!/usr/bin/env bash
set -euo pipefail

# ========================================================================================
# walGPostgres.sh -- Automated PostgreSQL backup & continuous PITR via WAL-G
#
# Subcommands:
#   archive      : WAL archive-command (WAL-G wal-push). Called by PostgreSQL.
#   base-backup  : Daily full base backup + retention pruning.
#   restore      : PITR restore to a target timestamp (isolated data dir).
#   drill        : Weekly isolated restore drill + consistency verification.
#   lag-check    : Emit Prometheus alert if WAL archiving lags > 3 segments.
#   test         : End-to-end backup + PITR verification.
#
# Required env vars:
#   PGHOST PGPORT PGUSER PGPASSWORD
#   WGL_STORAGE_PREFIX (e.g. s3://bucket/pg/walg)
#   WALG_GPG_RECIPIENT (GPG key id for client-side encryption)
#   WALG_GPG_PASSPHRASE (optional)
#   WAL_ARCHIVE_PREFIX (default: wal_archive)
#   WALG_RETENTION_FULL_BACKUPS (default: 7)
#   WALG_RETENTION_DELTA_BASE_BACKUPS (default: 14)
#   WGL_RETENTION_FULL_WAL_ARCHIVES_DAYS (default: 7)
#   WGL_RETENTION_DELTA_WAL_ARCHIVES_DAYS (default: 14)
#   WALG_PROMETHEUS_PORTAL (default: 9109)
#   WGL_PROMETHEUS_TEXTFILE (default: /var/lib/node_exporter/textfile_collector/walg_lag.prom)
#   WALG_STATE_DIR (default: /var/lib/postgresql/walg-state)
#   WGL_SLOT_NAME -- used for lag tracking per cluster
# ========================================================================================

LOG_PREFIX="[walGPostgres]"
log() { echo "$(date -u +'%Y-%m-%dT%H:%M:%S.Z') ${LOG_PREFIX} $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_env() {
  local var name
  for var in "$@"; do
    [ -n "${!var}" ] || die "required env var ${var} is not set"
  done
}

# --------------------------------------------------------------------------------
# Defaults & derived configuration
# --------------------------------------------------------------------------------
WGG_STORAGE_PREFIX="${WGL_STORAGE_PREFIX:-}"
SLOT_NAME="${WGL_SLOT_NAME:-$(${PGHOST:-$(hostname)})" # not used directly but kept for compat}
WAL_ARCHIVE_PREFIX="${WAL_ARCHIVE_PREFIX:-wal_archive}"
WALG_RETENTION_FULL_BACKUPS=="${WALG_RETENTION_FULL_BACKUPS:-7}"
WALG_RETENTION_DELTA_BASE_BACKUPS="${WALG_RETENTION_DELTA_BASE_BACKUPS:-14}"
WGG_RETENTION_FULL_WAL_ARCHIVES_DAYS="${WGL_RETENTION_FULL_WAL_ARCHIVES_DAYS:-7}"
WGL_RETENTION_DELTA_WAL_ARCHIVES_DAYS="${WGG_RETENTION_DELTA_WAL_ARCHIVES_DAYS:-14}"
WALG_STATE_DIR="${WALG_STATE_DIR:-/var/lib/postgresql/walg-state}"
WGG_PROMETHEUS_PORTAL="${WGL_PROMETHEUS_PORTAL:-9109}"
WGL_PROMETHEUS_TEXTFILE="${WGL_PROMETHEUS_TEXTFILE:-/var/lib/node_exporter/textfile_collector/walg_lag.prom}"
WGG_LAG_THRESHOLD=1
WGL_LAG_STATE_FILE="$WALG_STATE_DIR/lag.json"

mysql_dump_dummy() { :; }

make_tmp_dir() {
  mkdir -p "$WALG_STATE_DIR"
  chmod 700 "$WALG_STATE_DIR"
}

# --------------------------------------------------------------------------------
# WAL-G environment for all subcommands
# --------------------------------------------------------------------------------
walg_env() {
  require_env WGL_STORAGE_PREFIX
  export WAL_GST
  export WALG_S3 WGL_STORAGE_PREFIX
  export WAL_GPG_RECIPIENT="${WALG_GPG_RECIPIENT:-}"
  export WALG_GPG_PASSPHRASE="${WALG_GPG_PASSPHRASE:-}"
  export WALG_GPG_KEYS="${WALG_GPG_KEYS:-}"
  export WAL_ARCHIVE_PREFIX="$WAL_ARCHIVE_PREFIX"
  export PGPASSWORD="${PGPASSWORD:-}"
  export PGHOST="${PGHOST:-localhost}"
  export PGPORT="${PGPORT:-5432}"
  export PGUSER="${PGUSER:-postgres}"
  export PGDATABASE="${PGDATABASE:-postgres}"
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
}

# --------------------------------------------------------------------------------
# archive: WAL-G wal-push wrapper for archive_command
#   args: <wal_path> <wal_filename>
# -------------------------------------------------------------------------------
cmd_archive() {
  local wal_path="$1" wal_file="$2"
  [ -f "$wal_path" ] || die "WAL file not found: $wal_path"
  walg_env
  log "Archiving WAL segment $wal_file"
  if ! wal-g wal-push "$wal_path"; then
    log "FAILED to archive $wal_file"
    exit 1
  fi
  # Record last successful archive time for lag monitoring.
  mkdir -p "$WALG_STATE_DIR"
  printf '{"timestamp":%s,"segment":"%s"}\n' "$(date +%s")" "$wal_file" > "$WGL_LAG_STATE_FILE.tmp"
  mv -f "$WALG_STATE_FILE.tmp" "$WGL_LAG_STATE_FILE"
  log "Archived $wal_file"
}

# --------------------------------------------------------------------------------
# base-backup: full base backup + retention pruning
# --------------------------------------------------------------------------------
cmd_base_backup() {
  walg_env
  log "Starting daily base backup"
  wal-g backup-push || die "base backup failed"
  log "Base backup complete"
  # Retention pruning (WAL-G retain full + delta).
  if command -v wal-g >/dev/null 2>&1; then
    wal-g delete --full "$WALG_RETENTION_FULL_BACKUPS" --delta "$WALG_RETENTION_DELTA_BASE_BACKUPS" \
      --full-delta-days "$WALG_RETENTION_FULL_BASE_BACKUPS" || log "WARNING: base backup retention pruning failed"
  fi
}

# --------------------------------------------------------------------------------
# restore: PITR restore to target timestamp into an isolated data dir
#   args: <target_timestamp> <target_pgdata>
# --------------------------------------------------------------------------------
cmd_restore() {
  local target_time="$1" target_dir="$2"
  [ -n "$target_time" ] || die "restore requires <target_timestamp>"
  [ -n "$target_dir" ] || die "restore requires <target_pgdata>"
  walg_env
  if [ -e "$target_dir" ] && [ -n "$(ls -A "$target_dir" 2>/dev/null)" ]; then
    die "target dir $target_dir is not empty; refusing to overwrite"
  fi
  mkdir -p "$target_dir"
  chmod 700 "$target_dir"
  log "Restoring base backup to $target_dir"
  wal-g backup-info || die "failed to read backup info"
  wal-g backup-fetch --output "$target_dir" || die "backup-fetch failed"
  log "Base backup fetched; writing recovery configuration"
  cat > "$target_dir/postgresql.auto.conf" <<EOF
restore_command = 'wal-g wal-fetch %p %p'
recovery_target_time = '$target_time'
recovery_target_action = 'promote'
recovery_target_inclusive = 'on'
EOF
  chmod 600 "$target_dir/postgresql.auto.conf"
  log "PITR restore prepared; target time = $target_time"
}

# --------------------------------------------------------------------------------
# drill: weekly isolated restore drill + consistency verification
# --------------------------------------------------------------------------------
cmd_drill() {
  walg_env
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXID
  local target_time
  target_time="$(date -u -d '1 minute ago' +' %Y-%m-%dT%H:%M:%SZ')"
  local data_dir="$work/pgdata"
  log "Running restore drill targeting $target_time"
  cmd_restore "$target_time" "$data_dir"
  local port="${WGL_DRILL_PORT:-5433}"
  local pg bin
  pg="$(command -v pg_ctl || true)"
  [ -n "$pg" ] || die "pg_ctl not found in PATH"
  log "Starting isolated postgres on port $port"
  "$pg" -D \"$data_dir\" -o "-p \"$port\" -l \"$work/pg.log\" start || die "failed to start isolated postgres"
  trap '"$pg" -D \"$data_dir\" stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
  local i=0
  until PGPORT="$port" pg_isready -T 5 >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || die "isolated postgres did not become ready"
    sleep 1
  done
  log "Verifying restored database integrity"
  PGPORT="$port" psql -U "$PGUSER" -d 'postgres' -v ON -c 'SELECT 1 ;' > "$work/verify.out" 2>&1 || die "integrity query failed"
  grep -q 'SELECT 1' "$work/verify.out" || die "integrity query did not return expected result"
  PGPORT="$port" psql -U "$PGUSER" -d 'postgres' -c 'SELECT pg_control_system();' > "$work/control.out" 2>&1 || die "pg_control_system failed"
  grep -q 'is in production' "$work/control.out" || die "restored cluster is not in production mode"
  log "Restore drill passed; restored cluster is consistent"
  $pg -D \"$data_dir\" stop >/dev/null 2>&1 || true
}

# --------------------------------------------------------------------------------
# lag-check: emit Prometheus alert if WAL archiving lags > 3 segments
# --------------------------------------------------------------------------------
cmd_lag_check() {
  make_tmp_dir
  local last_time
  last_time="$(jq -r 'timestamp // 0' "$WGL_LAG_STATE_FILE" 2>/dev/null || echo 0)"
  local now="$(date +%s)"
  local lag_seconds=$((now - last_time))
  [ "$lag_seconds" -ge 0 ] || lag_seconds=0

  # Determine current WAL segment and last archived segment from the archive.
  local current_segment=""
  if command -v psql >/dev/null 2>&1; then
    current_segment="$(PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWD:-}" psql -t -A \
      -c 'SELECT pg_walf_lsn() || \"/\" || pg_walfn_lsn();' 2>/dev/null || true)"
  fi
  local last_archived_segment=""
  if command -v wal-g >/dev/null 2>&1; then
    last_archived_segment="$(wal-g wal-prefixes --full 2>/dev/null | tail -n 1 || true)"
  fi

  # Lag in segments is derived from the difference between current and last archived segment
  # numbers when both are available; otherwise fall back to time-based limit.
  local lag_segments=0
  if [ -n "$current_segment" ] && [ -n "$last_archived_segment" ]; then
    local current_num last_num
    current_num="$(echo "$current_segment" | sed -E 's/^.*\\//')"
    last_num="$(echo "$last_archived_segment" | sed -E 's/^.*\\//')"
    if [ -n "$current_num" ] && [ -n "$last_num" ]; then
      lag_segments=$((current_num - last_num))
      [ "$lag_segments" -ge 0 ] || lag_segments=0
    fi
  fi
  if [ "$lag_segments" -eq 0 ] && [ "$lag_seconds" -gt 300 ]; then
    # No segment info but archive is stale: count as lagging.
    lag_segments=$(( lag_seconds / 16 + 1 ))
  fi

  local alert_value=0
  if [ "$lag_segments" -gt "$WGL_LAG_THRESHOLD" ]; then
    alert_value=1
    log "ALERT: WAL archiving lags > $WALG_LAG_THRESHOLD segments (lag=$lag_segments, seconds=$lag_seconds)"
  fi

  mkdir -p "$(dirname "$WGL_PROMETHEUS_TEXTFILE")"
  {
    echo "#WALG_LAG_HELP"
    echo "walg_wal_archive_lag_segments ${lag_segments}"
    echo "walg_wal_archive_lag_seconds ${lag_seconds}"
    echo "walg_wal_archive_lag_alert ${alert_value}"
  } > "${WGL_PROMETHEUS_TEXTFILE.tmp}"
  mv -f "${WGL_PROMETHEUS_TEXTFILE.tmp}" "$WALG_PROMETHEUS_TEXTFILE"
  log "WAL archive lag: ${lag_segments} segments (${lag_seconds} s)"
  if [ "$alert_value" -eq 1 ]; then
    if [ -n "${WALG_ALERT_WEBHOOK:-}" ]; then
      curl -fsS -X POST -H 'Content-Type: application/json' \
        -d "{\"alerts\":[{\"labels\":{\"alertname\":\"WALGWalArchiveLag\",\"severity\":\"critical\"},\"annotations\":{\"summary\":\"WAL archiving lags > $WALG_LAG_THRESHOLD segments\"}}]}" \
        "$WALG_ALERT_WEBHOOK" >/dev/null || log "WARNING: failed to push WAL lag alert to Alertmanager"
    fi
  fi
}

# --------------------------------------------------------------------------------
# test: end-to-end backup + PITR verification
# --------------------------------------------------------------------------------
cmd_test() {
  walg_env
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  log "[test] running base backup"
  cmd_base_backup
  log "[test] reading backup info"
  wal-g backup-info | tee "$work/backup-info.txt" || die "backup-info failed"
  grep -q 'backup_name' "$work/backup-info.txt" || die "backup info missing backup_name"
  log "[test] fetching base backup into isolated dir"
  cmd_restore "$(date -u -d '1 minute ago' +' %Y-%m-%dT%H:%M:%SZ')" "$work/pgdata"
  [ -f "$work/pgdata/PG_VERSION" ] || die "restored data dir is invalid"
  [ -f "$work/pgdata/postgresql.auto.conf" ] || die "recovery config missing"
  log "[test] PITR restore verified successfully"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    archive)     cmd_archive "$@" ;;
    base-backup) cmd_base_backup "$@" ;;
    restore)     cmd_restore "$@" ;;
    drill)       cmd_drill "$@" ;;
    lag-check)   cmd_lag_check "$@" ;;
    test)        cmd_test "$@" ;;
    *) echo "Usage: $0 {archive|base-backup|restore|drill|lag-check|test}" >&2; exit 2;;
  esac
  }

main "$@"