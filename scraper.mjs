import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "exports");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

// ========== 配置 ==========
const CONFIG = {
  resultsPerQuery: 10,
  maxPages: 3,
  visitDelay: { min: 2000, max: 4000 },
  pageDelay: { min: 3000, max: 5000 },
  maxVisits: 30,
  pageTimeout: 15000,
};

// ========== 采购商搜索词库 ==========
const BUYER_TERMS = {
  English: ["small wholesaler", "wholesale buyer", "small distributor", "independent retailer", "boutique buyer", "online store owner", "reseller"],
  French: ["petit grossiste", "acheteur grossiste", "distributeur local"],
  Spanish: ["pequeno mayorista", "comprador mayorista", "distribuidor pequeno"],
  German: ["kleinhandler", "großhandler", "einkaufer", "fachhandler"],
};

const COUNTRY_DOMAIN = {
  "United States": "google.com",
  "Germany": "google.de",
  "United Kingdom": "google.co.uk",
  "Canada": "google.ca",
  "Australia": "google.com.au",
  "France": "google.fr",
  "Spain": "google.es",
  "Netherlands": "google.nl",
  "Italy": "google.it",
  "Brazil": "google.com.br",
  "UAE": "google.ae",
  "Japan": "google.co.jp",
  "Global": "google.com",
};

// ========== 工具函数 ==========

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function extractEmails(text) {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(regex) || [])];
}

function extractPhones(text) {
  const regex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,9}/g;
  const raw = text.match(regex) || [];
  return [...new Set(raw.filter((p) => p.replace(/\D/g, "").length >= 7))];
}

function extractSocialLinks(text) {
  const socials = [];
  const patterns = [
    { name: "Facebook", regex: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/g },
    { name: "LinkedIn", regex: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9-]+/g },
    { name: "Instagram", regex: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/g },
  ];
  for (const p of patterns) {
    const matches = text.match(p.regex);
    if (matches) socials.push(...matches.map((m) => ({ name: p.name, url: m })));
  }
  return socials;
}

function escapeCsv(str) {
  if (!str) return '""';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
}

// ========== 核心抓取逻辑 ==========

class B2BScraper {
  constructor(options = {}) {
    this.results = [];
    this.visited = new Set();
    this.options = { ...CONFIG, ...options };
  }

  async init() {
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    });
    console.log("🌐 浏览器已启动");
  }

  async createPage() {
    const page = await this.browser.newPage({
      viewport: { width: 1440 + randomDelay(0, 100), height: 900 + randomDelay(0, 50) },
      userAgent: [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      ][Math.floor(Math.random() * 2)],
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    return page;
  }

  async searchGoogle(product, market, buyerTerm) {
    const domain = COUNTRY_DOMAIN[market] || "google.com";
    const query = `"${product}" "${buyerTerm}" ${market}`;
    const page = await this.createPage();
    console.log(`\n🔍 搜索: ${query}`);
    const collectedUrls = [];

    for (let pageNum = 0; pageNum < this.options.maxPages; pageNum++) {
      const start = pageNum * 10;
      const url = `https://${domain}/search?q=${encodeURIComponent(query)}&start=${start}&num=10`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: this.options.pageTimeout });
        await page.waitForTimeout(randomDelay(1000, 2000));
        try {
          const btn = page.locator("button:has-text('Reject all'), button:has-text('Accept all')").first();
          if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await page.waitForTimeout(500); }
        } catch {}

        const links = await page.evaluate(() => {
          const results = [];
          document.querySelectorAll("a[href^='http']").forEach((a) => {
            const href = a.href;
            if (href && !href.includes("google.com") && !href.includes("youtube.com")) results.push(href);
          });
          return [...new Set(results)];
        });
        const newLinks = links.filter((l) => !this.visited.has(l));
        collectedUrls.push(...newLinks);
        console.log(`   第 ${pageNum + 1} 页: 找到 ${newLinks.length} 个新结果`);

        const hasNext = await page.locator("a#pnnext").first().isVisible().catch(() => false);
        if (!hasNext) break;
        await page.waitForTimeout(randomDelay(this.options.pageDelay.min, this.options.pageDelay.max));
      } catch (err) {
        console.log(`   ⚠️ 第 ${pageNum + 1} 页搜索失败: ${err.message}`);
        break;
      }
    }

    await page.close();
    console.log(`   共收集 ${collectedUrls.length} 个潜在客户网站`);
    return collectedUrls;
  }

  async visitWebsite(url) {
    if (this.visited.has(url) || this.results.length >= this.options.maxVisits) return null;
    this.visited.add(url);

    const page = await this.createPage();
    const siteData = {
      sourceUrl: url,
      domain: "",
      companyName: "",
      emails: [],
      phones: [],
      socialLinks: [],
      contactPage: "",
      visitedAt: new Date().toISOString(),
    };

    try {
      try { siteData.domain = new URL(url).hostname; } catch {}
      console.log(`   📄 访问: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.options.pageTimeout });
      await page.waitForTimeout(randomDelay(1500, 3000));

      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      const htmlContent = await page.evaluate(() => document.documentElement?.outerHTML || "");
      siteData.companyName = await page.title().catch(() => "");

      siteData.emails = extractEmails(htmlContent + " " + bodyText);
      siteData.phones = extractPhones(bodyText);
      siteData.socialLinks = extractSocialLinks(htmlContent);

      if (siteData.emails.length > 0) console.log(`      📧 邮箱: ${siteData.emails.join(", ")}`);
      if (siteData.phones.length > 0) console.log(`      📞 电话: ${siteData.phones.slice(0, 3).join(", ")}`);

      // 首页没找到邮箱则找联系页面
      if (siteData.emails.length === 0) {
        const contactLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("a[href]"))
            .map((a) => a.href)
            .filter((href) => /contact|about/i.test(href))
            .slice(0, 3);
        });
        for (const contactUrl of contactLinks) {
          if (!contactUrl || contactUrl.startsWith("javascript:")) continue;
          try {
            siteData.contactPage = contactUrl;
            await page.goto(contactUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
            await page.waitForTimeout(1000);
            const ct = await page.evaluate(() => document.body?.innerText || "");
            const ch = await page.evaluate(() => document.documentElement?.outerHTML || "");
            const more = extractEmails(ch + " " + ct);
            siteData.emails = [...new Set([...siteData.emails, ...more])];
            siteData.phones = [...new Set([...siteData.phones, ...extractPhones(ct)])];
            if (more.length > 0) { console.log(`      📧 联系页邮箱: ${more.join(", ")}`); break; }
          } catch {}
        }
      }

      this.results.push(siteData);
    } catch (err) {
      console.log(`      ⚠️ 访问失败: ${err.message}`);
      this.results.push(siteData);
    } finally {
      await page.close();
    }

    await new Promise((r) => setTimeout(r, randomDelay(this.options.visitDelay.min, this.options.visitDelay.max)));
    return siteData;
  }

  async run(product, market, buyerTerm) {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 B2B 采购商数据抓取开始");
    console.log("=".repeat(60));
    console.log(`📦 产品: ${product}`);
    console.log(`🌍 市场: ${market}`);
    console.log(`👤 采购商类型: ${buyerTerm}`);
    console.log("=".repeat(60));

    const urls = await this.searchGoogle(product, market, buyerTerm);
    if (urls.length === 0) {
      console.log("\n❌ 未找到任何结果");
      return this.summary();
    }

    console.log(`\n📥 开始访问 ${Math.min(urls.length, this.options.maxVisits)} 个网站...`);
    let count = 0;
    for (const url of urls) {
      if (count >= this.options.maxVisits) break;
      await this.visitWebsite(url);
      count++;
    }
    return this.summary();
  }

  summary() {
    const hasEmail = this.results.filter((r) => r.emails.length > 0);
    const hasPhone = this.results.filter((r) => r.phones.length > 0);
    const hasSocial = this.results.filter((r) => r.socialLinks.length > 0);
    console.log("\n" + "=".repeat(60));
    console.log("📊 采集结果统计");
    console.log("=".repeat(60));
    console.log(`   总访问网站: ${this.results.length}`);
    console.log(`   找到邮箱: ${hasEmail.length} 个`);
    console.log(`   找到电话: ${hasPhone.length} 个`);
    console.log(`   找到社交账号: ${hasSocial.length} 个`);
    console.log("=".repeat(60) + "\n");
    return { total: this.results.length, withEmail: hasEmail.length, withPhone: hasPhone.length, withSocial: hasSocial.length, results: this.results };
  }

  exportCSV(filename = "") {
    if (this.results.length === 0) { console.log("⚠️ 没有数据可导出"); return; }
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const name = filename || `b2b_leads_${dateStr}`;
    const filePath = path.join(OUTPUT_DIR, `${name}.csv`);
    const header = "公司名称,网站域名,来源URL,邮箱,电话,Facebook,LinkedIn,Instagram,联系页,抓取时间";
    const rows = this.results.map((r) => {
      return [
        escapeCsv(r.companyName),
        escapeCsv(r.domain),
        escapeCsv(r.sourceUrl),
        escapeCsv(r.emails.join("; ")),
        escapeCsv(r.phones.join("; ")),
        escapeCsv(r.socialLinks.filter((s) => s.name === "Facebook").map((s) => s.url).join("; ")),
        escapeCsv(r.socialLinks.filter((s) => s.name === "LinkedIn").map((s) => s.url).join("; ")),
        escapeCsv(r.socialLinks.filter((s) => s.name === "Instagram").map((s) => s.url).join("; ")),
        escapeCsv(r.contactPage),
        escapeCsv(r.visitedAt),
      ].join(",");
    });
    const csv = "\ufeff" + header + "\n" + rows.join("\n");
    fs.writeFileSync(filePath, csv, "utf-8");
    console.log(`✅ CSV 已导出: ${filePath}`);
    return filePath;
  }

  async close() {
    if (this.browser) await this.browser.close();
    console.log("👋 浏览器已关闭");
  }
}

// ========== 导出 ==========
export { B2BScraper, BUYER_TERMS, COUNTRY_DOMAIN };

// ========== CLI 入口（仅当直接运行时）==========
const isDirectRun = process.argv[1] && (process.argv[1].endsWith("scraper.mjs") || process.argv[1].endsWith("scraper"));
if (isDirectRun) {
  main();
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--product": options.product = args[++i]; break;
      case "--market": options.market = args[++i]; break;
      case "--buyer": options.buyer = args[++i]; break;
      case "--lang": options.language = args[++i]; break;
      case "--headless": options.headless = true; break;
      case "--headed": options.headless = false; break;
      case "--max": options.maxVisits = parseInt(args[++i]); break;
      case "--pages": options.maxPages = parseInt(args[++i]); break;
      case "--export": options.exportFile = args[++i]; break;
      case "--help":
        console.log("用法: node scraper.mjs --product <词> [选项]");
        console.log("  --product <词>   产品关键词 (必填)    例: \"hair dryer\"");
        console.log("  --market <国家>  目标市场 (可选)      例: \"United States\" (默认)");
        console.log("  --buyer <类型>   采购商类型 (可选)    例: \"wholesale buyer\" (默认)");
        console.log("  --headless       无头模式 (默认)");
        console.log("  --headed         有头模式");
        console.log("  --max <数字>     最大采集数 (默认 30)");
        console.log("  --pages <数字>   搜索页数 (默认 3)");
        console.log("  --export <名>    导出文件名 (可选)");
        return;
    }
  }
  if (!options.product) {
    console.log("请指定产品关键词: node scraper.mjs --product \"hair dryer\"");
    return;
  }
  options.market = options.market || "United States";
  options.buyer = options.buyer || "wholesale buyer";

  const scraper = new B2BScraper({
    headless: options.headless !== false,
    maxVisits: options.maxVisits || CONFIG.maxVisits,
    maxPages: options.maxPages || CONFIG.maxPages,
  });
  try {
    await scraper.init();
    const result = await scraper.run(options.product, options.market, options.buyer);
    if (result.total > 0) scraper.exportCSV(options.exportFile);
    await scraper.close();
  } catch (err) {
    console.error("\n❌ 出错:", err.message);
    try { await scraper.close(); } catch {}
    process.exit(1);
  }
}
