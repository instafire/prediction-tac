// Visual audit harness — boots vite in-process, screenshots a fixed matrix.
// Usage: node scripts/audit.mjs [before|after]
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] || "before";
const PORT = 5199;
const outDir = `screenshots/${label}`;
mkdirSync(outDir, { recursive: true });

const NAV = { home: "Home", markets: "Markets", vault: "Vault", portfolio: "You", leaderboard: "Rank" };

const MATRIX = [
  { name: "home-desktop-midnight", view: "home", theme: "midnight", w: 1280, h: 900, full: true },
  { name: "home-mobile-midnight", view: "home", theme: "midnight", w: 390, h: 844, full: true },
  { name: "home-desktop-terminal", view: "home", theme: "terminal", w: 1280, h: 900, full: false },
  { name: "home-mobile-degen", view: "home", theme: "degen", w: 390, h: 844, full: false },
  { name: "home-desktop-ledger", view: "home", theme: "ledger", w: 1280, h: 900, full: false },
  { name: "markets-desktop-midnight", view: "markets", theme: "midnight", w: 1280, h: 900, full: true },
  { name: "markets-mobile-midnight", view: "markets", theme: "midnight", w: 390, h: 844, full: false },
  { name: "vault-mobile-midnight", view: "vault", theme: "midnight", w: 390, h: 844, full: true },
  { name: "portfolio-mobile-midnight", view: "portfolio", theme: "midnight", w: 390, h: 844, full: true },
  { name: "leaderboard-desktop-midnight", view: "leaderboard", theme: "midnight", w: 1280, h: 900, full: true },
  { name: "settings-mobile-midnight", view: "settings", theme: "midnight", w: 390, h: 844, full: true },
];

const server = await createServer({ server: { port: PORT, strictPort: true } });
await server.listen();
const url = `http://localhost:${PORT}/`;
console.log("vite up:", url);

const browser = await chromium.launch({ headless: true });
const errors = [];

async function goToView(page, view) {
  if (view === "home") return; // default view
  if (view === "settings") {
    await page.locator('button[title="Settings"]').first().click({ timeout: 5000 }).catch(() => {});
    return;
  }
  const label = NAV[view];
  const bn = page.locator(".bottom-nav button", { hasText: label }).first();
  const nt = page.locator(".nav-tabs button", { hasText: label }).first();
  if (await bn.isVisible().catch(() => false)) await bn.click({ timeout: 5000 }).catch(() => {});
  else await nt.click({ timeout: 5000 }).catch(() => {});
}

for (const s of MATRIX) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${s.name}] console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${s.name}] pageerror: ${e.message}`));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluate((theme) => {
      localStorage.setItem("ptac-theme", theme);
      localStorage.setItem("ptac-prefs", JSON.stringify({
        onboardingDone: true, haptics: false, sounds: false, reduceMotion: false, endingAlerts: false, alertThresholdHrs: 24,
      }));
    }, s.theme);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1400);
    const skip = page.locator(".onboard-actions .btn-ghost").first();
    if (await skip.isVisible().catch(() => false)) { await skip.click().catch(() => {}); await page.waitForTimeout(300); }
    await goToView(page, s.view);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: s.full });
    console.log("shot:", s.name);
  } catch (e) {
    errors.push(`[${s.name}] SHOT FAILED: ${e.message}`);
    console.log("FAIL:", s.name, e.message);
  }
  await page.close();
}

await browser.close();
await server.close();

if (errors.length) {
  console.log("\n===== RUNTIME ISSUES (" + errors.length + ") =====");
  for (const e of errors) console.log(e);
} else {
  console.log("\nNo console/page errors captured.");
}
console.log("DONE:", label);
