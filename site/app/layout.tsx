import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { MotionProvider } from "@/components/motion";
import { REVEAL_SCRIPT } from "@/components/reveal";
import "./globals.css";

// The official Geist builds (vercel/geist-font, OFL), subset to Latin (assets/fonts/LICENSE.md): the Google-served build opened gaps inside
// words ("bo th", "ET HGlobal") on hinted Linux and Windows Chrome. next/font adds the size-adjusted fallback.
const sans = localFont({ src: "./fonts/Geist-Variable.woff2", weight: "100 900", variable: "--font-geist", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Arial"] });
const mono = localFont({ src: "./fonts/GeistMono-Variable.woff2", weight: "100 900", variable: "--font-geist-mono", display: "swap", fallback: ["ui-monospace", "Menlo", "monospace"] });

const description =
  "Rooted checks Ethereum Sepolia under Glamsterdam against your own node: ePBS payloads, EIP-7928 block access lists, native Geth replay and the frame-transaction mempool. Open source, MIT.";

export const metadata: Metadata = {
  // Absolute OG/Twitter image URLs need an origin; set NEXT_PUBLIC_SITE_URL at build time for the deployed host.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3011"),
  title: "Rooted · See inside every Ethereum block",
  description,
  openGraph: { title: "Rooted · See inside every Ethereum block", description, type: "website", siteName: "Rooted" },
  twitter: { card: "summary_large_image", title: "Rooted · See inside every Ethereum block", description },
};

export const viewport: Viewport = { themeColor: "#08090A", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the reveal script adds data-js to <html> before React hydrates.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-control focus:border focus:border-line-strong focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-raised"
        >
          Skip to content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
