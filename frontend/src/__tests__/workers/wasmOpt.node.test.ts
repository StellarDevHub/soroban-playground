import assert from "node:assert/strict";
import { test } from "node:test";
import { optimiseWasm, type WasmOptPasses } from "../../workers/wasmOptCore.ts";
import { loadBinaryen } from "../../workers/loadBinaryen.ts";
import { buildSampleContract } from "../../testFixtures/sampleContracts.ts";

const PASSES: WasmOptPasses = {
  stripDebugNames: true,
  stripProducers: true,
  stripUnknownCustom: true,
  mergeDataSegments: false,
  inlining: true,
  deadCodeElimination: true,
  constMerging: true,
};

test("binaryen -Oz reduces sample contract binaries by at least 20%", async () => {
  const binaryen = await loadBinaryen();
  const stages: string[] = [];

  for (const options of [
    { functionCount: 12, debugNameBytes: 6000, dwarfBytes: 4000 },
    { functionCount: 24, debugNameBytes: 12000, dwarfBytes: 2000 },
  ]) {
    const input = buildSampleContract(options);
    const result = await optimiseWasm(input, PASSES, (stage) => {
      stages.push(stage);
    }, binaryen);

    const reductionPct = ((input.length - result.output.length) / input.length) * 100;
    assert.ok(
      reductionPct >= 20,
      `expected >=20% reduction, got ${reductionPct.toFixed(1)}%`,
    );
    assert.equal(WebAssembly.validate(result.output), true);
    assert.ok(
      new TextDecoder().decode(result.output).includes("contractspecv0"),
      "Soroban contract spec section must survive optimisation",
    );
  }

  assert.ok(stages.some((stage) => stage.includes("binaryen")));
  assert.ok(stages.includes("Optimisation complete"));
});
