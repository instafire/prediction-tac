// DOM assertions against the running dev server (http://127.0.0.1:5173).
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ptac-theme", "degen");
  localStorage.setItem("ptac-prefs", JSON.stringify({ onboardingDone: true, haptics: false, sounds: false, reduceMotion: false, endingAlerts: false, alertThresholdHrs: 24 }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1600);

const pulse = await page.locator(".hero-pulse .hp-item").count();
const marquee = await page.locator(".pixlet-strip .px-track").count();
const scrollTop = await page.locator(".scroll-top").count();
// Brand mark stroke should resolve to the degen accent (purple ~ rgb(192,132,252)), not hardcoded mint.
const brandStroke = await page.locator(".brand-logo path").first().evaluate(el => getComputedStyle(el).stroke).catch(() => "n/a");
// P&L stat should NOT have the leaked position-card border (transparent/none), disconnected.
const pnlBorder = await page.locator(".ss-v.pos, .ss-item:last-of-type .ss-v").first().evaluate(el => getComputedStyle(el).borderStyle).catch(() => "n/a");

await page.locator('button[title="Settings"]').first().click().catch(() => {});
await page.waitForTimeout(700);
const toggleW = await page.locator('.set-row input[type="checkbox"]').first().evaluate(el => getComputedStyle(el).width).catch(() => "n/a");
const toggleAppearance = await page.locator('.set-row input[type="checkbox"]').first().evaluate(el => getComputedStyle(el).appearance).catch(() => "n/a");

console.log(JSON.stringify({ theme: "degen", pulse, marquee, scrollTop, brandStroke, pnlBorder, toggleW, toggleAppearance }, null, 2));
await browser.close();
