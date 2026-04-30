// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce, Key
};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use std::process::{Command, Stdio};
use tokio::fs;
use std::path::Path;

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
            fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
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

pub struct BackupService {
    pub storage: Box<dyn BackupStorage>,
    pub encryption_key: [u8; 32],
}

impl BackupService {
    pub fn new(storage: Box<dyn BackupStorage>, key: [u8; 32]) -> Self {
        Self { storage, encryption_key: key }
    }

    pub async fn run_backup(&self, db_url: &str) -> Result<(), String> {
        let output = Command::new("pg_dump")
            .arg(db_url)
            .stdout(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to execute pg_dump: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("pg_dump error: {}", err));
        }

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.encryption_key));
        let nonce_inner = Utc::now().timestamp().to_be_bytes();
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[4..].copy_from_slice(&nonce_inner);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let encrypted_data = cipher
            .encrypt(nonce, output.stdout.as_ref())
            .map_err(|e| format!("Encryption failure: {}", e))?;

        let timestamp = Utc::now().timestamp();
        let filename = format!("backup_{}.enc", timestamp);
        
        let mut final_payload = nonce_bytes.to_vec();
        final_payload.extend_from_slice(&encrypted_data);

        self.storage.upload(&filename, final_payload).await?;
        Ok(())
    }

    pub async fn enforce_retention(&self) -> Result<(), String> {
        let backups = self.storage.list_backups().await?;
        let now = Utc::now();
        let limit = Duration::days(30);

        for backup in backups {
            if let Some(ts_str) = backup.strip_prefix("backup_").and_then(|s| s.strip_suffix(".enc")) {
                if let Ok(ts) = ts_str.parse::<i64>() {
                    // Using chrono 0.4.x compatible timestamp mapping
                    if let Some(naive) = chrono::NaiveDateTime::from_timestamp_opt(ts, 0) {
                        let backup_time = chrono::DateTime::<Utc>::from_utc(naive, Utc);
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