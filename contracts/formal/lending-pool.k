module LENDING-POOL-FORMAL
  imports INT

  syntax Bool ::= lendingHealthy(Int, Int) [function]

  rule lendingHealthy(Collateral, Debt)
    => Debt *Int 10000 <=Int Collateral *Int 8000

  syntax Bool ::= borrowPreservesHealth(Int, Int, Int) [function]

  rule borrowPreservesHealth(Collateral, Debt, Amount)
    => lendingHealthy(Collateral, Debt +Int Amount)

  syntax Bool ::= repayPreservesHealth(Int, Int, Int) [function]

  rule repayPreservesHealth(Collateral, Debt, Amount)
    => lendingHealthy(Collateral, Debt -Int Amount)
endmodule

module LENDING-POOL-FORMAL-VERIFICATION
  imports LENDING-POOL-FORMAL

  claim borrowPreservesHealth(Collateral, Debt, Amount) => true
    requires Collateral >=Int 0
      andBool Debt >=Int 0
      andBool Amount >=Int 0
      andBool (Debt +Int Amount) *Int 10000 <=Int Collateral *Int 8000

  claim repayPreservesHealth(Collateral, Debt, Amount) => true
    requires Collateral >=Int 0
      andBool Debt >=Int 0
      andBool Amount >=Int 0
      andBool Amount <=Int Debt
      andBool Debt *Int 10000 <=Int Collateral *Int 8000
endmodule
