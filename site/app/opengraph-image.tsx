import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Rooted: see inside every Ethereum block.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

// Satori has no CSS masks, so the hero grid is drawn as 1px lines that fade by opacity towards the bottom.
const grid = [
  ...Array.from({ length: 16 }, (_, i) => ({ left: 40 + i * 80, top: 0, width: 1, height: 630 })),
  ...Array.from({ length: 8 }, (_, i) => ({ left: 0, top: i * 80 - 1, width: 1200, height: 1 })),
];

export default async function Image() {
  const [sans, mono] = await Promise.all([font("Geist-SemiBold.ttf"), font("GeistMono-Regular.ttf")]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#08090A", color: "#F4F5F6", padding: "72px 80px 64px", position: "relative" }}>
        {grid.map((g, i) => (
          <div key={i} style={{ position: "absolute", ...g, background: "rgba(255,255,255,0.05)" }} />
        ))}
        <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, background: "linear-gradient(180deg, rgba(8,9,10,0) 0%, rgba(8,9,10,0.6) 45%, #08090A 80%)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: "Geist", fontSize: 32, letterSpacing: -0.6 }}>
          <svg width="40" height="40" viewBox="0 0 64 64">
            <path d="M8 4h32a8 8 0 0 1 0 16H8zM8 24h36a8 8 0 0 1 0 16H8zM28 44h12l16 16H44z" fill="#F4F5F6" />
            <rect x="8" y="44" width="16" height="16" fill="#4BE38F" />
          </svg>
          Rooted
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Geist", fontSize: 108, lineHeight: 0.98, letterSpacing: -5.5 }}>
          <span>See inside every</span>
          {/* nbsp: Satori widens this line's breaking space. */}
          <span style={{ color: "#5B6068" }}>Ethereum{"\u00a0"}block.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "Geist Mono", fontSize: 22, color: "#7D838C" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: "#4BE38F" }} />
            ePBS payloads · access lists · native replay · frame mempool
          </span>
          <span>Sepolia · MIT</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: sans, style: "normal", weight: 600 },
        { name: "Geist Mono", data: mono, style: "normal", weight: 400 },
      ],
    },
  );
}
