#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set}"
: "${BACKUP_KMS_PROVIDER:?BACKUP_KMS_PROVIDER must be set}"
: "${AWS_KMS_KEY_ID:?AWS_KMS_KEY_ID must be set}"

prefix="${BACKUP_S3_PREFIX:-sqlite-backups/}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

key="$(aws s3api list-objects-v2 \
  --bucket "$BACKUP_S3_BUCKET" \
  --prefix "$prefix" \
  --query "sort_by(Contents[?ends_with(Key, '.tar.gz.enc')], &LastModified)[-1].Key" \
  --output text)"

if [ -z "$key" ] || [ "$key" = "None" ]; then
  echo "No encrypted SQLite backup found under s3://$BACKUP_S3_BUCKET/$prefix" >&2
  exit 1
fi

aws s3 cp "s3://$BACKUP_S3_BUCKET/$key" "$workdir/backup.tar.gz.enc"
node src/services/backupService.js restore \
  --source "$workdir/backup.tar.gz.enc" \
  --destination "$workdir/restored"

snapshot="$(find "$workdir/restored" -type f -name '*.sqlite' -print -quit)"
if [ -z "$snapshot" ]; then
  echo "Restored archive did not contain a SQLite snapshot" >&2
  exit 1
fi

node scripts/backup/verifySqliteIntegrity.js "$snapshot"
