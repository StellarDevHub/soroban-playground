import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockUseMonaco = jest.fn();
jest.mock("@/hooks/useMonaco", () => ({
  useMonaco: (props: any) => mockUseMonaco(props),
}));

jest.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: jest.fn(),
}));

import Editor from "../../components/Editor";
import { useCollaborativeEditor } from "@/hooks/useCollaborativeEditor";

describe("Editor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useCollaborativeEditor as jest.Mock).mockReturnValue({
      peers: [],
      isConnected: false,
      sendCursorUpdate: jest.fn(),
    });
  });

  it("renders the loading state and then renders the Monaco editor", async () => {
    let ready = false;
    mockUseMonaco.mockImplementation(() => ({
      containerRef: { current: null },
      isEditorReady: ready,
    }));

    const { rerender } = render(<Editor code="initial code" setCode={jest.fn()} />);

    expect(screen.getByText(/loading editor/i)).toBeInTheDocument();

    ready = true;
    rerender(<Editor code="initial code" setCode={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/loading editor/i)).not.toBeInTheDocument();
  });

  it("calls setCode when the Monaco editor onChange is invoked", async () => {
    let capturedOnChange: ((val: string) => void) | undefined;
    mockUseMonaco.mockImplementation(({ onChange }) => {
      capturedOnChange = onChange;
      return {
        containerRef: { current: null },
        isEditorReady: true,
      };
    });
    const setCode = jest.fn();

    render(<Editor code="initial code" setCode={setCode} />);

    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    capturedOnChange?.("updated code");

    expect(setCode).toHaveBeenCalledWith("updated code");
  });

  it("renders collaborative header with peer count and connection state", async () => {
    mockUseMonaco.mockReturnValue({
      containerRef: { current: null },
      isEditorReady: true,
    });
    (useCollaborativeEditor as jest.Mock).mockReturnValue({
      peers: [{ id: "peer-1", name: "Peer", color: "#ff0000" }],
      isConnected: true,
      sendCursorUpdate: jest.fn(),
    });

    render(<Editor code="initial code" setCode={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument(),
    );

    expect(screen.getByText(/Collab \(2\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Connected/i)).not.toBeInTheDocument();
  });

  it("announces offline Rust syntax fallback", () => {
    mockUseMonaco.mockReturnValue({
      containerRef: { current: null },
      isEditorReady: true,
      languageServiceStatus: "offline",
    });

    render(<Editor code="initial code" setCode={jest.fn()} />);

    expect(
      screen.getByRole("status", {
        name: "Rust worker offline, using local syntax checks",
      }),
    ).toHaveTextContent("Offline syntax");
  });
});
