// Temp: verify the live production URLs in a real browser.
import { chromium } from "playwright";

const PASS = "0gzCuLl-7itUgmQLm67AratD";
const browser = await chromium.launch({ headless: true });

async function check(label, url, creds) {
  const ctx = await browser.newContext(creds ? { httpCredentials: { username: "tacadmin", password: PASS } } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1200);
  const skip = page.locator(".onboard-actions .btn-ghost").first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
  await page.waitForTimeout(400);
  const adminTab = await page.locator(".nav-tabs .admin-tab").count();
  const adminSection = await page.locator("section.admin").count();
  const brand = await page.locator(".brand-name").count();
  console.log(`${label}: http=${resp.status()} brand=${brand} adminTab=${adminTab} adminSectionVisible=${adminSection} errors=${errors.length}`);
  if (errors.length) errors.slice(0, 3).forEach((e) => console.log("   err:", e));
  await ctx.close();
}

await check("PUBLIC  tac.chaty.lol", "https://tac.chaty.lol/", false);
await check("ADMIN   tac-admin.chaty.lol", "https://tac-admin.chaty.lol/", true);
await browser.close();
console.log("DONE");
