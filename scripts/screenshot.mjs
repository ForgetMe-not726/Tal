import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = ".impeccable/review";
mkdirSync(OUT, { recursive: true });

const NO_MOTION = `*, *::before, *::after { animation: none !important; transition: none !important; }`;

const browser = await chromium.launch({ channel: "msedge" });

async function snap(page, path, fullPage = false) {
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${path}`, fullPage });
  console.log("saved", path);
}

// 1. 主页（桌面）
const home = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await home.goto(BASE, { waitUntil: "networkidle" });
await snap(home, "desktop-home.png", true);
await home.close();

// 2. 工作台 · 空态（桌面）
const wb = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await wb.goto(`${BASE}/workbench`, { waitUntil: "networkidle" });
await snap(wb, "desktop-workbench-empty.png");
await wb.close();

// 3. 工作台 · 已生成两模块（桌面，加高视口）
const filled = await browser.newPage({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2 });
await filled.goto(`${BASE}/workbench`, { waitUntil: "networkidle" });
await filled.getByRole("button", { name: /Let's explore/ }).click();
await filled.waitForTimeout(1600);
await filled.getByRole("button", { name: /Let's say/ }).click();
await filled.waitForTimeout(1600);
await snap(filled, "desktop-workbench-filled.png");
await filled.close();

// 4. 主页（移动）
const mhome = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mhome.goto(BASE, { waitUntil: "networkidle" });
await snap(mhome, "mobile-home.png", true);
await mhome.close();

await browser.close();
console.log("done");
