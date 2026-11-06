// One-off headless capture of the dashboard Private RPC tab (Nox worker read).
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.HOME + "/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const console_ = [];
page.on("console", (m) => console_.push(`[${new Date().toISOString()}] ${m.type()}: ${m.text()}`));
const started = new Date().toISOString();
await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Connect", exact: true }).click();
const connectClicked = new Date().toISOString();
let status = "unknown";
try {
  await page.waitForFunction(() => /Nox ready; destination chain verified through worker/.test(document.body.innerText) || /\bfailed\b/.test(document.body.innerText), null, { timeout: 120000 });
  status = (await page.locator("body").innerText()).includes("Nox ready; destination chain verified through worker") ? "ready" : "failed";
} catch { status = "timeout"; }
let readStatus = "not_run";
if (status === "ready") {
  await page.getByRole("button", { name: /Run read/ }).click();
  try {
    await page.waitForSelector("pre", { timeout: 120000 });
    readStatus = "result_shown";
  } catch { readStatus = "timeout"; }
}
const finished = new Date().toISOString();
await page.screenshot({ path: out + "/browser-proof.png", fullPage: true });
const text = await page.locator("main").innerText().catch(() => page.locator("body").innerText());
writeFileSync(out + "/browser-state.txt", [
  `capture: headless chromium (chrome-headless-shell build 1243) driven by playwright-core 1.65.0`,
  `page: ${url}`,
  `started_at_utc: ${started}`,
  `connect_clicked_at_utc: ${connectClicked}`,
  `finished_at_utc: ${finished}`,
  `transport_status: ${status}`,
  `read_status: ${readStatus}`,
  "",
  "--- page text ---",
  text,
  "",
  "--- browser console ---",
  ...console_,
  "",
].join("\n"));
await browser.close();
console.log(JSON.stringify({ status, readStatus, started, finished }));
