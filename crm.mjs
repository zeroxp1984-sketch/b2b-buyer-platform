/**
 * B2B 客户关系管理系统（CLI版）
 * 功能: 客户分类  |  分析  |  开发信生成 & 管理
 *
 * 数据流: scraper.mjs - CSV -> crm import -> 分类 -> 开发信
 *
 * 用法:
 *   node crm.mjs import <csv>    导入抓取的客户数据
 *   node crm.mjs classify         分类所有未分类客户
 *   node crm.mjs list [--cat <t>] 查看客户列表
 *   node crm.mjs analyze          查看分类分析
 *   node crm.mjs letter <ID>      生成/查看开发信
 *   node crm.mjs send <ID>        标记已发送
 *   node crm.mjs export [--cat]   导出分类后客户
 *   node crm.mjs stats            统计概览
 *   node crm.mjs batch-letter     批量生成开发信
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "crm-data");

// ========== 客户分类定义 ==========
const CATEGORIES = {
  wholesaler: { label: "📦️ 批发商", icon: "📦", keywords: ["wholesale","wholesaler","distributor","bulk buy","bulk order","volume discount","bulk purchase","distributorship"],
    desc: "批量采购商，关注价格和供货稳定" },
  trader: { label: "🔄 贸易商", icon: "🔄", keywords: ["trade","trading","import","export","importer","exporter","sourcing","sourcing agent","international trade","global trade","import export","cross border"],
    desc: "进出口贸易公司，关注产品线和利润率" },
  buyer: { label: "🎯 采购商", icon: "🎯", keywords: ["procurement","purchasing","buyer","head buyer","senior buyer","purchasing department","buying office","procurement manager","procurement officer"],
    desc: "公司采购部门，关注品质和供应商资质" },
  sourcer: { label: "🛍️ 买手", icon: "🛍", keywords: ["fashion buyer","merchandiser","product sourcer","trend buyer","sourcing specialist","product developer","fashion merchandiser","assortment buyer"],
    desc: "寻找新品和趋势产品，关注设计和样品" },
  retailer: { label: "🏪️ 零售商", icon: "🏪", keywords: ["retail","retailer","retail store","boutique","shop owner","store owner","retail shop","boutique owner","multi-brand store"],
    desc: "实体店/连锁店，关注小批量多款式" },
  onlineStore: { label: "🌐 独立站店主", icon: "🌐", keywords: ["ecommerce","e-commerce","online store","shopify","amazon seller","etsy seller","dropshipping","webstore","ecom","amazon fba","dropship"],
    desc: "电商卖家，关注 dropshipping 和小 MOQ" },
  brand: { label: "🏷️ 品牌商", icon: "🏷", keywords: ["brand owner","private label","oem","odm","brand development","product design","brand manager","own brand","brand co","brands"],
    desc: "自有品牌商，关注 OEM/ODM 能力" },
  salon: { label: "💇‍♀️ 美发沙龙", icon: "💇", keywords: ["salon","hair salon","beauty salon","barber","hairdresser","beauty supply","salon supply","spa","beauty store","hair studio"],
    desc: "专业美发用户，关注专业级产品" },
  unclassified: { label: "❓ 未分类", icon: "❓", keywords: [], desc: "待分类客户" }
};
// ========== 分类引擎 ==========
class Classifier {
  classify(lead) {
        const text = [lead.companyName||"", lead.domain||"", lead.sourceUrl||"", lead.pageTitle||"", lead.notes||"", (lead.emails||[]).join(" ")].join(" ").toLowerCase();
    const scores = {};
    for (const [catId, catDef] of Object.entries(CATEGORIES)) {
      if (catId === "unclassified") continue;
      scores[catId] = 0;
      for (const kw of catDef.keywords) {
        if ((lead.domain || "").toLowerCase().includes(kw)) scores[catId] += 3;
        if ((lead.companyName || "").toLowerCase().includes(kw)) scores[catId] += 2;
        if (text.includes(kw)) scores[catId] += 1;
      }
    }
    const emailStr = (lead.emails || []).join(" ").toLowerCase();
    if (emailStr.includes("purchase@") || emailStr.includes("procurement@") || emailStr.includes("buyer@")) scores.buyer = (scores.buyer || 0) + 2;
    if (emailStr.includes("sales@")) scores.wholesaler = (scores.wholesaler || 0) + 1;
    if (emailStr.includes("info@") || emailStr.includes("contact@")) { /* neutral */ }

    let bestCat = "unclassified", bestScore = 0;
    for (const [catId, score] of Object.entries(scores)) {
      if (score > bestScore) { bestScore = score; bestCat = catId; }
    }
    return {
      category: bestCat,
      confidence: bestScore > 0 ? Math.min(Math.round((bestScore / 10) * 100), 95) : 0,
      scores, analyzedAt: new Date().toISOString()
    };
  }

  classifyAll(leads) {
    return leads.map((lead) => {
      if (lead.category && lead.category !== "unclassified" && lead.confidence > 50) return lead;
      return { ...lead, ...this.classify(lead) };
    });
  }
}
// ========== 数据分析 ==========
class Analyzer {
  constructor(leads) { this.leads = leads; }

  categoryStats() {
    const stats = {};
    for (const [catId, catDef] of Object.entries(CATEGORIES)) {
      const items = this.leads.filter(l => l.category === catId);
      const withEmail = items.filter(l => (l.emails || []).length > 0);
      const sent = items.filter(l => l.letterSent);
      stats[catId] = {
        label: catDef.label, icon: catDef.icon,
        total: items.length, withEmail: withEmail.length,
        sent: sent.length,
        pct: this.leads.length > 0 ? Math.round(items.length / this.leads.length * 100) : 0
      };
    }
    return stats;
  }

  letterStats() {
    return {
      total: this.leads.length,
      canSend: this.leads.filter(l => (l.emails || []).length > 0).length,
      sent: this.leads.filter(l => l.letterSent).length,
      pending: this.leads.filter(l => (l.emails || []).length > 0 && !l.letterSent).length
    };
  }

  getPendingLeads() { return this.leads.filter(l => (l.emails || []).length > 0 && !l.letterSent); }
}
// ========== 数据库 ==========
class Database {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.filePath = path.join(DATA_DIR, "leads.json");
    this.leads = this._load();
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.filePath,"utf-8")); } catch { return []; } }
  save() { fs.writeFileSync(this.filePath, JSON.stringify(this.leads, null, 2), "utf-8"); }

  importFromCSV(csvPath) {
    if (!fs.existsSync(csvPath)) { console.error("文件不存在:", csvPath); return 0; }
    const raw = fs.readFileSync(csvPath, "utf-8");
    const lines = raw.replace(/^\\ufeff/, "").split("\n").filter(l => l.trim());
    if (lines.length < 2) return 0;
    const header = lines[0].split(",").map(h => h.replace(/"/g,"").trim());
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      try {
        const vals = parseCSVLine(lines[i]);
        const lead = {};
        header.forEach((h, idx) => { lead[h] = (vals[idx]||"").trim(); });
        const entry = {
          companyName: lead["公司名称"] || lead["companyName"] || "",
          domain: lead["网站域名"] || lead["domain"] || "",
          sourceUrl: lead["来源URL"] || lead["sourceUrl"] || "",
          emails: (lead["邮箱"] || lead["emails"] || "").split(/[;\n]/).map(e=>e.trim()).filter(e=>e.includes("@")),
          phones: (lead["电话"] || lead["phones"] || "").split(/[;\n]/).map(p=>p.trim()).filter(p=>p),
          facebook: lead["Facebook"] || "", linkedin: lead["LinkedIn"] || "",
          instagram: lead["Instagram"] || "", contactPage: lead["联系页"] || "",
          visitedAt: lead["抓取时间"] || "",
          category: "unclassified", confidence: 0,
          notes: "", letterGenerated: false, letterSent: false,
          sentAt: "", letterContent: "",
          importSource: path.basename(csvPath), importedAt: new Date().toISOString()
        };
        const exists = this.leads.some(e => e.domain && entry.domain && e.domain === entry.domain);
        if (!exists && entry.domain) { this.leads.push(entry); count++; }
      } catch {}
    }
    this.save();
    return count;
  }

  getAll() { return this.leads; }
  getByCategory(catId) { return this.leads.filter(l => l.category === catId); }
  getById(idx) { return this.leads[idx]; }
  update(idx, data) { if (idx >= 0 && idx < this.leads.length) { this.leads[idx] = { ...this.leads[idx], ...data }; this.save(); return true; } return false; }
}
// ========== 开发信模板 ==========
const LETTER_TEMPLATES = {
  wholesaler: {
    sub: "Factory Direct {p} - Wholesale Pricing for {m} Distributors",
    body: `Hi {n},
I found your company while researching {p} distributors in {m}.
We are {c}, a professional {p} manufacturer in Shenzhen, China.
We supply wholesale buyers worldwide:
- Factory-direct pricing with good margins
- CE/FCC/ROHS certified quality
- Flexible MOQ for test orders
- OEM/ODM and private label available
- Fast worldwide shipping
Would you like our wholesale catalog and price list?
Best regards,
{s}
Export Manager | {e}`
  },
  trader: {
    sub: "Partnership - {p} for {m} Importers",
    body: `Hi {n},
Hope you are well. I see you are active in {m} trade.
We are {c}, a Shenzhen {p} manufacturer seeking reliable trade partners.
Why work with us:
- 10+ years export experience to {r}
- 5000sqm factory with 15+ R&D engineers
- OEM/ODM with fast turnaround
- Factory pricing for good margins
Exclusive distribution terms possible for right partners. Shall we talk?
Warm regards,
{s}
Export Manager | {e}`
  },
  buyer: {
    sub: "{p} Supplier for {m} - Certified Quality",
    body: `Dear {n},
As a procurement professional, you value quality and reliability.
{c} supplies {p} to buyers across {r}. We hold CE/FCC/ROHS certifications.
- Consistent quality with QC reports
- On-time delivery guaranteed
- Sample available for evaluation
- Competitive pricing for long-term partnership
Our catalog and compliance docs are ready for your review.
Sincerely,
{s}
Export Manager | {e}`
  },
  sourcer: {
    sub: "New {p} Arrivals - Samples for {m} Buyers",
    body: `Hi {n},
As a professional buyer, you look for trending products.
Introducing our latest {p} lineup:
- Trend-driven designs updated quarterly
- Competitive pricing, great quality
- Sample service 3-5 days turnaround
- Small test orders accepted
Popular in markets like {m}. Our lookbook is ready.
Can I send sample pricing?
Best,
{s}
Export Manager | {e}`
  },
  retailer: {
    sub: "{p} for Retail - Small MOQ in {m}",
    body: `Hi {n},
We supply {p} to retailers worldwide.
We know retailers need:
- Retail-ready attractive packaging
- Small MOQ from 50pcs
- Competitive retail pricing
- Fast reliable shipping
Custom packaging with your logo available. Want to see our retail catalog?
Warmly,
{s}
Export Manager | {e}`
  },
  onlineStore: {
    sub: "{p} for Dropshipping - No MOQ",
    body: `Hi {n},
We are {c}, a {p} manufacturer supporting ecom sellers:
- Dropshipping service - no inventory needed
- No minimum order to start
- Fast 3-7 day shipping via express
- Product photos, descriptions & videos
- Custom packaging for your brand
Many Amazon/Shopify sellers started with just samples. Ready to see?
Cheers,
{s}
Export Manager | {e}`
  },
  brand: {
    sub: "OEM/ODM {p} for {m} Brands",
    body: `Dear {n},
If you are building your {p} brand for {m}, we can help.
{c} specializes in OEM/ODM:
- Full development from concept to mass production
- Custom design, molds, colors, packaging
- CE/FCC/ROHS certification
- MOQ from 500pcs for custom orders
- Serving brands in {r} for 10+ years
Let us bring your product vision to life. Discuss your project?
Regards,
{s}
Export Manager | {e}`
  },
  salon: {
    sub: "Professional {p} for Salons in {m}",
    body: `Hi {n},
{c} manufactures professional {p} trusted by salons worldwide.
Salon-grade features:
- High-performance motors for daily pro use
- Low noise for comfortable environment
- Ionic technology for healthy results
- Durable build with warranty
Special pricing for salon suppliers. Request a sample for your team?
Best,
{s}
Export Manager | {e}`
  },
  general: {
    sub: "{p} Manufacturer from Shenzhen",
    body: `Hi {n},
{c} is a {p} manufacturer based in Shenzhen, China.
We offer:
- Factory-direct pricing
- Quality assurance
- Flexible order quantities
- OEM/ODM support
- Fast shipping worldwide
Interested in our catalog and pricing?
Best regards,
{s}
Export Manager | {e}`
  }
};
// ========== 开发信管理器 ==========
class LetterManager {
  constructor(db) { this.db = db; }

  generate(idx, sender = { name:"Yan", company:"Shenzhen Gemeitong Technology Co., Ltd.", email:"export@gemeitong.com" }) {
    const lead = this.db.getById(idx);
    if (!lead) return console.error("客户不存在");
    const catId = lead.category || "general";
    const tpl = LETTER_TEMPLATES[catId] || LETTER_TEMPLATES.general;
    const vars = {
      n: lead.companyName || "there",
      c: sender.company,
      p: lead.product || "hair dryer",
      m: extractCountry(lead) || "your market",
      r: extractRegion(lead) || "worldwide",
      s: sender.name,
      e: sender.email,
    };
    const subject = fillTpl(tpl.sub, vars);
    const body = fillTpl(tpl.body, vars);
    return { idx, companyName: lead.companyName, category: CATEGORIES[catId]?.label || "通用", emails: lead.emails, subject, body, generatedAt: new Date().toISOString() };
  }

  markSent(idx) { return this.db.update(idx, { letterSent: true, letterGenerated: true, sentAt: new Date().toISOString() }); }

  batchGenerate(sender) {
    const analyzer = new Analyzer(this.db.getAll());
    const pending = analyzer.getPendingLeads();
    const letters = [];
    for (const lead of pending) {
      const i = this.db.getAll().indexOf(lead);
      if (i >= 0) { const l = this.generate(i, sender); if (l) { letters.push(l); this.db.update(i, { letterContent: JSON.stringify(l), letterGenerated: true }); } }
    }
    return letters;
  }
}

// ========== 工具函数 ==========
function fillTpl(tpl, vars) {
  let r = tpl;
  for (const [k, v] of Object.entries(vars)) r = r.replace(new RegExp(`\\{${k}\\}`, "g"), v || "");
  return r;
}

function extractCountry(lead) {
  try { const tld = new URL(lead.sourceUrl||"http://x.com").hostname.split(".").pop();
    const map = { uk:"United Kingdom", de:"Germany", fr:"France", es:"Spain", it:"Italy", ca:"Canada", au:"Australia", jp:"Japan", br:"Brazil", nl:"Netherlands", ae:"UAE" };
    return map[tld] || "your market"; } catch { return "your market"; }
}

function extractRegion(lead) {
  const c = extractCountry(lead);
  const map = { "United States":"North America", Canada:"North America", "United Kingdom":"Europe", Germany:"Europe", France:"Europe", Spain:"Europe", Italy:"Europe", Netherlands:"Europe", Australia:"Oceania", Japan:"Asia", Brazil:"South America", UAE:"Middle East" };
  return map[c] || "international";
}

function parseCSVLine(line) {
  const r = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1]==='"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { r.push(cur); cur = ""; }
    else cur += ch;
  }
  r.push(cur); return r;
}

function escapeCsv(s) { return s ? '"' + String(s).replace(/"/g,'""') + '"' : '""'; }
// ========== 仪表盘显示 ==========
function printDashboard(db) {
  const a = new Analyzer(db.getAll());
  const cs = a.categoryStats();
  const ls = a.letterStats();
  console.log("\n" + "=".repeat(60));
  console.log("  B2B 客户分类仪表盘");
  console.log("=".repeat(60));
  console.log("  分类               | 数量 | 有邮箱 | 已发信 | 占比");
  console.log("-".repeat(60));
  for (const [id, s] of Object.entries(cs)) {
    if (s.total > 0) console.log("  " + s.icon + " " + s.label.padEnd(12) + " | " + String(s.total).padStart(3) + "  | " + String(s.withEmail).padStart(5) + "  | " + String(s.sent).padStart(5) + "  | " + String(s.pct).padStart(3) + "%");
  }
  console.log("-".repeat(60));
  console.log("\n开发信进度: 总" + ls.total + " | 可发" + ls.canSend + " | 已发" + ls.sent + " | 待发" + ls.pending);
  console.log("=".repeat(60) + "\n");
}

function printLeadList(db, catFilter) {
  const leads = catFilter ? db.getByCategory(catFilter) : db.getAll();
  if (!leads.length) return console.log("无数据");
  console.log("\n客户列表 (" + leads.length + "条)" + (catFilter ? " 分类:" + (CATEGORIES[catFilter]?.label||catFilter) : ""));
  leads.forEach((l, i) => {
    const idx = db.getAll().indexOf(l);
    const cat = CATEGORIES[l.category]?.label || "?";
    const email = (l.emails||[]).join(";").substring(0, 35);
    console.log("  " + String(idx).padStart(3) + ". " + (l.companyName||l.domain||"?").substring(0,28).padEnd(28) + " " + cat + " " + (l.letterSent ? "[已发]" : "[待发]") + " " + email);
  });
}
// ========== CLI 主入口 ==========
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const db = new Database();
  const clf = new Classifier();
  const lm = new LetterManager(db);

  switch (cmd) {
    case "import": {
      const f = args[1];
      if (!f) return console.log("Usage: node crm.mjs import <csv>");
      const p = path.resolve(__dirname, f);
      console.log("Import:", p);
      const n = db.importFromCSV(p);
      console.log("Imported " + n + " new leads (total " + db.getAll().length + ")");
      break;
    }
    case "classify": {
      const ul = db.getAll().filter(l => l.category === "unclassified" || !l.confidence || l.confidence < 30);
      console.log("Classifying " + ul.length + " leads...");
      const upd = clf.classifyAll(ul);
      let ch = 0;
      for (const u of upd) {
        const i = db.getAll().findIndex(l => l.domain === u.domain);
        if (i >= 0) { db.update(i, { category: u.category, confidence: u.confidence, scores: u.scores, analyzedAt: u.analyzedAt }); ch++; }
      }
      console.log("Done! " + ch + " classified");
      const st = {}; db.getAll().forEach(l => { st[l.category] = (st[l.category]||0)+1; });
      for (const [c, n] of Object.entries(st)) console.log("  " + CATEGORIES[c]?.icon + " " + (CATEGORIES[c]?.label||c) + ": " + n);
      break;
    }
    case "list": {
      const ci = args.indexOf("--cat");
      printLeadList(db, ci >= 0 ? args[ci+1] : null);
      break;
    }
    case "analyze": { printDashboard(db); break; }
    case "stats": {
      const ls = new Analyzer(db.getAll()).letterStats();
      console.log("\nCRM Stats: total=" + ls.total + " classified=" + db.getAll().filter(l=>l.category!=="unclassified").length + " email=" + ls.canSend + " sent=" + ls.sent + " pending=" + ls.pending + "\n");
      break;
    }
    case "letter": {
      const i = parseInt(args[1]);
      if (isNaN(i)) return console.log("Usage: node crm.mjs letter <ID>");
      const lead = db.getById(i);
      if (!lead) return console.log("Lead not found");
      if (lead.category === "unclassified") { const r = clf.classify(lead); db.update(i, r); console.log("Auto-classified as: " + CATEGORIES[r.category]?.label); }
      const sender = { name: "Yan", company: "Shenzhen Gemeitong Technology Co., Ltd.", email: "export@gemeitong.com" };
      const l = lm.generate(i, sender);
      if (!l) break;
      console.log("\nTo: " + l.companyName + " (" + l.category + ")");
      console.log("Email: " + (l.emails||[]).join(", "));
      console.log("\nSubject: " + l.subject);
      console.log("\n" + l.body);
      if (args.includes("--send")) { lm.markSent(i); console.log("\n[Marked as sent]"); }
      break;
    }
    case "send": {
      const i = parseInt(args[1]);
      if (isNaN(i)) return console.log("Usage: node crm.mjs send <ID>");
      if (lm.markSent(i)) console.log("Marked as sent");
      else console.log("Failed");
      break;
    }
    case "export": {
      const ci = args.indexOf("--cat");
      const cf = ci >= 0 ? args[ci+1] : null;
      const leads = cf ? db.getByCategory(cf) : db.getAll();
      if (!leads.length) return console.log("No data");
      const dir = path.join(__dirname, "exports");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const date = new Date().toISOString().slice(0,10).replace(/-/g,"");
      const sfx = cf ? "_"+cf : "_all";
      const fp = path.join(__dirname, "exports", "crm_leads"+sfx+"_"+date+".csv");
      const header = "公司名称,分类,邮箱,电话,网站,Facebook,LinkedIn,Instagram,已发信,备注";
      const rows = leads.map(l => [escapeCsv(l.companyName), escapeCsv(CATEGORIES[l.category]?.label||"?"), escapeCsv((l.emails||[]).join("; ")), escapeCsv((l.phones||[]).join("; ")), escapeCsv(l.sourceUrl), escapeCsv(l.facebook), escapeCsv(l.linkedin), escapeCsv(l.instagram), l.letterSent ? "是" : "否", escapeCsv(l.notes||"")].join(","));
      fs.writeFileSync(fp, "\ufeff" + header + "\n" + rows.join("\n"), "utf-8");
      console.log("Exported " + leads.length + " leads to " + fp);
      break;
    }
    case "batch-letter": {
      const sender = { name: "Yan", company: "Shenzhen Gemeitong Technology Co., Ltd.", email: "export@gemeitong.com" };
      const ul = db.getAll().filter(l => l.category === "unclassified");
      if (ul.length > 0) { console.log("Classifying " + ul.length + " leads first..."); clf.classifyAll(db.getAll()); db.save(); }
      const letters = lm.batchGenerate(sender);
      console.log("Generated " + letters.length + " letters");
      if (letters.length > 0) {
        const dir = path.join(__dirname, "exports");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const date = new Date().toISOString().slice(0,10).replace(/-/g,"");
        const fp = path.join(dir, "batch_letters_"+date+".txt");
        const content = letters.map((l,i) => "=== Letter "+(i+1)+" ===\nClient: "+l.companyName+"\nCategory: "+l.category+"\nEmail: "+l.emails.join(", ")+"\n\nSubject: "+l.subject+"\n\n"+l.body+"\n\n").join("\n"+"=".repeat(48)+"\n\n");
        fs.writeFileSync(fp, content, "utf-8");
        console.log("Letters saved to " + fp);
        console.log("You can copy and send these via email.");
      }
      break;
    }
    default:
      console.log("\nB2B CRM System");
      console.log("Commands:");
      console.log("  import <csv>        Import scraped data");
      console.log("  classify            Auto-classify leads");
      console.log("  list [--cat <type>]  List leads");
      console.log("  analyze             Show dashboard");
      console.log("  letter <ID>         Generate development letter");
      console.log("  send <ID>           Mark as sent");
      console.log("  batch-letter        Batch generate letters");
      console.log("  export [--cat <t>]  Export leads");
      console.log("  stats               Statistics");
      console.log("\nCategories: wholesaler(批发商) trader(贸易商) buyer(采购商) sourcer(买手) retailer(零售商) onlineStore(店主) brand(品牌商) salon(美发沙龙)");
      console.log("\nFlow: scrape -> crm import -> crm classify -> crm analyze -> crm batch-letter");
  }
}

main().catch(console.error);
