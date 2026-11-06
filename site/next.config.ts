import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Stop `next dev` from writing an AGENTS.md into the site.
  agentRules: false,
};

export default config;
