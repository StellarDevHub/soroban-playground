# Formal protocol invariants

These K Framework specifications model the integer arithmetic invariants used
by the Soroban AMM and lending pool. The AMM model uses the pool's basis-point
fee formula and proves that a valid swap does not reduce `reserveA * reserveB`.
The lending model proves that a borrow admitted by the 80% collateral rule
remains healthy and that a repayment no larger than the debt cannot make a
healthy position unhealthy.

Run the proofs from this directory with K Framework 7.1.337:

```sh
kompile amm.k --backend haskell --main-module AMM-FORMAL
kprove --definition amm-kompiled --spec-module AMM-FORMAL-VERIFICATION amm.k
kompile lending-pool.k --backend haskell --main-module LENDING-POOL-FORMAL
kprove --definition lending-pool-kompiled --spec-module LENDING-POOL-FORMAL-VERIFICATION lending-pool.k
```

These are unbounded-integer arithmetic specifications of the protocol
invariants; the Rust property suites separately exercise implementation code
and checked-arithmetic boundaries.
