import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StoragePinningDashboard, {
  type PinnedArtifact,
} from "../../components/Ipfs/StoragePinningDashboard";

const encoder = new TextEncoder();

const baseArtifact: PinnedArtifact = {
  id: "artifact-1",
  name: "contract_v1.rs",
  kind: "source",
  provider: "pinata",
  size: 2048,
  sha256:
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  cid: "bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
  remoteId:
    "bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
  remoteCid:
    "bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
  uri: "ipfs://bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
  networks: ["ipfs"],
  gatewayUrls: [
    "https://ipfs.io/ipfs/bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa",
  ],
  pinnedAt: "2026-10-22T10:00:00.000Z",
  persistence: "pinned",
  cidVerified: true,
  availability: [
    {
      gateway: "ipfs.io",
      url: "https://ipfs.io/ipfs/bafy",
      available: true,
      status: 200,
      latencyMs: 20,
    },
    {
      gateway: "dweb.link",
      url: "https://dweb.link/ipfs/bafy",
      available: false,
      status: 503,
      latencyMs: 30,
    },
  ],
};

const arweaveArtifact: PinnedArtifact = {
  ...baseArtifact,
  id: "artifact-2",
  name: "contract-abi.json",
  kind: "abi",
  provider: "arweave",
  cid: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
  remoteId: "ar-tx-123",
  remoteCid: undefined,
  uri: "ar://ar-tx-123",
  networks: ["arweave"],
  gatewayUrls: ["https://arweave.net/ar-tx-123"],
  cidVerified: null,
  availability: [],
  persistence: "pinned",
};

describe("StoragePinningDashboard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders pinned artifacts and filters by search text", () => {
    render(
      <StoragePinningDashboard
        initialArtifacts={[baseArtifact, arweaveArtifact]}
      />,
    );

    expect(screen.getByText("contract_v1.rs")).toBeInTheDocument();
    expect(screen.getByText("contract-abi.json")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search pinned artifacts/i), {
      target: { value: "ar-tx-123" },
    });

    expect(screen.queryByText("contract_v1.rs")).not.toBeInTheDocument();
    expect(screen.getByText("contract-abi.json")).toBeInTheDocument();
  });

  it("copies the IPFS URI with one click", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<StoragePinningDashboard initialArtifacts={[baseArtifact]} />);

    fireEvent.click(
      screen.getByRole("button", { name: `Copy ${baseArtifact.uri}` }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(baseArtifact.uri),
    );
  });

  it("hashes a file locally and records a verified pin", async () => {
    const bytes = encoder.encode("hello world");
    const file = new File([bytes], "contract.rs", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer,
    });

    const remoteCid =
      "bafybeihykld7uyxzogax6vgyvag42y7464eywpf55gxi5qpoisibh3c5wa";
    const pinMock = jest.fn().mockResolvedValue({
      provider: "pinata",
      remoteId: remoteCid,
      remoteCid,
      cidMatches: true,
      networks: ["ipfs"],
      uri: `ipfs://${remoteCid}`,
      gatewayUrls: [`https://ipfs.io/ipfs/${remoteCid}`],
      raw: {},
    });
    const availabilityMock = jest.fn().mockResolvedValue([
      {
        gateway: "ipfs.io",
        url: `https://ipfs.io/ipfs/${remoteCid}`,
        available: true,
        status: 200,
        latencyMs: 12,
      },
    ]);

    render(
      <StoragePinningDashboard
        pinArtifact={pinMock}
        checkAvailability={availabilityMock}
      />,
    );

    fireEvent.change(screen.getByLabelText(/choose a contract artifact/i), {
      target: { files: [file] },
    });

    expect(await screen.findByText(remoteCid)).toBeInTheDocument();
    expect(screen.getByText("Local hash")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/pinata jwt/i), {
      target: { value: "pinata-jwt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^pin artifact$/i }));

    await waitFor(() =>
      expect(pinMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "pinata",
          name: "contract.rs",
          token: "pinata-jwt",
          cid: remoteCid,
        }),
      ),
    );

    expect(await screen.findByText(/pinned through Pinata/i)).toBeInTheDocument();
    expect(availabilityMock).toHaveBeenCalledWith(remoteCid, "ipfs");
    expect(await screen.findByText("Verified")).toBeInTheDocument();
  });
});
