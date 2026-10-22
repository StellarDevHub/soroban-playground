import {
  checkAvailability,
  pinArtifact,
  pinToArweave,
  pinToFilecoin,
  pinToPinata,
  pinToWeb3Storage,
  type FetchLike,
} from "../../services/pinningService";

const encoder = new TextEncoder();

function mockResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as Response;
}

function asFetch(mock: jest.Mock): FetchLike {
  return mock as unknown as FetchLike;
}

describe("pinningService", () => {
  it("uploads a file to Pinata with a v1 CID and metadata", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockResponse({ IpfsHash: "bafy-pinata" }),
    );

    const result = await pinToPinata({
      data: encoder.encode("hello world"),
      name: "contract.rs",
      mimeType: "text/plain",
      token: "pinata-jwt",
      fetchImpl: asFetch(fetchMock),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer pinata-jwt" });

    const body = init.body as FormData;
    expect((body.get("file") as File).name).toBe("contract.rs");
    expect(JSON.parse(String(body.get("pinataOptions")))).toEqual({
      cidVersion: 1,
    });
    expect(JSON.parse(String(body.get("pinataMetadata")))).toMatchObject({
      name: "contract.rs",
    });
    expect(result).toMatchObject({
      remoteId: "bafy-pinata",
      remoteCid: "bafy-pinata",
    });
  });

  it("uploads to Web3.Storage with bearer auth and file metadata", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ cid: "bafy-w3s" }));

    const result = await pinToWeb3Storage({
      data: encoder.encode("abi"),
      name: "contract abi.json",
      mimeType: "application/json",
      token: "w3s-token",
      fetchImpl: asFetch(fetchMock),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.web3.storage/upload");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer w3s-token",
      "Content-Type": "application/json",
      "X-NAME": encodeURIComponent("contract abi.json"),
    });
    expect(result.remoteCid).toBe("bafy-w3s");
  });

  it("uploads to Filecoin through Lighthouse", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ Hash: "bafy-lighthouse" }));

    const result = await pinToFilecoin({
      data: encoder.encode("metadata"),
      name: "build.json",
      token: "lighthouse-key",
      fetchImpl: asFetch(fetchMock),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lighthouse.storage/api/v0/add");
    expect(init.headers).toEqual({
      Authorization: "Bearer lighthouse-key",
    });
    expect(result.remoteId).toBe("bafy-lighthouse");
  });

  it("uploads to an Arweave bundler and reads the transaction id", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ id: "ar-tx-123" }));

    const result = await pinToArweave({
      data: encoder.encode("wasm"),
      name: "contract.wasm",
      mimeType: "application/wasm",
      token: "bundler-token",
      endpoint: "https://bundler.example/upload",
      fetchImpl: asFetch(fetchMock),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://bundler.example/upload");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer bundler-token",
      "Content-Type": "application/wasm",
    });
    expect(result.remoteId).toBe("ar-tx-123");
  });

  it("verifies remote IPFS CIDs against local candidates", async () => {
    const localCid = "bafy-local";
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ IpfsHash: localCid }));

    const result = await pinArtifact({
      provider: "pinata",
      data: encoder.encode("hello"),
      name: "hello.txt",
      token: "jwt",
      cid: localCid,
      cidCandidates: ["bafy-other", localCid],
      fetchImpl: asFetch(fetchMock),
    });

    expect(result.cidMatches).toBe(true);
    expect(result.uri).toBe(`ipfs://${localCid}`);
    expect(result.gatewayUrls).toEqual(
      expect.arrayContaining([`https://ipfs.io/ipfs/${localCid}`]),
    );
  });

  it("flags a remote CID mismatch instead of accepting it", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ IpfsHash: "bafy-remote" }));

    const result = await pinArtifact({
      provider: "pinata",
      data: encoder.encode("hello"),
      name: "hello.txt",
      token: "jwt",
      cid: "bafy-local",
      cidCandidates: ["bafy-local"],
      fetchImpl: asFetch(fetchMock),
    });

    expect(result.cidMatches).toBe(false);
  });

  it("does not claim IPFS parity for Arweave transaction ids", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({ id: "ar-tx-999" }));

    const result = await pinArtifact({
      provider: "arweave",
      data: encoder.encode("hello"),
      name: "hello.txt",
      cid: "bafy-local",
      endpoint: "https://bundler.example/upload",
      fetchImpl: asFetch(fetchMock),
    });

    expect(result.cidMatches).toBeNull();
    expect(result.uri).toBe("ar://ar-tx-999");
    expect(result.networks).toEqual(["arweave"]);
  });

  it("probes every gateway and reports availability independently", async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ipfs.io") || url.includes("dweb.link")) {
        return Promise.resolve(mockResponse({}, { status: 200 }));
      }
      return Promise.reject(new Error("gateway down"));
    });

    const statuses = await checkAvailability("bafy-test", "ipfs", {
      fetchImpl: asFetch(fetchMock),
      timeoutMs: 50,
    });

    expect(statuses).toHaveLength(4);
    expect(statuses.filter((status) => status.available)).toHaveLength(2);
    expect(
      statuses.find((status) => status.gateway === "ipfs.io"),
    ).toMatchObject({ available: true, status: 200 });
    expect(
      statuses.find((status) => status.gateway === "cloudflare"),
    ).toMatchObject({ available: false, status: null });
  });

  it("uses Arweave gateways for Arweave availability checks", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(mockResponse({}, { status: 200 }));

    const statuses = await checkAvailability("ar-tx-1", "arweave", {
      fetchImpl: asFetch(fetchMock),
      timeoutMs: 50,
    });

    expect(statuses).toHaveLength(2);
    expect(statuses[0].url).toBe("https://arweave.net/ar-tx-1");
  });
});
