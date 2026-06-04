#![no_std]

use soroban_sdk::{contract, contractimpl, Env, String};

#[contract]
pub struct HelloWorldContract;

#[contractimpl]
impl HelloWorldContract {
    pub fn hello(env: Env) -> String {
        String::from_str(&env, "Hello, Soroban!")
    }
}
