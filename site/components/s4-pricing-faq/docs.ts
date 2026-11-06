import { links, meta } from "@/lib/data";

/** GitHub URL of a repo doc, only if the snapshot found it on main. */
export const docUrl = (path: string) => meta.docs.find((d) => d.path === path)?.url;

export const x402Docs = links.doc("docs/X402_HOSTED.md");
