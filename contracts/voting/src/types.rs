use soroban_sdk::{contracterror, contracttype, Address, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    EmptyOptions = 3,
    DuplicateOption = 4,
    UnknownOption = 5,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Options,
    TotalVoters,
}

#[contracttype]
pub enum DataKey {
    Vote(Address),
    Count(Symbol),
}
