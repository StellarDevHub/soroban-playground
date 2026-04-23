import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soroban Playground",
  description: "Build, compile, deploy, and test Soroban smart contracts from one browser workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
