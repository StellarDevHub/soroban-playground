import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/navigation (the root tree now always mounts the Spotlight
// palette, #1725, which uses the router and the pathname).
jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock wallet hook used by Sidebar
jest.mock("@/hooks/useFreighterWallet", () => ({
  useFreighterWallet: () => ({
    status: "disconnected",
    address: null,
    network: "TEST",
    connect: jest.fn(),
  }),
}));

// #1540 — ThemeBootstrapScript is an async server component that reads the
// request headers for the CSP nonce, neither of which exists under jsdom.
// Mocked via the same relative specifier the layout uses. The stand-in is a
// <div> rather than a <script> because React 19 hoists scripts to
// document.head, which is outside the container `render` queries.
jest.mock("../../components/ThemeBootstrapScript", () => ({
  __esModule: true,
  default: () => <div data-testid="theme-bootstrap" />,
}));

import RootLayout from "@/app/layout";

describe("RootLayout (Dashboard Layout)", () => {
  it("renders children and the sidebar brand", () => {
    render(
      // @ts-ignore - Next layout typing in tests
      <RootLayout>
        <div>child-content</div>
      </RootLayout>,
    );

    expect(screen.getByText("child-content")).toBeInTheDocument();
    expect(screen.getAllByText(/Soroban Play/i)[0]).toBeInTheDocument();
  });
});
