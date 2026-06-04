# Storage Utilities Contract

Reusable, gas-efficient Soroban storage patterns. Each collection is namespaced by a `Symbol` so multiple independent collections can coexist in the same contract.

## Collections

| Collection | Type | Operations |
|---|---|---|
| StorageMap | Key-value | `map_set`, `map_get`, `map_has`, `map_remove` |
| StorageVec | Dynamic array | `vec_push`, `vec_pop`, `vec_get`, `vec_set`, `vec_len` |
| StorageQueue | FIFO | `queue_push`, `queue_pop`, `queue_peek`, `queue_len` |
| StorageStack | LIFO | `stack_push`, `stack_pop`, `stack_peek`, `stack_len` |
| StorageSet | Unique values | `set_add`, `set_has`, `set_remove`, `set_len` |

All collections use `i128` values. Namespaces are `Symbol` values — use distinct symbols to keep collections independent.

## Error Codes

| Error | Code | Meaning |
|---|---|---|
| `KeyNotFound` | 1 | Map key does not exist |
| `IndexOutOfBounds` | 2 | Vec index out of range |
| `QueueEmpty` | 3 | Queue has no elements |
| `StackEmpty` | 4 | Stack has no elements |
| `Overflow` | 5 | Collection length overflow |

## Build & Test

```bash
cd contracts/storage-utils
cargo test
cargo build --target wasm32-unknown-unknown --release
```
