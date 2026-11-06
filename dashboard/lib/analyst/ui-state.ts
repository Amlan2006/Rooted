import type { AnalystEvent, Evidence } from "./types";

type Failure = Extract<AnalystEvent, { type: "error" }>;
type Done = Extract<AnalystEvent, { type: "done" }>;
export type Step = Extract<AnalystEvent, { type: "step" }> & { result?: Extract<AnalystEvent, { type: "step_done" }> };
export type AnalystView = {
  status: "idle" | "running" | "done" | "error";
  question: string;
  session_id?: string;
  steps: Step[];
  thinking: string; // the latest run of summarized thinking
  answer: string;
  evidence: Record<string, Evidence>;
  usage?: Done["usage"];
  error?: Failure;
  last?: UIEvent["type"];
};
// "ask" starts a question (keeping the session), "reset" drops the session, "closed" is the end of the HTTP stream.
export type UIEvent = AnalystEvent | { type: "ask"; question: string } | { type: "reset" } | { type: "closed" };

export const idle: AnalystView = { status: "idle", question: "", steps: [], thinking: "", answer: "", evidence: {} };
const byId = (items: Evidence[]) => Object.fromEntries(items.map(e => [e.id, e]));

export function reduce(s: AnalystView, e: UIEvent): AnalystView {
  return { ...apply(s, e), last: e.type };
}

function apply(s: AnalystView, e: UIEvent): AnalystView {
  if (e.type === "ask") return { ...idle, status: "running", question: e.question, session_id: s.session_id };
  if (e.type === "reset") return idle;
  if (s.status !== "running") return s; // nothing after done or error changes the view
  switch (e.type) {
    case "session": return { ...s, session_id: e.session_id };
    // Consecutive thinking events extend one run; thinking after a step or text starts a new one.
    case "thinking": return { ...s, thinking: s.last === "thinking" ? s.thinking + e.text : e.text };
    case "step": return { ...s, steps: [...s.steps, e] };
    case "step_done": return {
      ...s,
      steps: s.steps.map(step => (step.id === e.id ? { ...step, result: e } : step)),
      evidence: e.evidence ? { ...s.evidence, [e.evidence.id]: e.evidence } : s.evidence,
    };
    case "text": return { ...s, answer: s.answer + e.delta };
    case "done": return { ...s, status: "done", answer: e.answer || s.answer, evidence: { ...s.evidence, ...byId(e.evidence) }, usage: e.usage };
    case "error": return { ...s, status: "error", error: e };
    case "closed": return { ...s, status: "error", error: { type: "error", code: "upstream", message: "The stream ended before the investigation finished." } };
  }
  return s;
}

// Splits complete `data: <json>\n\n` frames off an SSE buffer; the unfinished tail is returned as rest.
export function parseSSE(buffer: string): { events: AnalystEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events = frames.flatMap(frame => {
    const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5)).join("\n");
    return data.trim() ? [JSON.parse(data) as AnalystEvent] : [];
  });
  return { events, rest };
}

const codes: Failure["code"][] = ["disabled", "budget", "refusal", "max_steps", "upstream", "bad_request"];
// A non-SSE response (busy, malformed request, proxy failure) becomes one error event.
export function httpFailure(status: number, body: unknown): Failure {
  const b = body as { type?: string; code?: string; message?: string; error?: { code?: string; message?: string } } | null;
  const err = b?.type === "error" ? b : b?.error;
  const code = codes.find(c => c === err?.code) ?? (status >= 400 && status < 429 ? "bad_request" : "upstream");
  const message = err?.message || (status === 429 ? "Another investigation is running on this server. Try again when it finishes." : `Analyst HTTP ${status}`);
  return { type: "error", code, message };
}

// "[E3]" and "[E1, E4]" become citation segments; everything else stays text.
export function citations(text: string): (string | { cite: string })[] {
  return text.split(/(\[E\d+(?:\s*,\s*E\d+)*\])/).flatMap((part, i): (string | { cite: string })[] =>
    i % 2 ? part.slice(1, -1).split(/\s*,\s*/).map(cite => ({ cite })) : part ? [part] : []);
}

// Evidence and briefs come back from the backend: only https and same-origin paths become links.
export const safeLink = (link?: string) => (link && /^(https:\/\/|\/(?!\/))/.test(link) ? link : undefined);

// Brief evidence is stored as raw JSON by the backend; drop items the drawer cannot show.
export const evidenceList = (items: unknown): Evidence[] => Array.isArray(items)
  ? items.filter((e): e is Evidence => ["id", "kind", "label", "sha256"].every(k => typeof e?.[k] === "string"))
  : [];

export const firstLines = (text: string, n = 2) => text.split("\n").map(line => line.trim()).filter(Boolean).slice(0, n);
