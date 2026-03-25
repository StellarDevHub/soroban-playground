# Donation Tracker Example

A simple Soroban contract that tracks total donation amounts and individual donor contributions.

## Simple Example
Each `donate` call increments the total donation amount and the contribution for a specific address.

## Usage
The contract implements:
- `donate(donor: Address, amount: i128)`: records a donation from a specific address. 
- `get_total()`: returns total donations recorded.
- `get_donor_amount(donor: Address)`: returns total donations from a specific donor.

## Requirements
To build and test this contract, ensure you have:
- [Rust](https://www.rust-lang.org/tools/install)
- [Soroban CLI](https://developers.stellar.org/docs/smart-contracts/getting-started/setup)
