#![no_std]

use soroban_sdk::{contract, contractimpl, String};

#[contract]
pub struct HelloWorldContract;

#[contractimpl]
impl HelloWorldContract {
    pub fn hello() -> String {
        String::from_str("Hello, Soroban!")
    }
}
