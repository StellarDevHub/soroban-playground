// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::fs;

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[async_trait]
pub trait BackupStorage: Send + Sync {
    async fn upload(&self, name: &str, data: Vec<u8>) -> Result<(), String>;
    async fn download(&self, name: &str) -> Result<Vec<u8>, String>;
    async fn delete(&self, name: &str) -> Result<(), String>;
    async fn list_backups(&self) -> Result<Vec<String>, String>;
}

pub struct LocalStorage {
    pub path: String,
}

#[async_trait]
impl BackupStorage for LocalStorage {
    async fn upload(&self, name: &str, data: Vec<u8>) -> Result<(), String> {
        let file_path = Path::new(&self.path).join(name);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        fs::write(file_path, data).await.map_err(|e| e.to_string())
    }

    async fn download(&self, name: &str) -> Result<Vec<u8>, String> {
        let file_path = Path::new(&self.path).join(name);
        fs::read(file_path).await.map_err(|e| e.to_string())
    }

    async fn delete(&self, name: &str) -> Result<(), String> {
        let file_path = Path::new(&self.path).join(name);
        fs::remove_file(file_path).await.map_err(|e| e.to_string())
    }

    async fn list_backups(&self) -> Result<Vec<String>, String> {
        let mut backups = Vec::new();
        let mut entries = fs::read_dir(&self.path).await.map_err(|e| e.to_string())?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("backup_") {
                    backups.push(name.to_string());
                }
            }
        }
        Ok(backups)
    }
}

pub struct S3Storage; // Placeholder for future AWS SDK integration

fn derive_nonce(plaintext: &[u8]) -> [u8; 12] {
    let mut hasher = Sha256::new();
    hasher.update(Utc::now().timestamp_nanos_opt().unwrap_or_default().to_be_bytes());
    hasher.update(std::process::id().to_be_bytes());
    hasher.update(NONCE_COUNTER.fetch_add(1, Ordering::Relaxed).to_be_bytes());
    hasher.update((plaintext.len() as u64).to_be_bytes());
    let digest = hasher.finalize();
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&digest[..12]);
    nonce
}

/// Resolve a 32-byte backup encryption key from managed secret stores.
///
/// Supported sources (in priority order):
/// - `BACKUP_KMS_ENCRYPTED_KEY_B64` (+ optional `BACKUP_KMS_KEY_ID`) decrypted via `aws kms decrypt`
/// - `BACKUP_VAULT_ADDR` + `BACKUP_VAULT_SECRET_PATH` (+ optional token/namespace/field) via `vault kv get`
///
/// Plaintext keys in source-controlled configs are not read by this helper.
pub fn resolve_encryption_key_from_managed_store() -> Result<[u8; 32], String> {
    if let Ok(cipher_b64) = std::env::var("BACKUP_KMS_ENCRYPTED_KEY_B64") {
        return decrypt_key_via_kms_cli(cipher_b64.trim());
    }
    if std::env::var("BACKUP_VAULT_ADDR").is_ok()
        && std::env::var("BACKUP_VAULT_SECRET_PATH").is_ok()
    {
        return read_key_from_vault_cli();
    }
    Err("No managed backup key configured (AWS KMS or HashiCorp Vault)".to_string())
}

fn decode_key_material(raw: &str, source: &str) -> Result<[u8; 32], String> {
    let trimmed = raw.trim().trim_matches('"');
    let bytes = if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        hex::decode(trimmed).map_err(|e| format!("Invalid hex key from {source}: {e}"))?
    } else {
        decode_base64_std(trimmed)
            .map_err(|e| format!("Invalid base64 key from {source}: {e}"))?
    };
    bytes
        .try_into()
        .map_err(|_| format!("Encryption key from {source} must be 32 bytes"))
}

fn decode_base64_std(input: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b" \n\r\t".contains(b))
        .collect();
    if clean.is_empty() {
        return Err("empty input".to_string());
    }
    if clean.len() % 4 != 0 {
        return Err("invalid length".to_string());
    }

    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let mut buf = 0u32;
        let mut pad = 0usize;
        for (i, &b) in chunk.iter().enumerate() {
            let v = if b == b'=' {
                pad += 1;
                0
            } else {
                val(b).ok_or_else(|| "invalid character".to_string())?
            };
            buf |= v << (6 * (3 - i));
        }
        if pad > 2 || (pad > 0 && chunk[2] != b'=' && chunk[3] == b'=') {
            return Err("invalid padding".to_string());
        }
        out.push(((buf >> 16) & 0xFF) as u8);
        if pad < 2 {
            out.push(((buf >> 8) & 0xFF) as u8);
        }
        if pad == 0 {
            out.push((buf & 0xFF) as u8);
        }
    }
    Ok(out)
}

fn decrypt_key_via_kms_cli(cipher_b64: &str) -> Result<[u8; 32], String> {
    let mut cmd = Command::new("aws");
    cmd.args(["kms", "decrypt", "--query", "Plaintext", "--output", "text", "--ciphertext-blob"])
        .arg(cipher_b64);
    if let Ok(region) = std::env::var("BACKUP_KMS_REGION")
        .or_else(|_| std::env::var("AWS_REGION"))
    {
        cmd.args(["--region", &region]);
    }
    if let Ok(key_id) = std::env::var("BACKUP_KMS_KEY_ID") {
        cmd.args(["--key-id", &key_id]);
    }
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to invoke aws kms decrypt: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "aws kms decrypt failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let plaintext_b64 = String::from_utf8_lossy(&output.stdout);
    decode_key_material(plaintext_b64.as_ref(), "AWS KMS")
}

fn read_key_from_vault_cli() -> Result<[u8; 32], String> {
    let path = std::env::var("BACKUP_VAULT_SECRET_PATH")
        .map_err(|_| "BACKUP_VAULT_SECRET_PATH is required".to_string())?;
    let field = std::env::var("BACKUP_VAULT_SECRET_FIELD").unwrap_or_else(|_| "key".to_string());
    let mut cmd = Command::new("vault");
    cmd.args(["kv", "get", &format!("-field={field}"), &path]);
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to invoke vault kv get: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "vault kv get failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    decode_key_material(&String::from_utf8_lossy(&output.stdout), "HashiCorp Vault")
}

pub struct BackupService {
    pub storage: Box<dyn BackupStorage>,
    pub encryption_key: [u8; 32],
}

impl BackupService {
    pub fn new(storage: Box<dyn BackupStorage>, key: [u8; 32]) -> Self {
        Self {
            storage,
            encryption_key: key,
        }
    }

    pub async fn run_backup(&self, db_url: &str) -> Result<(), String> {
        let output = Command::new("pg_dump")
            .arg("--no-password")
            .arg(db_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to execute pg_dump: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("pg_dump error: {}", err));
        }

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.encryption_key));
        let nonce_bytes = derive_nonce(&output.stdout);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let encrypted_data = cipher
            .encrypt(nonce, output.stdout.as_ref())
            .map_err(|e| format!("Encryption failure: {}", e))?;

        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
        let filename = format!("backup_{}.enc", timestamp);

        let mut final_payload = nonce_bytes.to_vec();
        final_payload.extend_from_slice(&encrypted_data);

        self.storage.upload(&filename, final_payload).await?;
        Ok(())
    }

    pub async fn run_backup_and_prune(&self, db_url: &str) -> Result<(), String> {
        self.run_backup(db_url).await?;
        self.enforce_retention().await
    }

    pub async fn enforce_retention(&self) -> Result<(), String> {
        let backups = self.storage.list_backups().await?;
        let now = Utc::now();
        let limit = Duration::days(30);

        for backup in backups {
            if let Some(ts_str) = backup
                .strip_prefix("backup_")
                .and_then(|s| s.strip_suffix(".enc"))
            {
                if let Ok(ts) = ts_str.parse::<i64>() {
                    // Using chrono 0.4.x compatible timestamp mapping
                    if let Some(naive) =
                        chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.naive_utc())
                    {
                        let backup_time =
                            chrono::DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc);
                        if now.signed_duration_since(backup_time) > limit {
                            println!("[INFO] Deleting old backup: {}", backup);
                            self.storage.delete(&backup).await?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
