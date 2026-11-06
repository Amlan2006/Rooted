import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { Promises } from "@/components/sections/promises";
import { Product } from "@/components/sections/product";
import { Tape } from "@/components/sections/tape";
import { How } from "@/components/sections/how";
import { Terminal } from "@/components/sections/terminal";
import { Pricing } from "@/components/sections/pricing";
import { Faq } from "@/components/sections/faq";
import { RenderAhead } from "@/components/ui/render-ahead";
import { links } from "@/lib/data";

export default function Home() {
  return (
    <>
      <Nav links={{ github: links.github, docs: links.docs, dashboard: links.dashboard }} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Promises />
        <Product />
        <Tape />
        <How />
        <Terminal />
        <Pricing />
        <Faq />
      </main>
      <Footer />
      <RenderAhead />
    </>
  );
}
