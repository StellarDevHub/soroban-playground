export const SOROBAN_SDK_MOCK = `
pub mod soroban_sdk {
    pub struct Env;
    impl Env {
        pub fn storage(&self) -> Storage { Storage }
    }
    
    pub struct Storage;
    impl Storage {
        pub fn persistent(&self) -> Persistent { Persistent }
        pub fn instance(&self) -> Instance { Instance }
    }
    
    pub struct Persistent;
    pub struct Instance;
    
    pub struct Symbol;
    // ...other heavily used primitives
}
`;

export function getVFSFiles() {
    return {
        "/src/contract.rs": "", // The user's active editor file
        "/Cargo.toml": "...",   // A mocked Cargo.toml linking the SDK
        "/soroban-sdk/src/lib.rs": SOROBAN_SDK_MOCK,
    };
}
