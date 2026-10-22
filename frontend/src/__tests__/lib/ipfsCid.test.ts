import {
  base32Encode,
  computeArtifactHashes,
  computeRawCidV1,
  computeUnixFsCidV1,
  ipfsUri,
  sha256Hex,
} from "../../utils/ipfsCid";

const encoder = new TextEncoder();

describe("ipfsCid", () => {
  it("computes standard SHA-256 digests", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(encoder.encode("hello world"))).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("encodes lower-case RFC 4648 base32 without padding", () => {
    expect(base32Encode(encoder.encode("hello"))).toBe("nbswy3dp");
  });

  it("matches canonical UnixFS CIDv1 values", () => {
    expect(computeUnixFsCidV1(new Uint8Array(0))).toBe(
      "bafybeif7ztnhq65lumvvtr4ekcwd2ifwgm3awq4zfr3srh462rwyinlb4y",
    );
    expect(computeUnixFsCidV1(encoder.encode("hello world"))).toBe(
      "bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
    );
  });

  it("chunks large files into a balanced UnixFS DAG", () => {
    const data = new Uint8Array(600_000).fill(7);

    expect(computeUnixFsCidV1(data)).toBe(
      "bafybeic2y7rjddtthuo633s2txi6iuudgm2j7kffgrntgnfgrou5nkp36q",
    );
    expect(computeUnixFsCidV1(data, { rawLeaves: true })).toBe(
      "bafybeid3a3lcmihd3ymli2ln4m3rha6djdrh5kenaz2zqgdlpau5hyesty",
    );
    expect(computeRawCidV1(data)).toBe(
      "bafkreifyifhmyoufzvae5q3f756k7rcjh5ygjikygdp4nlxgbqdhlcdlsq",
    );
  });

  it("returns the UnixFS CID plus raw-block candidates", () => {
    const hashes = computeArtifactHashes(encoder.encode("hello world"));

    expect(hashes.cid).toBe(hashes.unixfsCid);
    expect(hashes.cidCandidates).toEqual(
      expect.arrayContaining([
        hashes.unixfsCid,
        hashes.unixfsRawLeavesCid,
        hashes.rawCid,
      ]),
    );
    expect(new Set(hashes.cidCandidates).size).toBe(
      hashes.cidCandidates.length,
    );
    expect(ipfsUri(hashes.cid)).toBe(`ipfs://${hashes.cid}`);
  });
});
