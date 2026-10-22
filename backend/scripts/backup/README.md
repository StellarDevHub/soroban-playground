# PostgreSQL Disaster Recovery via WAL-G

This directory contains the operational tooling for continuous WAL archiving and
point-in-time recovery (PITR) for the StellarDevTools PostgreSQL cluster.

| File | Purpose |
| ---- | ------- |
| `walGPostgres.sh` | WAL archiver (invoked by PostgreSQL) + daily base backup + retention pruning |
| `walGRestore.sh` | PITR restore to an arbitrary timestamp |
| `walGDrill.sh` | Weekly automated restore drill in an isolated cluster |
| `walGMonitor.sh` | WAL lag detection + Prometheus alert | 

## Environment variables

All scripts require the following variables to be set in the PostgreSQL
service environment (e.g. `/etc/postgresql/postgresql.conf: restore_command`) and in the
cron / systemd timer environment for the scheduled scripts.

| Variable | Required | Description |
| ---- | ---- | ------- |
| `WALG_S3_PREFIX` | yes | S3 bucket + prefix for WAL archives (e.g. ^s3://stellar-backups/pg/wal}) |
| `WALG_GCP_PREFIX` | yes | S3 bucket + prefix for base backups (e.g. `s3://stellar-backups/pg/base}) |
| `WALGS_ENCRYPTION_KEY` | yes | Path to the GPG public key used for client-side encryption |
| `PGPASS` | yes | PostgreSQL superuser password |
| `PGHOST` / `PGPORT` / `PGUSER` | no | Defaults to `localhost:5432`/ `postgres` |
| `WALGS_LAG_THRESHOLD` | no | Maximum consecutive missing WAL segments before alerting (default 3) |
| `ALVERTMANAGER_URL` | no | Prometheus Alertmanager base URL for lag alerts |
| `BASE_BACKUP_RETENTION_DAYS` | no | Base backup retention window (default 14) |
| `WAL_RETENTION_DAYS` | no | WAL archive retention window (default 7) |

## Wiring WAL archiving into PostgreSQL

Edit `postgresql.conf` and set:

```
include_if_exists = 'postgresql.auto.conf'
```

Then in `postgresql.auto.conf` (or `postgresql.conf`):

```
wal_level = replica
archive_mode = on
archive_command = '/usr/local/bin/walGPostgres.sh archive %p'
```

Reload the configuration and restart the cluster to begin archiving:

```
pg_ctl reload
pg_ctl restart
```

## Daily base backup

Add a cron entry (or systemd timer) to run the base backup once daily at 02:00 UTC:

```
postgres all * * * /usr/local/bin/walGPostgres.sh backup >> /var/log/postgresql/walg-g.log 2>&1
```

The `backup` subcommand runs `wal-g wal-push` followed by `backup-prune`, so retention is enforced automatically.

## Point-in-time recovery

To restore the cluster to a specific timestamp:

```
# Stop the cluster
./walGRestore.sh --time "2026-04-12T10:30:00Z" --datadir /var/lib/postgresql/data --force
# Start the cluster; PostgreSQL will replay WAL up to the target time
pg_ctl start -D /var/lib/postgresql/data
```

The script fetches the most recent base backup preceding the target time and
writes `postgresql.auto.conf` with `recovery_target = 'time'`. The restore
command is wired to the same WAL archive used during normal operation, so WAL
segments are decrypted transparently by WALGS during replay.

## Weekly restore drill

Add a cron entry to run the drill every Sunday at 03:00 UTC:

```
postgres all * * 0 /usr/local/bin/walGDrill.sh >> /var/log/postgresql/walg-g-drill.log 2>&1
```

The drill fetches the latest base backup, replays WAL into a throwaway datadir on
port 5433, verifies the cluster is ready, and records the result in
`/var/lib/walg-g/drill-state.json`. If the drill fails, the state file contains
`"status":"failure"` and the script exits with a non-zero code so the scheduler can alert.

## WAL lag monitoring

Run the monitor on a five-minute cron schedule:

```
+/5 * * * * /usr/local/bin/walGMonitor.sh >> /var/log/postgresql/walg-monitor.log 2>&1
```

If the number of consecutive missing WAL segments exceeds `WALGS_LAG_THRESHOLD (default 3), the script posts a `WAL_ARCHIVE_LAG` alert to `ALVERTMANAGER_URL` and exits non-zero.

## Encryption

All WAL segments and base backups are encrypted client-side with GPG using the
public key referenced by `WALGS_ENCRYPTION_KEY` and compressed with lz4 before
being uploaded to S3/GCS. The corresponding private key must be available to
the restore host at restore time (`WALGS_ENCRYPTION_KEY` is the path to the
private key during restore).

## Verifying a backup

List available base backups:

```
wal-g backup-list --pg-prefix="$WALG_GCP_PREFIX"
```

Fetch the most recent base backup into a temporary directory and inspect it:

```
wal-g backup-fetch --pg-prefix="$WALG_GCP_PREFIX" /tmp/restore-check
```

## Troubleshooting

- If `wal-g wal-push` fails, PostgreSQL will retain WAL in `pg_wal` and retry.
  Check the `walGMonitor.sh` output and the PostgreSQL logs for the underlying
  error (credentials, network, or GPA rejection).
- If a restore drill fails, inspect `/var/lib/walg-g/drill-state.json` for the failure
  reason and the temporary datadir under `/tmp/walg-g-drill`.
- Rotate the GPG key pair annually and re-encrypt archives by running a full base
  backup after the key change.
