import type { Metadata, Viewport } from "next";
import { ScreenReaderAnnouncer } from "@/accessibility/ScreenReaderAnnouncer";
import { SkipNavigation } from "@/accessibility/SkipNavigation";
import "./globals.css";
import { GraphQLProvider } from "../components/providers/GraphQLProvider";
import { WalletProvider } from "../components/providers/WalletProvider";
import { ThemeProvider } from "../components/providers/ThemeProvider";
import { OfflineProvider } from "../components/providers/OfflineProvider";
import { WorkspaceProvider } from "../components/providers/WorkspaceProvider";
import { CommandPaletteProvider } from "../components/providers/CommandPaletteProvider";
import ServiceWorkerRegistrar from "../components/ServiceWorkerRegistrar";
import OfflineStatusBar from "../components/OfflineStatusBar";
import ThemeBootstrapScript from "../components/ThemeBootstrapScript";
import SidebarShell from "../components/Sidebar";
import RenderWarningModal from "../components/RenderWarningModal";
import OnboardingTour from "../components/onboarding/OnboardingTour";
import { ErrorBoundary } from "../components/ErrorBoundary";
import ToastViewport from "../components/ToastViewport";
import PerformanceMonitor from "../components/PerformanceMonitor";

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
        <ThemeBootstrapScript />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        <ScreenReaderAnnouncer />
        <SkipNavigation />
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
                  {/*
                    #1527 / #1725 — renders both palettes once: the Spotlight
                    (Cmd/Ctrl+K) and the classic command search (/).
                  */}
                  <CommandPaletteProvider>
                    <ErrorBoundary level="global">
                      <SidebarShell>
                        <RenderWarningModal />
                        <OnboardingTour />
                        {children}
                        <OfflineStatusBar />
                        {/*
                          #1539 — Core Web Vitals / FPS widget. Opt-in via
                          NEXT_PUBLIC_ENABLE_PERF_MONITOR so it never perturbs
                          the layout-shift score it is reporting in production.
                        */}
                        <PerformanceMonitor
                          enabled={process.env.NEXT_PUBLIC_ENABLE_PERF_MONITOR === "true"}
                        />
                      </SidebarShell>
                    </ErrorBoundary>
                  </CommandPaletteProvider>
                  {/* Must live inside OfflineProvider: it drains the outbox. */}
                  <ServiceWorkerRegistrar />
                </WorkspaceProvider>
              </OfflineProvider>
            </GraphQLProvider>
          </WalletProvider>
        </ThemeProvider>
        <ToastViewport />
      </body>
    </html>
  );
}
