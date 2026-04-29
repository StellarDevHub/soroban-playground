// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InvoiceStatus {
    Pending,
    Funded,
    Repaid,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Invoice {
    pub id: u32,
    pub business: Address,
    pub amount: i128,
    pub discount_rate: u32, 
    pub risk_score: u32,
    pub status: InvoiceStatus,
}

#[contract]
pub struct InvoiceFactoring;

#[contractimpl]
impl InvoiceFactoring {
    pub fn toggle_pause(env: Env, admin: Address) {
        admin.require_auth();
        let key = symbol_short!("paused");
        if env.storage().instance().has(&key) {
            env.storage().instance().remove(&key);
        } else {
            env.storage().instance().set(&key, &true);
        }
    }

    fn check_not_paused(env: &Env) {
        if env.storage().instance().has(&symbol_short!("paused")) {
            panic!("Contract is paused");
        }
    }

    pub fn submit_invoice(env: Env, business: Address, amount: i128, risk_score: u32) -> u32 {`n        business.require_auth();  
        business.require_auth(); 
        Self::check_not_paused(&env);

        let id = env.storage().instance().get(&symbol_short!("count")).unwrap_or(0u32) + 1;     

        let safe_risk = if risk_score > 10 { 10 } else { risk_score }; 
        let discount_rate = 200 + (safe_risk * 10);

        let invoice = Invoice {
            id,
            business: business.clone(),
            amount,
            discount_rate,
            risk_score,
            status: InvoiceStatus::Pending,
        };

        env.storage().instance().set(&id, &invoice);
        env.storage().instance().set(&symbol_short!("count"), &id);

        env.events().publish((symbol_short!("inv_sub"), business), id);
        id
    }

    pub fn fund_invoice(env: Env, investor: Address, invoice_id: u32) -> bool {
        investor.require_auth(); 
        Self::check_not_paused(&env);
        
        let mut invoice: Invoice = env.storage().instance().get(&invoice_id).unwrap();

        if invoice.status == InvoiceStatus::Pending {
            invoice.status = InvoiceStatus::Funded;
            env.storage().instance().set(&invoice_id, &invoice);
            env.events().publish((symbol_short!("inv_fund"), investor), invoice_id);
            return true;
        }
        false
    }

    pub fn get_invoice(env: Env, id: u32) -> Option<Invoice> {
        env.storage().instance().get(&id)
    }
}
