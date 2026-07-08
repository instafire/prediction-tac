import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ptac-prefs", JSON.stringify({
    onboardingDone: true, haptics: true, sounds: false, reduceMotion: false, endingAlerts: false, alertThresholdHrs: 24,
  }));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator('button[title="Settings"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: "screenshots/features-settings.png", fullPage: false });
await browser.close();
console.log("settings ok");
