import { optimiseWasm, profileWasm, type WasmOptPasses } from "@/workers/wasmOptCore";
import { buildSampleContract } from "../../testFixtures/sampleContracts.ts";

const ALL_PASSES: WasmOptPasses = {
  stripDebugNames: true,
  stripProducers: true,
  stripUnknownCustom: true,
  mergeDataSegments: false,
  inlining: true,
  deadCodeElimination: true,
  constMerging: true,
};

describe("wasmOptCore", () => {
  it("profiles bytecode sections by category", () => {
    const profile = profileWasm(buildSampleContract());
    expect(profile.categories.code).toBeGreaterThan(0);
    expect(profile.categories.types).toBeGreaterThan(0);
    expect(profile.categories.custom).toBeGreaterThan(0);
    expect(profile.categories.data).toBe(0);
    expect(profile.sections.some((section) => section.name === "Code")).toBe(true);
  });

  it("reduces a sample contract by at least 20% without binaryen", async () => {
    const input = buildSampleContract();
    const result = await optimiseWasm(input, ALL_PASSES);

    const reductionPct = ((input.length - result.output.length) / input.length) * 100;
    expect(reductionPct).toBeGreaterThanOrEqual(20);
    expect(result.profile.after.totalBytes).toBe(result.output.length);
  });

  it("reports monotonic progress that terminates at 100%", async () => {
    const stages: Array<[string, number]> = [];
    await optimiseWasm(buildSampleContract(), ALL_PASSES, (stage, percent) => {
      stages.push([stage, percent]);
    });

    expect(stages.length).toBeGreaterThan(2);
    expect(stages[stages.length - 1]).toEqual(["Optimisation complete", 100]);
    for (let index = 1; index < stages.length; index += 1) {
      expect(stages[index][1]).toBeGreaterThanOrEqual(stages[index - 1][1]);
    }
  });

  it("preserves Soroban spec sections and identifiers", async () => {
    const input = buildSampleContract({ identifiers: ["transfer", "balance"] });
    const result = await optimiseWasm(input, ALL_PASSES);
    const decoder = new TextDecoder();
    const outputText = decoder.decode(result.output);

    expect(outputText).toContain("contractspecv0");
    expect(outputText).toContain("transfer");
    expect(outputText).toContain("balance");
  });

  it("rejects invalid WASM input", async () => {
    await expect(
      optimiseWasm(new Uint8Array([1, 2, 3]), ALL_PASSES),
    ).rejects.toThrow(/WebAssembly validation/i);
  });

  it("uses an injected binaryen implementation when available", async () => {
    const runPasses = jest.fn();
    const emitBinary = jest.fn(() => buildSampleContract({ debugNameBytes: 100 }));
    const dispose = jest.fn();
    const binaryen = {
      setOptimizeLevel: jest.fn(),
      setShrinkLevel: jest.fn(),
      readBinary: jest.fn(() => ({ runPasses, emitBinary, dispose })),
    };

    const result = await optimiseWasm(
      buildSampleContract(),
      ALL_PASSES,
      undefined,
      binaryen,
    );

    expect(binaryen.readBinary).toHaveBeenCalled();
    expect(runPasses).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
    expect(result.passResults.some((pass) => pass.pass.includes("Binaryen"))).toBe(true);
  });
});
