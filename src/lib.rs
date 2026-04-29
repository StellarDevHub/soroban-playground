// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Core modules directly in src/
pub mod r#trait;
pub mod sqlite;
pub mod postgres;
pub mod multi;
pub mod config;
pub mod backup_logic;

/// Compatibility alias for code referencing the old 'db' namespace
pub mod db {
    pub use crate::r#trait;
    pub use crate::sqlite;
    pub use crate::postgres;
    pub use crate::multi;
    pub use crate::config;
    pub use crate::backup_logic;

}