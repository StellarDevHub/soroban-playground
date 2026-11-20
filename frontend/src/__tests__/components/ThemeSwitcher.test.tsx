import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ThemeSwitcher from "../../components/ThemeSwitcher";
import ThemeProvider from "../../components/providers/ThemeProvider";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "../../lib/theme/engine";

jest.mock("lucide-react", () => ({
  Sun: (props: Record<string, unknown>) => <svg data-icon="sun" {...props} />,
  Moon: (props: Record<string, unknown>) => <svg data-icon="moon" {...props} />,
  Contrast: (props: Record<string, unknown>) => (
    <svg data-icon="contrast" {...props} />
  ),
  Monitor: (props: Record<string, unknown>) => (
    <svg data-icon="monitor" {...props} />
  ),
}));

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
}

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  it("renders one control per theme preference", () => {
    renderSwitcher();

    expect(screen.getByTestId("theme-switcher")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /light theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dark theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /high contrast theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /system theme/i }),
    ).toBeInTheDocument();
  });

  it("exposes the switcher as a labelled group", () => {
    renderSwitcher();
    expect(
      screen.getByRole("group", { name: /colour theme/i }),
    ).toBeInTheDocument();
  });

  it("marks at most one option as pressed after mount", async () => {
    renderSwitcher();

    await waitFor(() => {
      const pressed = screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true");
      expect(pressed.length).toBeLessThanOrEqual(1);
    });
  });

  it("applies and persists the chosen theme", async () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: /light theme/i }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(
        "light",
      );
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("marks the selected option as pressed", async () => {
    renderSwitcher();

    const dark = screen.getByRole("button", { name: /dark theme/i });
    fireEvent.click(dark);

    await waitFor(() => expect(dark).toHaveAttribute("aria-pressed", "true"));
  });

  it("falls back to the system preference when asked", async () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: /system theme/i }));

    await waitFor(() =>
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system"),
    );
  });

  it("applies and persists high contrast theme", async () => {
    renderSwitcher();

    fireEvent.click(
      screen.getByRole("button", { name: /high contrast theme/i }),
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(
        "high-contrast",
      );
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
      "high-contrast",
    );
  });
});
