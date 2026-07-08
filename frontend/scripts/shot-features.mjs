import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);
const skip = page.locator(".onboard-actions .btn-ghost");
if (await skip.isVisible().catch(() => false)) await skip.click();
await page.waitForTimeout(400);
await page.screenshot({ path: "screenshots/features-home.png", fullPage: false });
await page.locator(".bottom-nav button", { hasText: "Markets" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "screenshots/features-markets.png", fullPage: false });
const calcBtn = page.locator('button[title="Odds calculator"]');
if (await calcBtn.isVisible().catch(() => false)) {
  await calcBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "screenshots/features-calc.png", fullPage: false });
}
const settingsBtn = page.locator('button[title="Settings"]');
if (await settingsBtn.isVisible().catch(() => false)) {
  await page.keyboard.press("Escape");
  await settingsBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/features-settings.png", fullPage: false });
}
await browser.close();
console.log("shots ok");
