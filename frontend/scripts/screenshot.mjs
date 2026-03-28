#!/usr/bin/env node
// Usage: node scripts/screenshot.mjs [url] [output] [--mobile]
// Default: http://localhost:3000 → /tmp/screenshot.png
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:3000";
const output = process.argv[3] || "/tmp/screenshot.png";
const mobile = process.argv.includes("--mobile");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.screenshot({ path: output, fullPage: false });
await browser.close();
console.log(`→ ${output}`);
