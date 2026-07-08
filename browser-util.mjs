/**
 * 浏览器自动化工具 - B2B 采购商采集辅助
 * 适用于 Playwright + Chromium
 *
 * 用法示例:
 *   import { launchBrowser, searchGoogle, searchLinkedIn } from "./browser-util.mjs";
 */

import { chromium } from "playwright";

/** 启动浏览器（可选择有头/无头模式） */
export async function launchBrowser(headless = true) {
  return await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
}

/** 创建新页面（带反检测设置） */
export async function newPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  });
  // 反自动化检测
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  return page;
}

/** Google 搜索指定关键词，返回搜索结果链接列表 */
export async function searchGoogle(page, keyword, maxResults = 20) {
  await page.goto("https://www.google.com", { waitUntil: "networkidle" });
  await page.locator("textarea[name=q]").fill(keyword);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const links = [];
  const results = page.locator("a[jsname] h3");
  const count = Math.min(maxResults, await results.count());
  for (let i = 0; i < count; i++) {
    const parentLink = results.nth(i).locator("..");
    const href = await parentLink.getAttribute("href");
    if (href) links.push(href);
  }
  return links;
}

/** 截图整个页面 */
export async function screenshot(page, name) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`  📸 截图保存: screenshots/${name}.png`);
}

/** 在页面中查找文本是否存在 */
export async function hasText(page, text) {
  return await page.locator(`text=${text}`).count() > 0;
}

/** 等待并点击元素 */
export async function clickAndWait(page, selector, waitMs = 1000) {
  await page.locator(selector).first().waitFor({ timeout: 5000 });
  await page.locator(selector).first().click();
  await page.waitForTimeout(waitMs);
}

console.log("✅ browser-util.mjs 模块已加载");
