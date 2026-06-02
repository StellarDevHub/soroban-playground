import { render, screen, fireEvent, act } from "@testing-library/react";
import DataTypeFormatter, { detectType } from "../../components/DataTypeFormatter";
import StorageSearchBar from "../../components/StorageSearchBar";
import type { StorageSearchState } from "../../components/StorageSearchBar";

// ─── detectType ──────────────────────────────────────────────────────────────

describe("detectType", () => {
  it.each([
    [null, "null"],
    [undefined, "null"],
    [true, "boolean"],
    [false, "boolean"],
    [42, "integer"],
    [3.14, "decimal"],
    [{ a: 1 }, "json"],
    [["x"], "json"],
    ["0x1a2b3c4d5e6f", "hex"],
    ["GABC1234567890XYZTESTACCOUNTADDRESSFULL1234567890AB", "address"],
    ["aGVsbG8gd29ybGQ=", "base64"],
    ["99", "integer"],
    ["1.5", "decimal"],
    ["hello world", "string"],
  ])("detectType(%j) → %s", (input, expected) => {
    expect(detectType(input)).toBe(expected);
  });
});

// ─── DataTypeFormatter ───────────────────────────────────────────────────────

describe("DataTypeFormatter", () => {
  it("renders a type badge by default", () => {
    render(<DataTypeFormatter value={42} />);
    expect(screen.getByText("i64")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("hides badge when showBadge=false", () => {
    render(<DataTypeFormatter value={42} showBadge={false} />);
    expect(screen.queryByText("i64")).not.toBeInTheDocument();
  });

  it("renders null as ∅", () => {
    render(<DataTypeFormatter value={null} />);
    expect(screen.getByText("∅")).toBeInTheDocument();
  });

  it("renders boolean values", () => {
    render(<DataTypeFormatter value={true} />);
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("bool")).toBeInTheDocument();
  });

  it("renders hex with truncation for long values", () => {
    const longHex = `0x${"ab".repeat(30)}`;
    render(<DataTypeFormatter value={longHex} />);
    // badge should show "hex"
    expect(screen.getByText("hex")).toBeInTheDocument();
    // value should be truncated (contains …)
    expect(screen.getByText(/…/)).toBeInTheDocument();
  });

  it("renders JSON objects as formatted text", () => {
    render(<DataTypeFormatter value={{ key: "val" }} />);
    expect(screen.getByText("json")).toBeInTheDocument();
  });

  it("respects forceType override", () => {
    render(<DataTypeFormatter value="0x1234" forceType="string" />);
    expect(screen.getByText("str")).toBeInTheDocument();
  });
});

// ─── StorageSearchBar ────────────────────────────────────────────────────────

jest.useFakeTimers();

const defaultState: StorageSearchState = { query: "", types: [] };

describe("StorageSearchBar", () => {
  it("renders search input and all type filters", () => {
    render(<StorageSearchBar value={defaultState} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: /search storage/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "hex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "address" })).toBeInTheDocument();
  });

  it("calls onChange with debounced query", () => {
    const onChange = jest.fn();
    render(<StorageSearchBar value={defaultState} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "counter" } });
    act(() => jest.advanceTimersByTime(250));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: "counter" }));
  });

  it("toggles data type filter on button click", () => {
    const onChange = jest.fn();
    render(<StorageSearchBar value={defaultState} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "hex" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: ["hex"] }));
  });

  it("removes active type filter on second click", () => {
    const onChange = jest.fn();
    const state: StorageSearchState = { query: "", types: ["hex"] };
    render(<StorageSearchBar value={state} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "hex" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ types: [] }));
  });

  it("shows clear button when query is set and clears on click", () => {
    const onChange = jest.fn();
    const state: StorageSearchState = { query: "test", types: [] };
    render(<StorageSearchBar value={state} onChange={onChange} />);
    const clearBtn = screen.getByRole("button", { name: /clear filters/i });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith({ query: "", types: [] });
  });

  it("shows clear button when type filters are active", () => {
    const state: StorageSearchState = { query: "", types: ["json"] };
    render(<StorageSearchBar value={state} onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("marks active type filter with aria-pressed=true", () => {
    const state: StorageSearchState = { query: "", types: ["integer"] };
    render(<StorageSearchBar value={state} onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "integer" })).toHaveAttribute("aria-pressed", "true");
  });
});
