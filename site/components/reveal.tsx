import type { CSSProperties, ElementType, ReactNode } from "react";

/*
 * Scroll reveals without JavaScript components: these render plain elements with data attributes, and the small
 * inline script in app/layout.tsx (REVEAL_SCRIPT) marks them data-shown as they enter the viewport; globals.css does
 * the 8 px rise and fade (0.5 s, the site ease). Nothing waits for hydration, so a deep link (/#pricing) shows its
 * content at first paint. Without JS, or under reduced motion, everything is simply visible.
 */

type Tag = "div" | "section" | "ul" | "ol" | "li" | "span" | "p";
type Props = { children: ReactNode; as?: Tag; className?: string };

/** 8 px rise + fade, once, when it is above the bottom fifth of the viewport. */
export function Reveal({ children, as = "div", delay = 0, className }: Props & { delay?: number }) {
  const T = as as ElementType;
  return (
    <T data-reveal="" className={className} style={delay ? ({ "--d": `${delay}s` } as CSSProperties) : undefined}>
      {children}
    </T>
  );
}

/** Reveals its <StaggerItem> descendants in document order, `gap` seconds apart, as the group enters view. */
export function Stagger({ children, as = "div", gap = 0.06, className }: Props & { gap?: number }) {
  const T = as as ElementType;
  return (
    <T data-stagger={gap} className={className}>
      {children}
    </T>
  );
}

export function StaggerItem({ children, as = "div", className }: Props) {
  const T = as as ElementType;
  return (
    <T data-reveal="" className={className}>
      {children}
    </T>
  );
}

/** A bar fill that grows from its left edge once in view (1.2 s, in step with <CountUp>). */
export function Grow({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span data-grow="" className={className} style={style} />;
}

/** Runs in <head>: marks the page as scripted, then observes reveal targets once the document is parsed. */
export const REVEAL_SCRIPT = `(function(){var d=document.documentElement;if(!("IntersectionObserver"in window))return;d.setAttribute("data-js","");
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var t=e.target;io.unobserve(t);
if(t.hasAttribute("data-stagger")){var g=parseFloat(t.getAttribute("data-stagger"))||0;t.querySelectorAll("[data-reveal]").forEach(function(el,i){el.style.setProperty("--d",(i*g)+"s");el.setAttribute("data-shown","")})}
else t.setAttribute("data-shown","")})},{rootMargin:"0px 0px -20% 0px"});
function scan(){document.querySelectorAll("[data-stagger],[data-reveal],[data-grow]").forEach(function(el){if(el.hasAttribute("data-reveal")&&el.parentElement.closest("[data-stagger]"))return;io.observe(el)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",scan);else scan()})();`;
