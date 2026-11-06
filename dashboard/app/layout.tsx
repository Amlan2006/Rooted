import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
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
