/**
 * 海关数据批量搜索 + CRM 集成
 * 一次搜索多国进口商数据
 *
 * 用法: node batch-customs.mjs
 */

import { CustomsScraper } from "./customs-scraper.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== 配置你的搜索任务 ==========
const TASKS = [
  // 吹风机 - 全球多市场
  { product: "hair dryer", hs: "851640", market: "United States" },
  { product: "hair dryer", hs: "851640", market: "United Kingdom" },
  { product: "hair dryer", hs: "851640", market: "Germany" },
  { product: "hair dryer", hs: "851640", market: "France" },
  { product: "hair dryer", hs: "851640", market: "Canada" },
  { product: "hair dryer", hs: "851640", market: "Australia" },
  { product: "hair dryer", hs: "851640", market: "UAE" },
  { product: "hair dryer", hs: "851640", market: "India" },

  // 其他美发产品
  { product: "hair curler", hs: "851631", market: "United States" },
  { product: "hair straightener", hs: "851632", market: "United Kingdom" },

  // 通用关键词搜索
  { product: "hair dryer", hs: "", market: "Global" },
];

async function main() {
  console.log("=".repeat(60));
  console.log("🌍 海关数据批量搜索");
  console.log("  共 " + TASKS.length + " 个搜索任务");
  console.log("=".repeat(60));

  const scraper = new CustomsScraper({ headless: true, maxVisits: 10, maxPages: 1, maxQueries: 8 });
  await scraper.init();

  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];
    console.log(`\n📋 [${i + 1}/${TASKS.length}] ${t.product} | HS:${t.hs || "通用"} | ${t.market}`);
    try {
      await scraper.run(t.product, t.hs, t.market);
    } catch (err) {
      console.log(`   ⚠️ 跳过: ${err.message}`);
    }
  }

  // 去重（按域名保留邮箱最多的版本）
  const unique = new Map();
  for (const r of scraper.results) {
    const key = r.domain || r.sourceUrl;
    const existing = unique.get(key);
    if (!existing || r.emails.length > existing.emails.length) unique.set(key, r);
  }
  scraper.results = [...unique.values()];
  scraper.exportCSV("batch_customs_importers");

  const valid = scraper.results.filter(r => r.emails.length > 0);
  console.log(`\n📊 去重后共 ${scraper.results.length} 个进口商`);
  console.log(`✅ 有邮箱 ${valid.length} 个`);

  // 生成进口商预览文件
  if (valid.length > 0) {
    const dir = path.join(__dirname, "exports");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fp = path.join(dir, "hot_importers_" + date + ".txt");
    const content = valid.map((r, i) =>
      `${i + 1}. ${r.companyName || r.domain}\n   邮箱: ${r.emails.join(", ")}\n   电话: ${r.phones.join(", ")}\n   网站: ${r.sourceUrl}\n`
    ).join("\n");
    fs.writeFileSync(fp, content, "utf-8");
    console.log(`📄 高价值进口商汇总: ${fp}`);
  }

  // 集成到 CRM（自动生成 crm import 可用的 CSV）
  if (valid.length > 0) {
    const dir = path.join(__dirname, "exports");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fp = path.join(dir, `for_crm_import_${date}.csv`);
    const header = "公司名称,网站域名,来源URL,邮箱,电话,Facebook,LinkedIn,Instagram";
    const rows = valid.map(r => [
      escCsv(r.companyName || r.domain),
      escCsv(r.domain),
      escCsv(r.sourceUrl),
      escCsv(r.emails.join("; ")),
      escCsv(r.phones.join("; ")),
      escCsv(r.socialLinks.filter(s=>s.name==="Facebook").map(s=>s.url).join("; ")),
      escCsv(r.socialLinks.filter(s=>s.name==="LinkedIn").map(s=>s.url).join("; ")),
      escCsv(r.socialLinks.filter(s=>s.name==="Instagram").map(s=>s.url).join("; ")),
    ].join(",");
    fs.writeFileSync(fp, "\ufeff" + header + "\n" + rows.join("\n"), "utf-8");
    console.log(`📥 准备导入 CRM: node crm.mjs import ${fp}`);
  }

  await scraper.close();
  console.log("\n✅ 批量海关数据搜索完成！");
}

function escCsv(s) { return s ? '"' + String(s).replace(/"/g, '""') + '"' : '""'; }

main().catch(console.error);
