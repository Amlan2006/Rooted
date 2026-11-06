import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MotionProvider } from "@/components/motion";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const description =
  "Rooted checks Ethereum Sepolia’s Glamsterdam promises block by block from its own node: ePBS payloads, EIP-7928 block access lists, native Geth replay and the frame-transaction mempool. Open source, MIT.";

export const metadata: Metadata = {
  // Absolute OG/Twitter image URLs need an origin; set NEXT_PUBLIC_SITE_URL at build time for the deployed host.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3011"),
  title: "Rooted · Every Ethereum block, checked",
  description,
  openGraph: { title: "Rooted · Every Ethereum block, checked", description, type: "website", siteName: "Rooted" },
  twitter: { card: "summary_large_image", title: "Rooted · Every Ethereum block, checked", description },
};

export const viewport: Viewport = { themeColor: "#fafaf7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <noscript>
          <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
        </noscript>
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-button focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
