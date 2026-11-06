import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Rooted: every Ethereum block, checked.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export default async function Image() {
  const [serif, serifItalic, mono] = await Promise.all([font("InstrumentSerif-Regular.ttf"), font("InstrumentSerif-Italic.ttf"), font("GeistMono-Regular.ttf")]);
  const label = { fontFamily: "Geist Mono", fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B6B66" } as const;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FAFAF7", color: "#0F0F0E", padding: "64px 72px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", ...label }}>
          <span style={{ color: "#0F0F0E", textTransform: "none", letterSpacing: "-0.01em", fontSize: 30 }}>rooted</span>
          <span>Ethereum Sepolia · Glamsterdam</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", fontFamily: "Instrument Serif", fontSize: 128, lineHeight: 1.02, letterSpacing: "-0.02em", maxWidth: 980 }}>
          <span>Every Ethereum block,&nbsp;</span>
          <span style={{ fontStyle: "italic", color: "#FF5A1F" }}>checked.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #E7E6E1", paddingTop: 28, ...label, textTransform: "none", letterSpacing: "0" }}>
          <span>ePBS payloads · access lists · native replay · frame mempool</span>
          <span>MIT</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Instrument Serif", data: serif, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
        { name: "Geist Mono", data: mono, style: "normal", weight: 400 },
      ],
    },
  );
}
