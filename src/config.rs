// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    Sqlite,
    Postgres,
    Dual,
}

#[derive(Debug, Deserialize)]
pub struct Config {
    pub db_type: DbType,
    pub sqlite_url: String,
    pub postgres_url: String,
}