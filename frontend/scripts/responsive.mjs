// Responsive sweep — home + markets at in-between widths to catch layout glitches.
// Usage: node scripts/responsive.mjs
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = 5198;
const outDir = "screenshots/responsive";
mkdirSync(outDir, { recursive: true });
const WIDTHS = [480, 560, 640, 700, 768, 900, 1024];

const server = await createServer({ server: { port: PORT, strictPort: true } });
await server.listen();
const url = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ headless: true });
const issues = [];

for (const w of WIDTHS) {
  for (const view of ["home", "markets"]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => {
        localStorage.setItem("ptac-theme", "midnight");
        localStorage.setItem("ptac-prefs", JSON.stringify({ onboardingDone: true, haptics: false, sounds: false, reduceMotion: false, endingAlerts: false, alertThresholdHrs: 24 }));
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
      if (view === "markets") {
        const bn = page.locator(".bottom-nav button", { hasText: "Markets" }).first();
        const nt = page.locator(".nav-tabs button", { hasText: "Markets" }).first();
        if (await bn.isVisible().catch(() => false)) await bn.click().catch(() => {});
        else await nt.click().catch(() => {});
        await page.waitForTimeout(700);
      }
      // Detect horizontal overflow of the document (a classic in-between glitch)
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: de.scrollWidth - de.clientWidth };
      });
      if (overflow.over > 2) issues.push(`${view}@${w}: horizontal overflow ${overflow.over}px (scrollW ${overflow.scrollW} > clientW ${overflow.clientW})`);
      await page.screenshot({ path: `${outDir}/${view}-${w}.png`, fullPage: false });
      console.log(`shot ${view}@${w}  overflow=${overflow.over}px`);
    } catch (e) {
      issues.push(`${view}@${w}: FAIL ${e.message}`);
    }
    await page.close();
  }
}
await browser.close();
await server.close();
console.log("\n" + (issues.length ? "ISSUES:\n" + issues.join("\n") : "No horizontal-overflow issues detected."));
