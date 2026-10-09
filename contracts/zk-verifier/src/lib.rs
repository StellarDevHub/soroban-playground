#![no_std]

//! A stateless Groth16 verifier for the BN254 curve.
//!
//! Points use the Ethereum-compatible uncompressed encoding expected by the
//! Soroban BN254 host functions. Public inputs are canonical, big-endian Fr
//! elements. Callers should bind every private transaction field that must not
//! be malleable (commitment, nullifier, asset, amount, recipient, and domain)
//! into the circuit's public inputs.
#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    symbol_short, BytesN, Env, Vec,
};

/// A conservative ceiling that bounds decoding, MSM, and pairing costs.
pub const MAX_PUBLIC_INPUTS: u32 = 64;
const NULLIFIER_TTL_THRESHOLD: u32 = 30 * 17_280;
const NULLIFIER_TTL_EXTEND_TO: u32 = 365 * 17_280;

// BN254 scalar field order, in canonical big-endian form.
const FR_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// A Groth16 proof encoded as uncompressed BN254 affine points.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proof {
    /// G1: `X || Y`, with 32-byte big-endian coordinates.
    pub a: BytesN<64>,
    /// G2: `X.c1 || X.c0 || Y.c1 || Y.c0`.
    pub b: BytesN<128>,
    /// G1: `X || Y`, with 32-byte big-endian coordinates.
    pub c: BytesN<64>,
}

/// A prepared Groth16 verification key.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationKey {
    pub alpha_g1: BytesN<64>,
    pub beta_g2: BytesN<128>,
    pub gamma_g2: BytesN<128>,
    pub delta_g2: BytesN<128>,
    /// Input-coefficient points. Its length must be `public_inputs.len() + 1`.
    pub ic: Vec<BytesN<64>>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidInputCount = 1,
    TooManyPublicInputs = 2,
    NonCanonicalPublicInput = 3,
    InvalidG1Point = 4,
    InvalidNullifierIndex = 5,
    NullifierAlreadyUsed = 6,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Nullifier(BytesN<32>),
}

#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    /// Verifies a proof and consumes its first public input as a nullifier once.
    ///
    /// Circuits must bind the first public input as the nullifier so it cannot
    /// be changed independently of the statement proven by the circuit.
    pub fn verify_and_consume_nullifier(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, Error> {
        if public_inputs.is_empty() {
            return Err(Error::InvalidNullifierIndex);
        }
        let nullifier = public_inputs.get(0).unwrap();
        let key = DataKey::Nullifier(nullifier.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::NullifierAlreadyUsed);
        }

        if !Self::verify(env.clone(), vk, proof, public_inputs)? {
            return Ok(false);
        }

        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(
            &key,
            NULLIFIER_TTL_THRESHOLD,
            NULLIFIER_TTL_EXTEND_TO,
        );
        env.events()
            .publish((symbol_short!("nullifier"),), nullifier);
        Ok(true)
    }

    /// Verifies a Groth16 proof against `vk` and the ordered public inputs.
    ///
    /// Returns `Ok(false)` for a well-formed but invalid proof. Malformed G1
    /// points and non-canonical scalars return an explicit error. The Soroban
    /// host validates G2 curve/subgroup membership during pairing.
    pub fn verify(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, Error> {
        let input_count = public_inputs.len();
        if input_count > MAX_PUBLIC_INPUTS {
            return Err(Error::TooManyPublicInputs);
        }
        if vk.ic.len() != input_count + 1 {
            return Err(Error::InvalidInputCount);
        }

        let bn254 = env.crypto().bn254();
        let alpha = checked_g1(&bn254, vk.alpha_g1)?;
        let proof_a = checked_g1(&bn254, proof.a)?;
        let proof_c = checked_g1(&bn254, proof.c)?;

        let mut ic_points = Vec::new(&env);
        let mut scalars = Vec::new(&env);
        let mut i = 0;
        while i < input_count {
            let scalar_bytes = public_inputs.get(i).unwrap();
            if !is_canonical_scalar(&scalar_bytes.to_array()) {
                return Err(Error::NonCanonicalPublicInput);
            }
            ic_points.push_back(checked_g1(&bn254, vk.ic.get(i + 1).unwrap())?);
            scalars.push_back(Bn254Fr::from_bytes(scalar_bytes));
            i += 1;
        }

        let mut vk_x = checked_g1(&bn254, vk.ic.get(0).unwrap())?;
        if input_count != 0 {
            vk_x = bn254.g1_add(&vk_x, &bn254.g1_msm(ic_points, scalars));
        }

        // e(A,B) * e(-vk_x,gamma) * e(-C,delta) * e(-alpha,beta) == 1
        let mut g1 = Vec::new(&env);
        g1.push_back(proof_a);
        g1.push_back(-vk_x);
        g1.push_back(-proof_c);
        g1.push_back(-alpha);

        let mut g2 = Vec::new(&env);
        g2.push_back(Bn254G2Affine::from_bytes(proof.b));
        g2.push_back(Bn254G2Affine::from_bytes(vk.gamma_g2));
        g2.push_back(Bn254G2Affine::from_bytes(vk.delta_g2));
        g2.push_back(Bn254G2Affine::from_bytes(vk.beta_g2));

        Ok(bn254.pairing_check(g1, g2))
    }
}

fn checked_g1(
    bn254: &soroban_sdk::crypto::bn254::Bn254,
    bytes: BytesN<64>,
) -> Result<Bn254G1Affine, Error> {
    let point = Bn254G1Affine::from_bytes(bytes);
    if !bn254.g1_is_on_curve(&point) {
        return Err(Error::InvalidG1Point);
    }
    Ok(point)
}

fn is_canonical_scalar(value: &[u8; 32]) -> bool {
    let mut i = 0;
    while i < value.len() {
        if value[i] < FR_MODULUS[i] {
            return true;
        }
        if value[i] > FR_MODULUS[i] {
            return false;
        }
        i += 1;
    }
    false
}
