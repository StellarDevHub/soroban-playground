# WebSocket Reconnect Strategy

This document describes the automatic reconnection behaviour implemented in
the two frontend WebSocket hooks and explains how cleanup is handled.

---

## Affected Hooks

| Hook | File |
|---|---|
| `useWebSocket` | `src/hooks/useWebSocket.ts` |
| `useTreasuryWebSocket` | `src/hooks/useTreasuryWebSocket.ts` |

> The `eventStream.worker.ts` worker already implemented this pattern
> correctly prior to this change and served as the reference implementation.

---

## Reconnect Strategy

Both hooks use **exponential backoff** to avoid hammering a server that is
temporarily unavailable:

```
delay(attempt) = min(MAX_DELAY, BASE_DELAY × 2^attempt)
```

| Constant | Value |
|---|---|
| `BASE_DELAY` | 1 000 ms |
| `MAX_DELAY` | 30 000 ms |

### Delay Progression (first 6 attempts)

| Attempt | Delay |
|---|---|
| 0 | 1 000 ms |
| 1 | 2 000 ms |
| 2 | 4 000 ms |
| 3 | 8 000 ms |
| 4 | 16 000 ms |
| 5+ | 30 000 ms (capped) |

The attempt counter **resets to 0** after every successful `onopen`.

---

## Intentional vs Unexpected Disconnect

Both hooks track whether a close is *intentional* (triggered by the hook's
own cleanup logic) or *unexpected* (network drop, server restart, etc.).

| Scenario | `intentionalClose` | Reconnect? |
|---|---|---|
| Component unmount / `useEffect` cleanup | `true` | ❌ No |
| Network interruption / server drop | `false` | ✅ Yes |
| Socket error (`onerror`) | `false` | ✅ Yes (via `onclose`) |

### Implementation Detail

Before calling `ws.close()` in the cleanup function the hook sets
`intentionalClose.current = true`.  The `onclose` handler reads this ref and
skips scheduling a reconnect when it is `true`.

---

## Stale Handler Prevention

`useTreasuryWebSocket` clears all event handlers (`onopen`, `onclose`,
`onerror`, `onmessage`) on the *old* socket before creating a new one
(`closeSocket()` helper).  This ensures a delayed OS-level close event from
a previous TCP connection cannot fire and schedule a spurious reconnect after
the hook has already successfully re-connected.

---

## Cleanup Logic

Both hooks store:

- **`wsRef`** — the single active `WebSocket` instance (never more than one)
- **`timerRef` / `reconnectTimerRef`** — the pending `setTimeout` handle

On unmount:

1. `intentionalClose` is set to `true`.
2. Any pending reconnect timer is cancelled with `clearTimeout`.
3. The socket is closed via `ws.close()`.

This prevents:
- Orphaned socket instances
- Memory leaks from uncancelled timers
- Duplicate concurrent connections

---

## Backwards Compatibility

The public API of both hooks is **unchanged**:

```ts
// useWebSocket — unchanged return shape
const { data, isConnected, error, subscribe, unsubscribe, send } = useWebSocket();

// useTreasuryWebSocket — unchanged return shape
const { events, isConnected } = useTreasuryWebSocket();
```

No consumer changes are required.

---

## Tests

Reconnect behaviour is covered by:

- `src/__tests__/hooks/useWebSocket.reconnect.test.ts`
- `src/__tests__/hooks/useTreasuryWebSocket.reconnect.test.ts`

Run them with:

```bash
cd frontend
npx jest src/__tests__/hooks/ --no-coverage
```
