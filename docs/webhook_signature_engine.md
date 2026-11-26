# Cryptographic Webhook Delivery & Signature Verification Engine

Specification for HMAC-SHA256 signature generation and retry queues for webhooks emitted on smart contract events.

---

## 1. Webhook Signature Header

```http
Stellar-Signature: t=1753401600,v1=<hex HMAC-SHA256>
```

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw-payload>")`. The
timestamp is Unix time in seconds. Receivers must verify the HMAC using the
unmodified request body and reject timestamps more than five minutes from
their current time. This timestamp check limits replay attacks. Legacy
`X-Soroban-Signature` and `X-Playground-Signature` headers remain available for
existing integrations; new consumers should use `Stellar-Signature`.

## 2. Delivery and retry policy

Each HTTP(S) POST has a strict five-second deadline, including response-body
reading. A delivery is attempted at most five times: the initial request plus
retries scheduled after 1 minute, 5 minutes, 15 minutes, and 1 hour. If all
attempts fail, the delivery is marked failed and its subscription is
deactivated.

---

## References

- Issue reference: #1999
- Related signature engine: #1026
