import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GraphQLProvider } from "../components/providers/GraphQLProvider";
import { WalletProvider } from "../components/providers/WalletProvider";
import { ThemeProvider } from "../components/providers/ThemeProvider";
import { OfflineProvider } from "../components/providers/OfflineProvider";
import { WorkspaceProvider } from "../components/providers/WorkspaceProvider";
import { CommandPaletteProvider } from "../components/providers/CommandPaletteProvider";
import ServiceWorkerRegistrar from "../components/ServiceWorkerRegistrar";
import OfflineStatusBar from "../components/OfflineStatusBar";
import { THEME_BOOTSTRAP_SCRIPT } from "../lib/theme/engine";
import SidebarShell from "../components/Sidebar";
import RenderWarningModal from "../components/RenderWarningModal";
import OnboardingTour from "../components/onboarding/OnboardingTour";

export const metadata: Metadata = {
  title: "Stellar Soroban Playground",
  description:
    "Interactive command desk suite and Monaco editor playground for compiling, deploying, and invoking smart contracts on Stellar Testnet.",
  manifest: "/manifest.webmanifest",
  applicationName: "Stellar Soroban Playground",
  appleWebApp: { capable: true, title: "Soroban Playground", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/*
          Resolve the stored / OS theme before first paint so a returning visitor
          never sees a flash of the default palette.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <WalletProvider>
            <GraphQLProvider>
              {/*
                #1525 — connectivity detection, the durable outbox and the
                conflict engine. Must sit above anything that can enqueue work,
                so it wraps the whole shell rather than living inside it.
              */}
              <OfflineProvider>
                {/* #1526 — one workspace snapshot for the whole shell. */}
                <WorkspaceProvider>
                  {/* #1527 — binds Cmd/Ctrl+K and renders the palette once. */}
                  <CommandPaletteProvider>
                    <SidebarShell>
                      <RenderWarningModal />
                      <OnboardingTour />
                      {children}
                      <OfflineStatusBar />
                    </SidebarShell>
                  </CommandPaletteProvider>
                  {/* Must live inside OfflineProvider: it drains the outbox. */}
                  <ServiceWorkerRegistrar />
                </WorkspaceProvider>
              </OfflineProvider>
            </GraphQLProvider>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
