import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
// The site's local Geist builds (app/fonts/LICENSE.md): the Google-served build opens gaps inside words on hinted Linux and Windows Chrome.
const sans = localFont({ src: "./fonts/Geist-Variable.woff2", weight: "100 900", variable: "--font-geist", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Arial"] });
const mono = localFont({ src: "./fonts/GeistMono-Variable.woff2", weight: "100 900", variable: "--font-geist-mono", display: "swap", fallback: ["ui-monospace", "Menlo", "monospace"] });
export const metadata: Metadata = {
  title: "Rooted — Ethereum observatory",
  description:
    "Inspect payload delivery, frame transactions, and execution state dependencies with explicit evidence coverage.",
};
export const viewport: Viewport = { themeColor: "#08090a", colorScheme: "dark" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
