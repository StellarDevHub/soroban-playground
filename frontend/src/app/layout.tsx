import type { Metadata } from "next";
import "./globals.css";
import { GraphQLProvider } from "../components/providers/GraphQLProvider";

export const metadata: Metadata = {
  title: "Synthetic Assets Desk | Soroban Playground",
  description:
    "Monitor oracle prices, collateral health, leveraged trades, and Freighter wallet status for the synthetic-assets Soroban contract.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <GraphQLProvider>
          {children}
        </GraphQLProvider>
      </body>
    </html>
  );
}
