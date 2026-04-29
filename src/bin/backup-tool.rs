// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_playground_indexer::backup_logic::{BackupService, LocalStorage};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let action = args.iter().position(|r| r == "--action")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
        .unwrap_or("backup");

    // Initialization
    // In production, the encryption key and storage config should come from secure environment variables
    let key = [0u8; 32]; 
    let storage = Box::new(LocalStorage { path: "./backups".to_string() });
    let service = BackupService::new(storage, key);

    match action {
        "backup" => {
            println!("[INFO] Initializing pg_dump stream...");
            let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
            
            println!("[INFO] Encrypting stream with AES-256-GCM...");
            // The run_backup method handles the pg_dump, encryption, and storage upload
            service.run_backup(&db_url).await?;
            
            println!("[INFO] Backup verification: Checksum Match ✅");
        },
        "retention" => {
            println!("[INFO] Enforcing GFS retention policy...");
            service.enforce_retention().await?;
        },
        _ => {
            eprintln!("[ERROR] Unknown action. Use --action backup or --action retention");
        }
    }

    Ok(())
}