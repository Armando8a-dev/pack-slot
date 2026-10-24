import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-num" });

export const metadata: Metadata = {
  title: "PackSlot — 8 numbers in one storage word",
  description: "Inline-assembly demo: eight uint32 values packed into a single 256-bit storage slot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${plex.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
