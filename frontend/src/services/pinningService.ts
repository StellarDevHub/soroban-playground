export type StorageProvider = "pinata" | "web3storage" | "arweave" | "filecoin";

export type StorageNetwork = "ipfs" | "arweave" | "filecoin";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface StorageProviderInfo {
  id: StorageProvider;
  label: string;
  description: string;
  networks: StorageNetwork[];
  tokenLabel: string;
  tokenPlaceholder: string;
}

export const STORAGE_PROVIDERS: StorageProviderInfo[] = [
  {
    id: "pinata",
    label: "Pinata",
    description: "IPFS pinning with a Pinata JWT.",
    networks: ["ipfs"],
    tokenLabel: "Pinata JWT",
    tokenPlaceholder: "eyJhbGciOi…",
  },
  {
    id: "web3storage",
    label: "Web3.Storage",
    description: "IPFS pinning with Filecoin persistence.",
    networks: ["ipfs", "filecoin"],
    tokenLabel: "Web3.Storage token",
    tokenPlaceholder: "Bearer token",
  },
  {
    id: "arweave",
    label: "Arweave",
    description: "Upload through a configured Arweave bundler.",
    networks: ["arweave"],
    tokenLabel: "Bundler token (optional)",
    tokenPlaceholder: "Optional bearer token",
  },
  {
    id: "filecoin",
    label: "Filecoin",
    description: "Lighthouse Filecoin pinning with an API key.",
    networks: ["filecoin"],
    tokenLabel: "Lighthouse API key",
    tokenPlaceholder: "Lighthouse API key",
  },
];

const PINATA_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const WEB3_STORAGE_ENDPOINT = "https://api.web3.storage/upload";
const LIGHTHOUSE_ENDPOINT = "https://api.lighthouse.storage/api/v0/add";
const DEFAULT_ARWEAVE_BUNDLER_URL = "https://node1.irys.xyz/";

export const IPFS_GATEWAYS = [
  { name: "ipfs.io", baseUrl: "https://ipfs.io/ipfs/" },
  { name: "dweb.link", baseUrl: "https://dweb.link/ipfs/" },
  { name: "w3s.link", baseUrl: "https://w3s.link/ipfs/" },
  { name: "cloudflare", baseUrl: "https://cloudflare-ipfs.com/ipfs/" },
];

export const ARWEAVE_GATEWAYS = [
  { name: "arweave.net", baseUrl: "https://arweave.net/" },
  { name: "irys.xyz", baseUrl: "https://gateway.irys.xyz/" },
];

export interface ProviderUploadInput {
  data: Uint8Array;
  name: string;
  mimeType?: string;
  token?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

export interface ProviderUploadResult {
  remoteId: string;
  remoteCid?: string;
  raw: unknown;
}

export interface PinArtifactInput extends ProviderUploadInput {
  provider: StorageProvider;
  cid: string;
  cidCandidates?: string[];
}

export interface PinArtifactResult {
  provider: StorageProvider;
  remoteId: string;
  remoteCid?: string;
  cidMatches: boolean | null;
  networks: StorageNetwork[];
  uri: string;
  gatewayUrls: string[];
  raw: unknown;
}

export interface GatewayStatus {
  gateway: string;
  url: string;
  available: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
}

export interface AvailabilityOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function toBlob(data: Uint8Array, mimeType = "application/octet-stream") {
  const bytes = new Uint8Array(data);
  return new Blob([bytes.buffer], { type: mimeType });
}

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === "undefined") {
    throw new Error("This environment does not provide fetch().");
  }
  return fetch;
}

function requireToken(token: string | undefined, label: string) {
  if (!token || token.trim() === "") {
    throw new Error(`${label} is required to pin to this provider.`);
  }
  return token.trim();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readNestedString(
  value: unknown,
  keys: string[],
): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }

  for (const nestedKey of ["data", "value", "result", "response"]) {
    const nested = readNestedString(record[nestedKey], keys);
    if (nested) return nested;
  }

  return undefined;
}

function assertOk(response: Response, body: unknown, provider: string) {
  if (response.ok) return;

  const message =
    readNestedString(body, ["message", "error", "details"]) ??
    `Request failed: ${response.status}`;
  throw new Error(`${provider} pin failed (${response.status}): ${message}`);
}

export async function pinToPinata(
  input: ProviderUploadInput,
): Promise<ProviderUploadResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const token = requireToken(input.token, "Pinata JWT");
  const form = new FormData();

  form.append(
    "file",
    toBlob(input.data, input.mimeType),
    input.name,
  );
  form.append(
    "pinataMetadata",
    JSON.stringify({
      name: input.name,
      keyvalues: { source: "soroban-playground" },
    }),
  );
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const response = await fetchImpl(input.endpoint ?? PINATA_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readJson(response);
  assertOk(response, body, "Pinata");

  const remoteCid = readNestedString(body, ["IpfsHash", "cid", "hash"]);
  if (!remoteCid) {
    throw new Error("Pinata did not return an IPFS CID.");
  }

  return { remoteId: remoteCid, remoteCid, raw: body };
}

export async function pinToWeb3Storage(
  input: ProviderUploadInput,
): Promise<ProviderUploadResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const token = requireToken(input.token, "Web3.Storage token");

  const response = await fetchImpl(
    input.endpoint ?? WEB3_STORAGE_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": input.mimeType ?? "application/octet-stream",
        "X-NAME": encodeURIComponent(input.name),
      },
      body: toBlob(input.data, input.mimeType),
    },
  );
  const body = await readJson(response);
  assertOk(response, body, "Web3.Storage");

  const remoteCid = readNestedString(body, ["cid", "IpfsHash", "hash"]);
  if (!remoteCid) {
    throw new Error("Web3.Storage did not return an IPFS CID.");
  }

  return { remoteId: remoteCid, remoteCid, raw: body };
}

export async function pinToFilecoin(
  input: ProviderUploadInput,
): Promise<ProviderUploadResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const token = requireToken(input.token, "Lighthouse API key");
  const form = new FormData();

  form.append("file", toBlob(input.data, input.mimeType), input.name);

  const response = await fetchImpl(input.endpoint ?? LIGHTHOUSE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await readJson(response);
  assertOk(response, body, "Filecoin");

  const remoteCid = readNestedString(body, ["Hash", "cid", "IpfsHash"]);
  if (!remoteCid) {
    throw new Error("The Filecoin provider did not return an IPFS CID.");
  }

  return { remoteId: remoteCid, remoteCid, raw: body };
}

export async function pinToArweave(
  input: ProviderUploadInput,
): Promise<ProviderUploadResult> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  const endpoint =
    input.endpoint ??
    process.env.NEXT_PUBLIC_ARWEAVE_BUNDLER_URL ??
    DEFAULT_ARWEAVE_BUNDLER_URL;

  const headers: Record<string, string> = {
    "Content-Type": input.mimeType ?? "application/octet-stream",
    "X-File-Name": encodeURIComponent(input.name),
  };
  if (input.token && input.token.trim() !== "") {
    headers.Authorization = `Bearer ${input.token.trim()}`;
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: toBlob(input.data, input.mimeType),
  });
  const body = await readJson(response);
  assertOk(response, body, "Arweave");

  const remoteId =
    readNestedString(body, ["id", "txId", "transactionId", "cid"]) ??
    (typeof body === "string" ? body.trim() : undefined);

  if (!remoteId) {
    throw new Error("The Arweave bundler did not return a transaction ID.");
  }

  return { remoteId, raw: body };
}

export function gatewayUrlsFor(
  identifier: string,
  network: StorageNetwork,
): string[] {
  if (network === "arweave") {
    return ARWEAVE_GATEWAYS.map((gateway) => `${gateway.baseUrl}${identifier}`);
  }

  return IPFS_GATEWAYS.map((gateway) => `${gateway.baseUrl}${identifier}`);
}

export async function pinArtifact(
  input: PinArtifactInput,
): Promise<PinArtifactResult> {
  let result: ProviderUploadResult;
  let network: StorageNetwork;
  let networks: StorageNetwork[];

  switch (input.provider) {
    case "pinata":
      result = await pinToPinata(input);
      network = "ipfs";
      networks = ["ipfs"];
      break;
    case "web3storage":
      result = await pinToWeb3Storage(input);
      network = "ipfs";
      networks = ["ipfs", "filecoin"];
      break;
    case "filecoin":
      result = await pinToFilecoin(input);
      network = "filecoin";
      networks = ["filecoin"];
      break;
    case "arweave":
      result = await pinToArweave(input);
      network = "arweave";
      networks = ["arweave"];
      break;
    default:
      throw new Error(`Unsupported storage provider: ${input.provider}`);
  }

  const identifier = result.remoteCid ?? result.remoteId;
  const candidates = input.cidCandidates ?? [input.cid];
  const cidMatches =
    network === "arweave"
      ? null
      : Boolean(result.remoteCid && candidates.includes(result.remoteCid));

  return {
    provider: input.provider,
    remoteId: result.remoteId,
    remoteCid: result.remoteCid,
    cidMatches,
    networks,
    uri: network === "arweave" ? `ar://${identifier}` : `ipfs://${identifier}`,
    gatewayUrls: gatewayUrlsFor(identifier, network),
    raw: result.raw,
  };
}

async function probeGateway(
  gateway: string,
  url: string,
  options: AvailabilityOptions,
): Promise<GatewayStatus> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller =
    typeof AbortController === "undefined" ? undefined : new AbortController();
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      signal: controller?.signal,
    });

    return {
      gateway,
      url,
      available: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      gateway,
      url,
      available: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Gateway unreachable",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function checkAvailability(
  identifier: string,
  network: StorageNetwork = "ipfs",
  options: AvailabilityOptions = {},
): Promise<GatewayStatus[]> {
  const gateways =
    network === "arweave" ? ARWEAVE_GATEWAYS : IPFS_GATEWAYS;

  return Promise.all(
    gateways.map((gateway) =>
      probeGateway(gateway.name, `${gateway.baseUrl}${identifier}`, options),
    ),
  );
}
