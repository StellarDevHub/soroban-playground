module AMM-FORMAL
  imports INT

  syntax Int ::= amountOut(Int, Int, Int, Int) [function]

  rule amountOut(A, ReserveIn, ReserveOut, FeeBps)
    => (A *Int (10000 -Int FeeBps) *Int ReserveOut)
       /Int (ReserveIn *Int 10000 +Int A *Int (10000 -Int FeeBps))

  syntax Bool ::= preservesConstantProduct(Int, Int, Int, Int) [function]

  rule preservesConstantProduct(ReserveIn, ReserveOut, A, FeeBps)
    => ((ReserveIn +Int A)
        *Int (ReserveOut -Int amountOut(A, ReserveIn, ReserveOut, FeeBps)))
       >=Int (ReserveIn *Int ReserveOut)
endmodule

module AMM-FORMAL-VERIFICATION
  imports AMM-FORMAL

  claim preservesConstantProduct(ReserveIn, ReserveOut, A, FeeBps) => true
    requires ReserveIn >Int 0
      andBool ReserveOut >Int 0
      andBool A >Int 0
      andBool FeeBps >=Int 0
      andBool FeeBps <Int 10000
endmodule
