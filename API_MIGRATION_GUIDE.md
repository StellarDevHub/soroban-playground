# API Migration Guide: v1 to v2

This guide details the breaking changes and naming convention updates between API v1 and v2.

## Overview of Changes
- **Naming Convention**: v2 uses `snake_case` instead of `camelCase` for all fields.
- **Deprecation**: v1 is now deprecated and will return a `Warning` header.

### Endpoint: /api/compile

#### Request Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `code` | `code` | string |
| `dependencies` | `dependencies` | object |

#### Response Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `success` | `success` | - |
| `durationMs` | `duration_ms` | - |
| `artifact.sizeBytes` | `artifact.size_bytes` | - |

---

### Endpoint: /api/deploy

#### Request Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `wasmPath` | `wasm_path` | string |
| `contractName` | `contract_name` | string |

#### Response Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `contractId` | `contract_id` | - |
| `deployedAt` | `deployed_at` | - |

---

### Endpoint: /api/invoke

#### Request Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `contractId` | `contract_id` | string |
| `functionName` | `function_name` | string |

#### Response Changes
| v1 Field | v2 Field | Type |
|----------|----------|------|
| `invokedAt` | `invoked_at` | - |

---

