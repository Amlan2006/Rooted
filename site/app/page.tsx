import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { Metrics } from "@/components/sections/metrics";
import { Bento } from "@/components/sections/bento";
import { Analyst } from "@/components/sections/analyst";
import { Tape } from "@/components/sections/tape";
import { How } from "@/components/sections/how";
import { Terminal } from "@/components/sections/terminal";
import { Pricing } from "@/components/sections/pricing";
import { Faq } from "@/components/sections/faq";
import { Cta } from "@/components/sections/cta";
import { RenderAhead } from "@/components/ui/render-ahead";
import { links } from "@/lib/data";

export default function Home() {
  return (
    <>
      <Nav links={{ github: links.github, docs: links.docs, dashboard: links.dashboard }} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Metrics />
        <Bento />
        <Analyst />
        <Tape />
        <How />
        <Terminal />
        <Pricing />
        <Faq />
        <Cta />
      </main>
      <Footer />
      <RenderAhead />
    </>
  );
}
