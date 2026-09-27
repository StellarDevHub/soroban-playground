import type { Metadata } from "next";
import "./globals.css";
import { GraphQLProvider } from "../components/providers/GraphQLProvider";
import { WalletProvider } from "../components/providers/WalletProvider";
import SidebarShell from "../components/Sidebar";
import RenderWarningModal from "../components/RenderWarningModal";
import OnboardingTour from "../components/onboarding/OnboardingTour";

export const metadata: Metadata = {
  title: "Stellar Soroban Playground",
  description:
    "Interactive command desk suite and Monaco editor playground for compiling, deploying, and invoking smart contracts on Stellar Testnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#060c18] text-[#e6edf7] antialiased" suppressHydrationWarning>
        <WalletProvider>
          <GraphQLProvider>
            <SidebarShell>
              <RenderWarningModal />
              <OnboardingTour />
              {children}
            </SidebarShell>
          </GraphQLProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
