// Verify the back-to-top button appears after scrolling on the home page.
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = 5197;
mkdirSync("screenshots/verify", { recursive: true });
const server = await createServer({ server: { port: PORT, strictPort: true } });
await server.listen();
const url = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ptac-theme", "midnight");
  localStorage.setItem("ptac-prefs", JSON.stringify({ onboardingDone: true, haptics: false, sounds: false, reduceMotion: false, endingAlerts: false, alertThresholdHrs: 24 }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1400);

const before = await page.locator(".scroll-top").evaluate(el => getComputedStyle(el).opacity).catch(() => "no-el");
await page.evaluate(() => window.scrollTo({ top: 1400, behavior: "instant" }));
await page.waitForTimeout(600);
const after = await page.locator(".scroll-top").evaluate(el => getComputedStyle(el).opacity).catch(() => "no-el");
const hasShow = await page.locator(".scroll-top.show").count();
await page.screenshot({ path: "screenshots/verify/scrolltop.png", fullPage: false });

console.log(`scroll-top opacity before-scroll=${before}  after-scroll=${after}  .show-count=${hasShow}`);
await browser.close();
await server.close();
