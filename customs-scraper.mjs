/**
 * 海关进出口数据抓取模块
 * 通过 HS 编码和产品关键词搜索真实海外进口商
 *
 * HS 编码参考:
 *   851640  - Hair dryers (吹风机)
 *   8516    - 电热器具大类
 *   851631  - 其他美发器具
 *   950691  - 健身器材
 *
 * 用法:
 *   node customs-scraper.mjs --hs 851640 --product "hair dryer" --market "United States"
 *   node customs-scraper.mjs --product "hair dryer" --market all --deep
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "exports");

// ========== HS 编码数据库 ==========
const HS_CODES = {
  "851640": { name: "Hair dryers", cn: "吹风机", category: "hair care" },
  "851631": { name: "Hair curling irons / tongs", cn: "卷发器/烫发器", category: "hair care" },
  "851632": { name: "Other hair-dressing apparatus", cn: "其他美发器具", category: "hair care" },
  "851679": { name: "Other electro-thermic appliances", cn: "其他电热器具", category: "electronics" },
  "8516":   { name: "Electric heating appliances (broad)", cn: "电热器具大类", category: "electronics" },
};

// ========== 国家/地区海关数据关键词 ==========
const CUSTOMS_SOURCES = {
  "United States": ["US import data", "US customs data", "US import records", "USA importers"],
  "United Kingdom": ["UK import data", "UK customs records", "UK trade data", "British importers"],
  "Germany": ["Germany import data", "German customs", "Zollimport Deutschland", "German importers"],
  "France": ["France customs data", "French import records", "douane francaise", "French importers"],
  "Canada": ["Canada customs data", "Canadian import records", "Canadian importers"],
  "Australia": ["Australia customs records", "Australian trade data", "Australian importers"],
  "UAE": ["UAE customs data", "Dubai import records", "UAE trade data", "Dubai importers"],
  "India": ["India customs data", "Indian import records", "India trade data", "Indian importers"],
  "Brazil": ["Brazil customs data", "Brazilian import records", "Brazil trade data", "Brazilian importers"],
  "Global": ["customs data", "import records", "trade data", "import shipments", "bill of lading"],
};

// ========== 进口商搜索词模板 ==========
function buildSearchQueries(product, hsCode, market) {
  const queries = [];
  const sources = CUSTOMS_SOURCES[market] || CUSTOMS_SOURCES.Global;

  for (const src of sources) {
    if (hsCode) queries.push(`"${product}" "HS ${hsCode}" ${src}`);
    queries.push(`"${product}" importer ${src}`);
    queries.push(`"${product}" "purchase" "import" ${src}`);
    queries.push(`"${product}" "bill of lading" ${src}`);
    queries.push(`"${product}" "container" "shipment" ${src}`);
  }

  // 买家类型搜索
  const buyerTypes = ["buyer", "wholesale buyer", "importer", "distributor", "procurement"];
  for (const bt of buyerTypes) {
    queries.push(`"${product}" "${bt}" "${market}"`);
  }

  return queries;
}

// ========== 随机延时 ==========
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// ========== 进口商数据抓取类 ==========
class CustomsScraper {
  constructor(options = {}) {
    this.importers = [];
    this.visited = new Set();
    this.results = [];
    this.options = {
      headless: true,
      maxQueries: 20,
      maxVisits: 30,
      maxPages: 2,
      ...options,
    };
  }

  async init() {
    this.browser = await chromium.launch({
      headless: this.options.headless,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    });
    console.log("🌐 海关数据抓取引擎启动");
  }

  async createPage() {
    const page = await this.browser.newPage({
      viewport: { width: 1440 + randomDelay(0, 100), height: 900 + randomDelay(0, 50) },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    });
    await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
    return page;
  }

  // ====== 1. Google 搜索进口商 ======
  async searchGoogleForImporters(product, hsCode, market) {
    const queries = buildSearchQueries(product, hsCode, market);
    const usedQueries = queries.slice(0, this.options.maxQueries);
    console.log(`🔍 将执行 ${usedQueries.length} 组海关搜索...`);

    const allUrls = [];
    for (let qi = 0; qi < usedQueries.length; qi++) {
      const query = usedQueries[qi];
      console.log(`   [${qi + 1}/${usedQueries.length}] 搜索: ${query.substring(0, 60)}...`);

      const urls = await this._execSearch(query);
      allUrls.push(...urls);
      console.log(`      找到 ${urls.length} 个结果`);

      // 延时避免被 ban
      await new Promise((r) => setTimeout(r, randomDelay(2000, 4000)));
    }

    // 去重
    const unique = [...new Set(allUrls)];
    console.log(`\n📊 Google 搜索共收集 ${unique.length} 个潜在进口商链接`);
    return unique;
  }

  async _execSearch(query) {
    const page = await this.createPage();
    const urls = [];
    try {
      for (let pn = 0; pn < this.options.maxPages; pn++) {
        const start = pn * 10;
        await page.goto(`https://google.com/search?q=${encodeURIComponent(query)}&start=${start}`, {
          waitUntil: "networkidle", timeout: 15000,
        });
        await page.waitForTimeout(randomDelay(1000, 2000));

        // 拒绝 cookies
        try {
          const btn = page.locator("button:has-text('Reject all'), button:has-text('Accept all')").first();
          if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await page.waitForTimeout(500); }
        } catch {}

        const links = await page.evaluate(() => {
          return [...new Set(
            Array.from(document.querySelectorAll("a[href^='http']"))
              .map(a => a.href)
              .filter(h => !h.includes("google.com") && !h.includes("youtube.com"))
          )];
        });
        urls.push(...links);

        const hasNext = await page.locator("a#pnnext").isVisible().catch(() => false);
        if (!hasNext) break;
        await page.waitForTimeout(randomDelay(2000, 3000));
      }
    } catch {}

    await page.close();
    // 过滤出可能包含进口商信息的域名
    return urls.filter(url => {
      const lower = url.toLowerCase();
      return !lower.includes("wikipedia") && !lower.includes("amazon") &&
             !lower.includes("walmart") && !lower.includes("ebay") &&
             !lower.includes("alibaba") && !lower.includes("aliexpress");
    });
  }

  // ====== 2. 访问网站提取进口商信息 ======
  async visitAndExtract(url) {
    if (this.visited.has(url) || this.results.length >= this.options.maxVisits) return null;
    this.visited.add(url);

    const page = await this.createPage();
    const importer = {
      sourceUrl: url,
      companyName: "",
      domain: "",
      emails: [],
      phones: [],
      address: "",
      country: "",
      socialLinks: [],
      productInterest: this.options.product || "",
      dataSource: "web",
      contacted: false,
      contactedAt: "",
      confidence: 0,
    };

    try {
      try { importer.domain = new URL(url).hostname.replace("www.", ""); } catch {}
      console.log(`   📄 分析: ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(randomDelay(2000, 3000));

      // 提取页面文本
      const text = await page.evaluate(() => document.body?.innerText || "");
      const html = await page.evaluate(() => document.documentElement?.outerHTML || "");
      importer.companyName = await page.title().catch(() => "");

      // 提取邮箱
      importer.emails = [...new Set((html + " " + text).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];

      // 提取电话
      const phones = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,9}/g) || [];
      importer.phones = [...new Set(phones.filter(p => p.replace(/\D/g, "").length >= 7))];

      // 提取地址（含国家关键词）
      const countryPatterns = [
        /(?:Address|Addr\.)[:\s]+([^.!?\n]+)/gi,
        /(?:Located in|Based in|HQ|Headquarters)[:\s]+([^.!?\n]+)/gi,
      ];
      for (const p of countryPatterns) {
        const m = text.match(p);
        if (m) { importer.address = m[0]; break; }
      }

      // 社交链接
      const socials = [];
      const fb = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/g);
      const li = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9-]+/g);
      const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/g);
      if (fb) socials.push(...fb.map(u => ({ name: "Facebook", url: u })));
      if (li) socials.push(...li.map(u => ({ name: "LinkedIn", url: u })));
      if (ig) socials.push(...ig.map(u => ({ name: "Instagram", url: u })));
      importer.socialLinks = socials;

      // 判断是否为进口商的置信度
      importer.confidence = this._calcConfidence(text, html, importer.emails);

      // 如首页没邮箱则找 Contact/About 页
      if (importer.emails.length === 0) {
        const contactLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("a[href]"))
            .map(a => a.href)
            .filter(h => /contact|about|company/i.test(h))
            .slice(0, 3);
        });
        for (const cl of contactLinks) {
          if (!cl || cl.startsWith("javascript:")) continue;
          try {
            await page.goto(cl, { waitUntil: "domcontentloaded", timeout: 10000 });
            await page.waitForTimeout(1000);
            const ct = await page.evaluate(() => document.body?.innerText || "");
            const ch = await page.evaluate(() => document.documentElement?.outerHTML || "");
            const more = [...new Set((ch + " " + ct).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];
            importer.emails = [...new Set([...importer.emails, ...more])];
            if (more.length > 0) {
              const phones2 = ct.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{2,9}/g) || [];
              importer.phones = [...new Set([...importer.phones, ...phones2.filter(p => p.replace(/\D/g, "").length >= 7)])];
              if (importer.address === "") {
                const addrs = ct.match(/(?:Address|Addr\.|Street|Road|Ave)[^.!?\n]+/gi);
                if (addrs) importer.address = addrs[0];
              }
              break;
            }
          } catch {}
        }
      }

      this.results.push(importer);
      if (importer.emails.length > 0) console.log(`      📧 ${importer.emails.join(", ")}`);

    } catch (err) {
      console.log(`      ⚠️ ${err.message.substring(0, 50)}`);
      this.results.push(importer);
    } finally {
      await page.close();
    }

    await new Promise((r) => setTimeout(r, randomDelay(1500, 3000)));
    return importer;
  }

  _calcConfidence(text, html, emails) {
    let score = 0;
    const lower = text.toLowerCase();
    // 进口商相关词汇
    const importerWords = ["importer", "import", "wholesale", "distributor", "buyer", "purchase", "procurement", "retailer", "store", "shop", "trade", "goods", "merchandise", "supplier", "logistics", "warehouse", "container", "shipment"];
    for (const w of importerWords) {
      if (lower.includes(w)) score += 1;
    }
    // 有邮箱加分
    if (emails.length > 0) score += 3;
    // 有商业网站特征
    if (lower.includes("about us") || lower.includes("products") || lower.includes("catalog")) score += 1;
    if (lower.includes("contact") || lower.includes("get in touch")) score += 1;
    return Math.min(Math.round((score / 15) * 100), 95);
  }

  // ====== 3. 执行完整抓取 ======
  async run(product, hsCode = "", market = "Global") {
    console.log("\n" + "=".repeat(60));
    console.log("📦 海关进出口数据抓取");
    console.log("=".repeat(60));
    console.log(`  产品: ${product}`);
    if (hsCode) console.log(`  HS编码: ${hsCode} (${HS_CODES[hsCode]?.name || "未知"})`);
    console.log(`  目标市场: ${market}`);
    console.log("=".repeat(60));

    this.options.product = product;

    // 1. Google 搜索进口商
    const urls = await this.searchGoogleForImporters(product, hsCode, market);
    if (urls.length === 0) {
      console.log("\n⚠️ 未找到进口商数据，请尝试不同的产品词或HS编码");
      return this.summary();
    }

    // 2. 访问并提取信息
    console.log(`\n📥 深度分析 ${Math.min(urls.length, this.options.maxVisits)} 个潜在进口商网站...`);
    let count = 0;
    for (const url of urls) {
      if (count >= this.options.maxVisits) break;
      await this.visitAndExtract(url);
      count++;
    }

    return this.summary();
  }

  summary() {
    const valid = this.results.filter(r => r.emails.length > 0);
    const highConf = this.results.filter(r => r.confidence >= 50);
    console.log("\n" + "=".repeat(60));
    console.log("📊 海关进口商数据采集统计");
    console.log("=".repeat(60));
    console.log(`  访问网站总数: ${this.results.length}`);
    console.log(`  找到邮箱: ${valid.length} 个`);
    console.log(`  高置信度进口商: ${highConf.length} 个`);
    console.log(`  找到电话: ${this.results.filter(r => r.phones.length > 0).length} 个`);
    console.log(`  找到社交账号: ${this.results.filter(r => r.socialLinks.length > 0).length} 个`);
    console.log("=".repeat(60) + "\n");
    return { total: this.results.length, valid: valid.length, highConf: highConf.length, results: this.results };
  }

  // ====== 导出 ======
  exportCSV(filename = "") {
    if (this.results.length === 0) { console.log("⚠️ 没有数据可导出"); return; }
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const name = filename || `customs_importers_${date}`;
    const fp = path.join(OUTPUT_DIR, `${name}.csv`);

    const header = "公司名称,域名,网站,邮箱,电话,地址,LinkedIn,Facebook,Instagram,数据来源,置信度,产品相关";
    const rows = this.results.map(r => [
      escapeCsv(r.companyName), escapeCsv(r.domain), escapeCsv(r.sourceUrl),
      escapeCsv(r.emails.join("; ")), escapeCsv(r.phones.join("; ")),
      escapeCsv(r.address), escapeCsv(r.socialLinks.filter(s=>s.name==="LinkedIn").map(s=>s.url).join("; ")),
      escapeCsv(r.socialLinks.filter(s=>s.name==="Facebook").map(s=>s.url).join("; ")),
      escapeCsv(r.socialLinks.filter(s=>s.name==="Instagram").map(s=>s.url).join("; ")),
      r.dataSource, r.confidence + "%",
      escapeCsv(r.productInterest),
    ].join(","));

    fs.writeFileSync(fp, "\ufeff" + header + "\n" + rows.join("\n"), "utf-8");
    console.log(`✅ 海关进口商数据已导出: ${fp}`);
    return fp;
  }

  async close() {
    if (this.browser) await this.browser.close();
    console.log("👋 引擎关闭");
  }
}

function escapeCsv(s) { return s ? `"${String(s).replace(/"/g, '""')}"` : '""'; }

// ========== 主入口 ==========
async function main() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--product": opts.product = args[++i]; break;
      case "--hs": opts.hsCode = args[++i]; break;
      case "--market": opts.market = args[++i]; break;
      case "--max": opts.maxVisits = parseInt(args[++i]); break;
      case "--headless": opts.headless = true; break;
      case "--headed": opts.headless = false; break;
      case "--deep": opts.deep = true; break;
      case "--help": showHelp(); return;
    }
  }

  // 如果没参数，启动交互提示
  if (!opts.product) {
    showHelp();
    console.log("\n常用 HS 编码:");
    for (const [code, info] of Object.entries(HS_CODES)) {
      console.log(`  ${code} - ${info.name} (${info.cn})`);
    }
    console.log("\n示例:");
    console.log('  node customs-scraper.mjs --hs 851640 --product "hair dryer" --market "United States" --headed');
    console.log('  node customs-scraper.mjs --product "hair dryer" --market all --max 20');
    return;
  }

  const scraper = new CustomsScraper({
    headless: opts.headless !== false,
    maxVisits: opts.maxVisits || 30,
    maxPages: opts.deep ? 3 : 2,
    maxQueries: opts.deep ? 30 : 15,
  });

  try {
    await scraper.init();
    const result = await scraper.run(opts.product, opts.hsCode || "", opts.market || "Global");
    if (result.total > 0) scraper.exportCSV();

    // 也生成一份简单预览
    const valid = result.results.filter(r => r.emails.length > 0);
    if (valid.length > 0) {
      console.log("\n🎯 高价值进口商预览:");
      valid.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.companyName || r.domain}`);
        console.log(`     邮箱: ${r.emails.join(", ")}`);
        console.log(`     网站: ${r.sourceUrl}`);
        console.log("");
      });
    }
    await scraper.close();
  } catch (err) {
    console.error("\n❌ 抓取出错:", err.message);
    try { await scraper.close(); } catch {}
    process.exit(1);
  }
}

function showHelp() {
  console.log("\n🔧 海关进出口数据抓取工具");
  console.log("=".repeat(48));
  console.log("参数:");
  console.log("  --product <词>  产品关键词 (必填)");
  console.log("  --hs <编码>      HS编码 (可选)    例: 851640 (吹风机)");
  console.log("  --market <国家>  目标市场 (可选)   例: \"United States\"");
  console.log("  --headless       无头模式 (默认)");
  console.log("  --headed         有头模式");
  console.log("  --max <数字>     最大采集数 (默认 30)");
  console.log("  --deep           深度搜索 (更多查询)");
}


// ========== 导出 ==========
export { CustomsScraper, HS_CODES };

// ========== CLI 入口（仅当直接运行时）==========
const isDirectRun2 = process.argv[1] && (process.argv[1].endsWith("customs-scraper.mjs") || process.argv[1].endsWith("customs-scraper"));
if (isDirectRun2) {
}
