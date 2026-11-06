import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Rooted — Ethereum observatory",
  description:
    "Inspect payload delivery, frame transactions, and execution state dependencies with explicit evidence coverage.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
