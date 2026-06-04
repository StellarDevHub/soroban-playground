import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TemplateLibraryGrid from "../../components/TemplateLibraryGrid";

const FAVORITES_KEY = "template-favorites";
const RECENT_KEY = "template-recent";

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function advanceTimers() {
  act(() => {
    jest.advanceTimersByTime(200);
  });
}

describe("TemplateLibraryGrid", () => {
  it("renders all templates initially", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(screen.getByText("AMM Pool")).toBeInTheDocument();
    expect(screen.getByText("Counter")).toBeInTheDocument();
  });

  it("filters templates by search text", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Search contract templates");
    fireEvent.change(input, { target: { value: "hello" } });
    advanceTimers();

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.queryByText("AMM Pool")).not.toBeInTheDocument();
  });

  it("filters templates by category", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const utilityButton = screen.getByRole("checkbox", { name: "utility" });
    fireEvent.click(utilityButton);

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.queryByText("AMM Pool")).not.toBeInTheDocument();
  });

  it("composes search and category filters together", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const utilityButton = screen.getByRole("checkbox", { name: "utility" });
    fireEvent.click(utilityButton);

    const input = screen.getByLabelText("Search contract templates");
    fireEvent.change(input, { target: { value: "counter" } });
    advanceTimers();

    expect(screen.getByText("Counter")).toBeInTheDocument();
    expect(screen.queryByText("Hello World")).not.toBeInTheDocument();
  });

  it("shows empty state when no results match with clear filters button", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Search contract templates");
    fireEvent.change(input, { target: { value: "zzzznotfound" } });
    advanceTimers();

    expect(
      screen.getByText("No templates match your search or filters.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all filters" })
    ).toBeInTheDocument();
  });

  it("clear filters button resets both search and category", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const utilityButton = screen.getByRole("checkbox", { name: "utility" });
    fireEvent.click(utilityButton);

    const input = screen.getByLabelText("Search contract templates");
    fireEvent.change(input, { target: { value: "gibberish" } });
    advanceTimers();

    expect(
      screen.getByText("No templates match your search or filters.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("AMM Pool")).toBeInTheDocument();
  });

  it("announces result count via aria-live", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(
      screen.getByText((content) => content.includes("templates found"))
    ).toBeInTheDocument();
  });

  it("grid has aria-label 'Contract templates'", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Contract templates")
    ).toBeInTheDocument();
  });

  it("filter chips have role='group' and correct aria-label", () => {
    render(<TemplateLibraryGrid />);

    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("aria-label", "Filter by category");
  });

  it("favorites persist to localStorage and reload on mount", async () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(["hello-world"]));

    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      const helloCard = screen.getByRole("article", {
        name: "Template: Hello World",
      });
      expect(helloCard).toBeInTheDocument();
    });

    const helloCard = screen.getByRole("article", {
      name: "Template: Hello World",
    });
    const favButton = within(helloCard).getByRole("button", {
      name: "Remove from favorites",
    });
    expect(favButton).toBeInTheDocument();
  });

  it("toggle favorites updates localStorage", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const helloCard = screen.getByRole("article", {
      name: "Template: Hello World",
    });
    const favButton = within(helloCard).getByRole("button", {
      name: "Add to favorites",
    });
    fireEvent.click(favButton);

    const stored = JSON.parse(
      localStorage.getItem(FAVORITES_KEY) || "[]"
    ) as string[];
    expect(stored).toContain("hello-world");
  });

  it("recent templates update on template selection", async () => {
    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const helloCard = screen.getByRole("article", {
      name: "Template: Hello World",
    });
    fireEvent.click(helloCard);

    const stored = JSON.parse(
      localStorage.getItem(RECENT_KEY) || "[]"
    ) as string[];
    expect(stored).toContain("hello-world");
  });

  it("recent templates capped at 5", async () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(["a", "b", "c", "d", "e"])
    );

    render(<TemplateLibraryGrid />);

    await waitFor(() => {
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    const helloCard = screen.getByRole("article", {
      name: "Template: Hello World",
    });
    fireEvent.click(helloCard);

    const stored = JSON.parse(
      localStorage.getItem(RECENT_KEY) || "[]"
    ) as string[];
    expect(stored).toEqual(["hello-world", "a", "b", "c", "d"]);
    expect(stored.length).toBe(5);
  });

  it("category filter chips show aria-checked state", () => {
    render(<TemplateLibraryGrid />);

    const utilityBtn = screen.getByRole("checkbox", { name: "utility" });
    expect(utilityBtn).toHaveAttribute("aria-checked", "false");

    fireEvent.click(utilityBtn);
    expect(utilityBtn).toHaveAttribute("aria-checked", "true");

    fireEvent.click(utilityBtn);
    expect(utilityBtn).toHaveAttribute("aria-checked", "false");
  });
});
