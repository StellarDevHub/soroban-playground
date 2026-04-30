use sha2::{Sha256, Digest};
use hex;

pub fn calculate_entry_hash(prev_hash: &str, data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.as_bytes());
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn calculate_merkle_root(hashes: &[String]) -> String {
    if hashes.is_empty() {
        return "0".repeat(64);
    }
    if hashes.len() == 1 {
        return hashes[0].clone();
    }

    let mut current_level: Vec<Vec<u8>> = hashes
        .iter()
        .map(|h| hex::decode(h).unwrap_or_default())
        .collect();

    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        for i in (0..current_level.len()).step_by(2) {
            let left = &current_level[i];
            let right = if i + 1 < current_level.len() {
                &current_level[i + 1]
            } else {
                left
            };

            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            next_level.push(hasher.finalize().to_vec());
        }
        current_level = next_level;
    }

    hex::encode(&current_level[0])
}

pub fn verify_proof(leaf: &str, proof: &[String], root: &str, index: usize) -> bool {
    let mut current_hash = hex::decode(leaf).unwrap_or_default();
    let mut current_index = index;

    for sibling in proof {
        let sibling_hash = hex::decode(sibling).unwrap_or_default();
        let mut hasher = Sha256::new();
        if current_index % 2 == 0 {
            hasher.update(&current_hash);
            hasher.update(&sibling_hash);
        } else {
            hasher.update(&sibling_hash);
            hasher.update(&current_hash);
        }
        current_hash = hasher.finalize().to_vec();
        current_index /= 2;
    }

    hex::encode(current_hash) == root
}
