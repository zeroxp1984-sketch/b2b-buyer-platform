/**
 * 批量数据抓取 - 适用于吹风机外贸获客
 * 运行多个搜索组合，自动去重后导出全部结果
 *
 * 用法:
 *   node batch-scrape.mjs
 */

import { B2BScraper } from "./scraper.mjs";
import fs from "fs";

// ========== 配置你的搜索组合 ==========
// 修改这里来适配你的产品和目标市场
const CAMPAIGNS = [
  // ===== 吹风机（针对格美通科技）=====
  { product: "hair dryer", market: "United States", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "United States", buyer: "small wholesaler" },
  { product: "hair dryer", market: "United States", buyer: "distributor" },
  { product: "hair dryer", market: "United Kingdom", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "Germany", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "France", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "Canada", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "Australia", buyer: "wholesale buyer" },
  { product: "hair dryer", market: "UAE", buyer: "wholesale buyer" },
  { product: "professional hair dryer", market: "United States", buyer: "wholesale buyer" },
  { product: "ionic hair dryer", market: "United Kingdom", buyer: "wholesale buyer" },

  // ===== 智能穿戴（你系统原有产品线）=====
  { product: "smart ring", market: "United States", buyer: "small wholesaler" },
  { product: "smart watch", market: "Germany", buyer: "wholesale buyer" },
];

async function main() {
  console.log("=".repeat(60));
  console.log("📦 B2B 批量数据抓取");
  console.log(`   共 ${CAMPAIGNS.length} 个搜索任务`);
  console.log("=".repeat(60));

  const scraper = new B2BScraper({ headless: true, maxVisits: 20, maxPages: 2 });

  try {
    await scraper.init();

    let taskIndex = 0;
    for (const c of CAMPAIGNS) {
      taskIndex++;
      console.log(`\n📋 [${taskIndex}/${CAMPAIGNS.length}] ${c.product} / ${c.market} / ${c.buyer}`);
      try {
        await scraper.run(c.product, c.market, c.buyer);
      } catch (err) {
        console.log(`   ⚠️ 任务跳过: ${err.message}`);
      }
    }

    // 去重：按域名保留邮箱最多的记录
    const uniqueMap = new Map();
    for (const r of scraper.results) {
      const key = r.domain || r.sourceUrl;
      const existing = uniqueMap.get(key);
      if (!existing || r.emails.length > existing.emails.length) {
        uniqueMap.set(key, r);
      }
    }
    scraper.results = [...uniqueMap.values()];

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const hasEmail = scraper.results.filter((r) => r.emails.length > 0);

    console.log(`\n📊 去重后共 ${scraper.results.length} 个客户，其中 ${hasEmail.length} 个有邮箱`);

    // 导出全部
    if (scraper.results.length > 0) {
      scraper.exportCSV(`batch_leads_${dateStr}`);
    }

    // 额外导出：仅含邮箱的
    if (hasEmail.length > 0) {
      const tmp = new B2BScraper();
      tmp.results = hasEmail;
      tmp.exportCSV(`valid_emails_${dateStr}`);

      console.log("\n" + "=".repeat(60));
      console.log("🎯 有效客户摘要（有邮箱）:");
      console.log("=".repeat(60));
      hasEmail.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.companyName || r.domain}`);
        console.log(`     网站: ${r.sourceUrl}`);
        console.log(`     邮箱: ${r.emails.join(", ")}`);
        console.log("");
      });
    }

    console.log(`✅ 批量抓取完成！`);
  } catch (err) {
    console.error("❌ 批量抓取出错:", err.message);
  } finally {
    await scraper.close();
  }
}

main();
