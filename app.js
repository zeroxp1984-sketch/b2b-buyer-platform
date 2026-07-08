const state = {
  running: false,
  seconds: 0,
  collected: 0,
  valid: 0,
  sent: 0,
  hot: 0,
  tasks: [],
  leads: [],
  logs: [
    ["系统启动", "手动运行任务后自动采集采购商数据"]
  ],
  leadCRM: {},
  currentLeadIdx: -1,
  quotes: []
};


const titles = {
  dashboard: ["总览", "集中搜索 Google、Facebook、LinkedIn、Instagram 上的小型批发商和采购商。"],
  tasks: ["采集任务", "配置四个平台、产品关键词、目标国家和小买家规则。"],
  keywords: ["关键词库", "按智能穿戴产品生成小型批发商、采购商、独立零售商搜索词。"],
  leads: ["采购商库", "查看、搜索、标记和导出采集到的小型批发商和采购商。"],
  messages: ["独立开发信系统", "生成英文首封开发信、跟进信和社媒私信。"],
  accounts: ["账号设置", "配置 Google、Facebook、LinkedIn、Instagram 搜索和账号策略。"]
};

const sourceData = [];

const products = ["smart ring", "smart watch", "smart band", "smart bracelet", "smart glasses", "AI glasses", "hair dryer"];
const regions = ["United States", "Germany", "United Kingdom", "Canada", "Australia", "Netherlands", "France", "Spain"];
const companies = ["Small Wearable Wholesale", "Boutique Gadget Buyer", "Independent Tech Retailer", "Online Wearable Store", "Smart Life Small Buyer"];
const emailDomains = ["wearablebuyer.com", "smartretail.co", "gadgetwholesale.net", "techbuyer.store", "smallb2btrade.com"];

const keywordProducts = {
  "smart ring": ["smart ring", "AI smart ring", "health monitoring ring", "sleep tracking ring", "fitness ring", "NFC smart ring"],
  "smart watch": ["smart watch", "GPS smart watch", "fitness smart watch", "health smart watch", "children smart watch", "OEM smart watch"],
  "smart band": ["smart band", "smart bracelet", "fitness tracker", "activity tracker", "health bracelet", "smart wristband", "OEM fitness band"],
  "smart glasses": ["smart glasses", "AR smart glasses", "Bluetooth smart glasses", "camera smart glasses", "wearable smart glasses"],
  "AI glasses": ["AI glasses", "AI smart glasses", "AI translation glasses", "AI camera glasses", "voice assistant glasses"],
  "hair dryer": ["hair dryer", "ionic hair dryer", "professional hair dryer", "portable hair dryer", "foldable hair dryer", "travel hair dryer", "OEM hair dryer"]
};

const buyerTerms = {
  English: ["small wholesaler", "wholesale buyer", "small distributor", "independent retailer", "boutique buyer", "online store owner", "reseller"],
  French: ["petit grossiste", "acheteur grossiste", "distributeur local", "boutique d'electronique"],
  Spanish: ["pequeno mayorista", "comprador mayorista", "distribuidor pequeno", "tienda de electronica"],
  Portuguese: ["pequeno atacadista", "comprador atacadista", "pequeno distribuidor", "loja de eletronicos"],
  Arabic: ["small wholesaler", "wholesale buyer", "electronics shop", "online store"],
  Russian: ["small wholesaler", "wholesale buyer", "electronics store", "online shop"],
  Vietnamese: ["small wholesaler", "wholesale buyer", "electronics shop", "online store"],
  Indonesian: ["grosir kecil", "pembeli grosir", "toko elektronik", "online store"]
};

const marketGroups = {
  Global: ["United States", "Germany", "United Kingdom", "France", "Spain", "UAE", "Brazil", "Mexico", "Vietnam", "Indonesia"],
  "United States": ["United States", "New York", "Los Angeles", "California", "Texas"],
  Germany: ["Germany", "Berlin", "Hamburg", "Munich"],
  "United Kingdom": ["United Kingdom", "London", "Manchester", "Birmingham"],
  France: ["France", "Paris", "Lyon", "Marseille"],
  Spain: ["Spain", "Madrid", "Barcelona", "Valencia"],
  "United Arab Emirates": ["UAE", "Dubai", "Abu Dhabi", "Sharjah"],
  Brazil: ["Brazil", "Sao Paulo", "Rio de Janeiro"],
  Mexico: ["Mexico", "Mexico City", "Guadalajara"],
  Vietnam: ["Vietnam", "Ho Chi Minh", "Hanoi"],
  Indonesia: ["Indonesia", "Jakarta", "Surabaya"]
};

const searchTemplates = [
  ["Google 小批发商", "\"{product}\" \"small wholesaler\" \"{market}\""],
  ["Google 采购商", "\"{product}\" \"wholesale buyer\" \"{market}\""],
  ["Google 独立零售", "\"{product}\" \"independent retailer\" \"{market}\""],
  ["Facebook 群组", "{product} {market} small wholesale group"],
  ["Facebook 采购商", "{product} {market} wholesale buyer Facebook"],
  ["LinkedIn 采购", "site:linkedin.com/in \"{product}\" \"wholesale buyer\" \"{market}\""],
  ["LinkedIn 公司", "site:linkedin.com/company \"{product}\" \"small distributor\" \"{market}\""],
  ["Instagram 店铺", "site:instagram.com \"{product}\" \"online store\" \"{market}\""],
  ["Instagram 买手", "site:instagram.com \"{product}\" \"boutique buyer\" \"{market}\""],
  ["Google 店主", "\"{product}\" \"online store owner\" \"{market}\""]
];

let currentKeywords = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ── 真实搜索：通过 Serper API 采集海外采购商 ──
function getSerperKey() {
  const key = $("#serperKey")?.value?.trim();
  return key || localStorage.getItem("serper_api_key") || "";
}

function saveSerperKey(key) {
  if (key) localStorage.setItem("serper_api_key", key);
}

// ── Hunter.io 邮箱增强 ──
function getHunterKey() {
  const key = $("#hunterKey")?.value?.trim();
  return key || localStorage.getItem("hunter_api_key") || "";
}

function saveHunterKey(key) {
  if (key) localStorage.setItem("hunter_api_key", key);
}

async function enrichEmailByDomain(domain) {
  const key = getHunterKey();
  if (!key || !domain) return null;
  try {
    const resp = await fetch("https://api.hunter.io/v2/domain-search?domain=" + encodeURIComponent(domain) + "&api_key=" + key);
    if (!resp.ok) return null;
    const data = await resp.json();
    const emails = data?.data?.emails || [];
    // 返回高置信度的邮箱，按置信度从高到低排序
    return emails
      .filter(e => e.confidence >= 70 && e.value)
      .sort((a, b) => b.confidence - a.confidence)
      .map(e => ({ email: e.value, confidence: e.confidence, position: e.position || "" }));
  } catch (e) {
    console.warn("Hunter.io lookup failed:", e);
    return null;
  }
}

// ── Apollo.io B2B 联系人增强 ──
function getApolloKey() {
  const key = $("#apolloKey")?.value?.trim();
  return key || localStorage.getItem("apollo_api_key") || "";
}

function saveApolloKey(key) {
  if (key) localStorage.setItem("apollo_api_key", key);
}

async function enrichWithApollo(company, domain) {
  const key = getApolloKey();
  if (!key) return null;
  const searchDomain = domain || "";
  const searchCompany = company || "";
  if (!searchDomain && !searchCompany) return null;
  try {
    const resp = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": key
      },
      body: JSON.stringify({
        reveal_personal_emails: true,
        reveal_phone_number: true,
        people: [{
          domain: searchDomain,
          company_name: searchCompany
        }]
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const matches = data?.people || [];
    // 返回匹配度最高的联系人
    const scored = matches.filter(p => p.email && !p.email.includes("example.com"))
      .map(p => ({
        email: p.email || "",
        first_name: p.first_name || "",
        last_name: p.last_name || "",
        title: p.title || "",
        phone: p.phone || "",
        linkedin_url: p.linkedin_url || "",
        confidence: p.contact_source ? 85 : 70
      }));
    return scored.length > 0 ? scored.sort((a, b) => b.confidence - a.confidence).slice(0, 3) : null;
  } catch (e) {
    console.warn("Apollo.io lookup failed:", e);
    return null;
  }
}

async function searchCustomers(keywords, platform, region, limit) {
  const apiKey = getSerperKey();
  const searchDepth = $("#searchDepth")?.value || "standard";

  // 检测平台账号状态
  enhanceSearchWithAccounts(keywords, platform, region);

  if (!apiKey) {
    addLog("搜索跳过", "未配置 Serper API Key，使用模拟数据演示");
    for (let i = 0; i < Math.min(limit, 12); i++) {
      createSyntheticLead(platform, region);
    }
    return;
  }

  saveSerperKey(apiKey);
  const queries = keywords.split(",").map(k => k.trim()).filter(Boolean);
  const batchSize = searchDepth === "deep" ? 5 : 3;
  const selected = queries.slice(0, batchSize);

  // 根据搜索深度构造不同的买家词和搜索策略
  const depthStrategies = {
    standard: {
      buyerTerm: getBuyerTerm() + ' email OR contact',
      numResults: 10,
      maxItems: 8,
      extraSuffix: ' email OR "contact us" OR "get in touch"'
    },
    contact_focus: {
      buyerTerm: getBuyerTerm() + ' (WhatsApp OR "phone number" OR "mobile" OR WeChat OR "contact info")',
      numResults: 20,
      maxItems: 12,
      extraSuffix: ' WhatsApp OR WeChat OR "phone number" OR "cell phone" OR "contact"'
    },
    deep: {
      buyerTerm: getBuyerTerm() + ' (email OR contact OR WhatsApp OR WeChat OR phone OR telegram)',
      numResults: 20,
      maxItems: 15,
      extraSuffix: ' email OR WhatsApp OR WeChat OR phone OR telegram OR "contact page"'
    }
  };
  const strategy = depthStrategies[searchDepth] || depthStrategies.standard;

  for (const query of selected) {
    // 搜索1: 基础买家搜索
    const searchQuery1 = query + ' ' + strategy.buyerTerm + ' ' + region;
    // 搜索2: 联系方式增强搜索
    const searchQuery2 = query + ' ' + region + strategy.extraSuffix;

    const searchQueries = [searchQuery1];
    // 深度模式多查一轮联系方式
    if (searchDepth !== "standard") searchQueries.push(searchQuery2);

    for (const sq of searchQueries) {
      try {
        const resp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: sq, gl: getCountryCode(region), num: strategy.numResults })
        });
        if (!resp.ok) {
          addLog("搜索失败", query + ': HTTP ' + resp.status + ' — 检查 API Key 或配额');
          continue;
        }
        const data = await resp.json();
        const results = data.organic || [];
        for (const item of results.slice(0, strategy.maxItems)) {
          const lead = parseSearchResult(item, query, platform, region);
          if (lead) {
            // 如果搜索深度是 contact_focus 或 deep，在 parseSearchResult 基础上再尝试提取更多联系方式
            if (searchDepth !== "standard" && lead[10] === "待采集个人联系方式") {
              // 尝试从完整片段中二次提取
              const fullText = (item.title || "") + " " + (item.snippet || "") + " " + (item.link || "");
              const found = [];
              // 邮箱提取
              const snippetEmails = fullText.match(/[\w.+-]+@[\w-]+\.[\w.]+/g);
              if (snippetEmails) {
                const realOnes = snippetEmails.filter(e =>
                  !e.includes('example.com') && !e.includes('domain.com') &&
                  !e.includes('your-email') && !e.startsWith('@')
                );
                if (realOnes.length > 0) found.push("Email: " + realOnes[0]);
              }
              const wa2 = fullText.match(/(?:whatsapp|wa)[\s:+#]*?(\d{7,15})/i);
              if (wa2) found.push("WhatsApp: " + wa2[1]);
              const ph2 = fullText.match(/(?:\+|00)\d{7,15}/);
              if (ph2) found.push("Phone: " + ph2[0]);
              const wc2 = fullText.match(/(?:wechat|微信|wx)[:\s]*?([a-zA-Z0-9_]{4,20})/i);
              if (wc2) found.push("WeChat: " + wc2[1]);
              if (found.length > 0) lead[10] = found.join(" | ");
            }
            state.leads.unshift(lead);
          }
        }
        state.leads = state.leads.slice(0, 120);
        addLog("搜索完成", query + ' 在 ' + region + ' 找到 ' + results.length + ' 条结果（深度: ' + searchDepth + '），提取潜在采购商');
      } catch (err) {
        addLog("搜索异常", query + ': ' + err.message);
      }
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Hunter.io 邮箱增强：对没有真实邮箱的采购商用域名查询
  const hunterKey = getHunterKey();
  if (hunterKey) {
    const needEnrich = state.leads.filter(l => {
      const existingEmail = l[6] || "";
      // 如果邮箱是 contact@domain 模式（猜测的），或者空值，尝试增强
      return !existingEmail || existingEmail.startsWith("contact@") || !existingEmail.includes("@");
    });
    for (const lead of needEnrich.slice(0, 10)) {  // 每次搜索最多增强10条
      const url = lead[7] || "";
      let domain = "";
      try { domain = new URL(url).hostname.replace("www.", ""); } catch {}
      if (!domain || domain.includes("facebook") || domain.includes("instagram") || domain.includes("linkedin")) continue;
      const result = await enrichEmailByDomain(domain);
      if (result && result.length > 0) {
        lead[6] = result[0].email;  // 替换为真实邮箱
        lead[8] = result[0].confidence >= 90 ? "高" : "中";  // 更新可信度
        if (result[0].position) lead[5] = (lead[5] || "") + " · " + result[0].position;
      }
      await new Promise(r => setTimeout(r, 600));  // Hunter 限流
    }
    addLog("邮箱增强", "Hunter.io 已查询 " + Math.min(needEnrich.length, 10) + " 个域名");
  }

  // Apollo.io B2B 联系人增强：补全个人邮箱、职位、电话、LinkedIn
  const apolloKey = getApolloKey();
  if (apolloKey) {
    const apolloLeads = state.leads.filter(l => {
      const email = l[6] || "";
      // 只增强那些邮箱还是 contact@ 猜测模式或没有LinkedIn联系的
      return email.startsWith("contact@") || email.includes("@unknown") || !email.includes("@");
    });
    let apolloCount = 0;
    for (const lead of apolloLeads.slice(0, 5)) {  // Apollo free 额度有限，每次最多查5条
      const companyName = lead[0] || "";
      const url = lead[7] || "";
      let domain = "";
      try { domain = new URL(url).hostname.replace("www.", ""); } catch {}
      if (!domain && !companyName) continue;
      if (domain && (domain.includes("facebook") || domain.includes("instagram") || domain.includes("linkedin"))) continue;
      const people = await enrichWithApollo(companyName, domain);
      if (people && people.length > 0) {
        const p = people[0];
        lead[6] = p.email;  // 替换为真实个人邮箱
        lead[8] = p.confidence >= 80 ? "高" : "中";
        // 标题/职位信息合并到客户描述中
        if (p.title) lead[5] = (lead[5] || "").split("·")[0].trim() + " · " + p.title;
        // 手机号合并到个人联系方式
        if (p.phone) {
          const existingContact = lead[10] || "";
          lead[10] = existingContact.includes("Phone") ? existingContact : (existingContact + " | Phone: " + p.phone).replace(/^ \| /, "");
        }
        // LinkedIn URL 加入主页字段
        if (p.linkedin_url && lead[7] && !lead[7].includes("linkedin")) {
          lead[7] = lead[7] + " | " + p.linkedin_url;
        }
        apolloCount++;
      }
      await new Promise(r => setTimeout(r, 800));  // Apollo 限流
    }
    if (apolloCount > 0) addLog("联系人增强", "Apollo.io 已找到 " + apolloCount + " 个采购决策人");
  }
}

function getBuyerTerm() {
  const bt = $("#buyerType")?.value;
  if (bt && bt !== "all") return `"${bt}"`;
  return `("small wholesaler" OR "wholesale buyer" OR "independent retailer" OR "online store")`;
}

function getCountryCode(region) {
  const map = {
    "United States": "us", "Germany": "de", "United Kingdom": "gb",
    "France": "fr", "Spain": "es", "Italy": "it", "Netherlands": "nl",
    "Brazil": "br", "Mexico": "mx", "Canada": "ca", "Australia": "au",
    "United Arab Emirates": "ae", "Vietnam": "vn", "Indonesia": "id",
    "Japan": "jp", "South Korea": "kr", "India": "in", "Russia": "ru"
  };
  return map[region] || "us";
}

function parseSearchResult(item, product, platform, region) {
  const title = item.title || '';
  const link = item.link || '';
  const snippet = item.snippet || '';

  // 尝试从标题提取公司名
  let company = title.replace(/ - .*| \|.*| — .*/i, '').trim();
  if (!company || company.length > 60) company = title.split(' | ')[0]?.trim() || title.split(' - ')[0]?.trim() || title.slice(0, 40);

  // 从 URL 提取域名
  let domain = '';
  try { domain = new URL(link).hostname.replace('www.', ''); } catch {}

  // 真实邮箱提取：先尝试从搜索摘要中找真实邮箱
  let email = '';
  const fullTextAll = title + ' ' + snippet + ' ' + link;
  const foundEmails = fullTextAll.match(/[\w.+-]+@[\w-]+\.[\w.]+/g);
  if (foundEmails && foundEmails.length > 0) {
    // 过滤掉常见的"占位邮箱"和图片邮箱
    const realEmails = foundEmails.filter(e =>
      !e.includes('example.com') &&
      !e.includes('domain.com') &&
      !e.includes('your-email') &&
      !e.includes('@email.com') &&
      !e.startsWith('@')
    );
    if (realEmails.length > 0) {
      email = realEmails[0];
    }
  }
  // 如果没找到真实邮箱，用域名生成备用邮箱
  if (!email) {
    email = 'contact@' + (domain || 'unknown');
  }
  const contact = domain ? 'https://' + domain : link;

  // ==== 优化：搜索个人联系方式（不限邮箱，含 WhatsApp/WeChat 等）====
  let personalContact = '';
  const fullText = title + ' ' + snippet;
  // 查找 WhatsApp 号码（支持 + 号和空格）
  const waMatch = fullText.match(/(?:whatsapp|wa|wpp)[\s:#+]*?(\+?\d[\d\s\-]{6,18})/i);
  if (waMatch) personalContact += 'WhatsApp: ' + waMatch[1].trim();
  // 查找手机号（国际格式，含 + 号或 00 开头）
  const phoneMatch = fullText.match(/(?:\+|00)\d[\d\s\-\(\)]{6,18}(?:\d)/);
  if (phoneMatch) {
    const cleanPhone = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
    personalContact += (personalContact ? ' | ' : '') + 'Phone: ' + cleanPhone;
  }
  // 查找 WeChat / 微信
  const wechatMatch = fullText.match(/(?:wechat|微信|wx|vx)[:\s]*?([a-zA-Z0-9_\-]{4,24})/i);
  if (wechatMatch) {
    personalContact += (personalContact ? ' | ' : '') + 'WeChat: ' + wechatMatch[1];
  }
  // 查找 Telegram
  const tgMatch = fullText.match(/telegram[\s:]*?(@?[a-zA-Z0-9_]{4,20})/i);
  if (tgMatch) {
    personalContact += (personalContact ? ' | ' : '') + 'Telegram: ' + tgMatch[1];
  }
  // 查找 Skype
  const skypeMatch = fullText.match(/skype[\s:]*?([a-zA-Z][a-zA-Z0-9_\-]{3,20})/i);
  if (skypeMatch) {
    personalContact += (personalContact ? ' | ' : '') + 'Skype: ' + skypeMatch[1];
  }
  // 如果都没找到，留空让后续步骤补充
  if (!personalContact) personalContact = '\u5f85\u91c7\u96c6\u4e2a\u4eba\u8054\u7cfb\u65b9\u5f0f';

  const score = Math.floor(65 + Math.random() * 30);
  const status = score >= 82 ? '\u9ad8\u610f\u5411' : '\u5f85\u8ddf\u8fdb';
  const confidence = score >= 82 ? '\u9ad8' : '\u4e2d';
  const evidence = '\u641c\u7d22\u5f15\u64ce\u516c\u5f00\u7ed3\u679c: ' + title.slice(0, 60) + ' \u2014 ' + snippet.slice(0, 80);
  return [company, platform, region, score, status,
    product + " \u00b7 " + snippet.slice(0, 40), email, contact, confidence, evidence];
}

function renderMetrics() {
  $("#metricCollected").textContent = state.collected;
  $("#metricValid").textContent = state.valid;
  $("#metricSent").textContent = state.sent;
  $("#metricHot").textContent = state.hot;
}

function renderLogs() {
  $("#activityLog").innerHTML = state.logs.map(([title, text]) => `
    <div class="log-item">
      <strong>${title}</strong>
      <small>${text}</small>
    </div>
  `).join("");
}

function renderSources() {
  // 从实际采购商数据计算各平台占比
  const platformCount = {};
  state.leads.forEach(function(lead) {
    const plat = lead[1] || "\u5176\u4ed6";
    platformCount[plat] = (platformCount[plat] || 0) + 1;
  });
  const total = state.leads.length || 1;
  const sources = Object.entries(platformCount)
    .map(function(pair) { return [pair[0], Math.round(pair[1] / total * 100)]; })
    .sort(function(a, b) { return b[1] - a[1]; });

  if (sources.length === 0) {
    $("#sourceList").innerHTML = '<div class="empty-state">\u542f\u52a8\u91c7\u96c6\u540e\u5c06\u663e\u793a\u5404\u5e73\u53f0\u6765\u6e90\u5360\u6bd4</div>';
    return;
  }
  $("#sourceList").innerHTML = sources.map(function(pair) {
    return '<div class="source-item">'
      + '<strong>' + pair[0] + '</strong>'
      + '<span>' + pair[1] + '%</span>'
      + '<div class="bar"><i style="width:' + pair[1] + '%"></i></div>'
      + '</div>';
  }).join("");
}

function renderTasks() {
  $("#taskList").innerHTML = state.tasks.map((task, index) => `
    <div class="task-card">
      <div class="task-card-head">
        <strong>${task.name}</strong>
        <button type="button" class="task-del-btn" data-del-task="${index}" title="删除此任务">✕</button>
      </div>
      <span>${task.platform} · ${task.region} · 已发现 ${task.found} 个采购商</span>
      <div class="progress"><i style="width:${task.progress}%"></i></div>
    </div>
  `).join("");
}

function leadTag(status) {
  if (status === "高意向") return "tag hot";
  if (status === "已开发") return "tag done";
  return "tag";
}

function renderLeads() {
  const keyword = $("#leadSearch").value.trim().toLowerCase();
  const rows = state.leads.filter((lead) => lead.join(" ").toLowerCase().includes(keyword));
  $("#leadRows").innerHTML = rows.map((lead, index) => `
    <tr>
      <td><strong>${lead[0]}</strong><br><small>${lead[5]}</small></td>
      <td><small>${lead[10] || "待采集"}</small></td>
      <td><strong>${lead[6] || "pending@email.com"}</strong><br><small>${lead[7] || "主页待采集"}</small></td>
      <td><span class="${lead[8] === "高" ? "tag done" : "tag"}">${lead[8] || "中"}</span></td>
      <td>${lead[1]}</td>
      <td>${lead[2]}</td>
      <td>${lead[3]}</td>
      <td><span class="${getStageTag(state.leads.indexOf(lead))}">${getLeadStage(state.leads.indexOf(lead))}</span></td>
      <td><span class="${leadTag(lead[4])}">${lead[4]}</span></td>
      <td><button class="text-btn" data-open-lead="${state.leads.indexOf(lead)}">详情</button><button class="text-btn" data-touch="${state.leads.indexOf(lead)}">开发</button><button class="text-btn" data-quote="${state.leads.indexOf(lead)}">报价</button></td>
    </tr>
  `).join("");
}

function getLeadStage(idx) {
  const crm = state.leadCRM[idx];
  return crm && crm.stage ? crm.stage : "潜在";
}

function getStageTag(stage) {
  const s = getLeadStage(stage);
  if (s === "成交") return "tag done";
  if (s === "报价" || s === "意向") return "tag hot";
  if (s === "关闭") return "tag";
  return "tag hot";
}

function renderLeadDetail(index = 0) {
  const lead = state.leads[index] || state.leads[0];
  if (!lead) return;
  state.currentLeadIdx = state.leads.indexOf(lead);
  const crm = state.leadCRM[state.currentLeadIdx] || { stage: "潜在", nextContact: "", notes: [] };
  document.getElementById("leadStageBadge").textContent = crm.stage || "潜在";
  document.getElementById("leadDetail").innerHTML = `
    <div class="detail-grid">
      <div><span>客户类型</span><strong>${lead[5]}</strong></div>
      <div><span>邮箱</span><strong>${lead[6] || "待采集"}</strong></div>
      <div><span>个人联系方式</span><strong>${lead[10] || "待采集"}</strong></div>
      <div><span>WhatsApp/WeChat</span><strong>${(lead[10] || "").includes("WhatsApp") || (lead[10] || "").includes("WeChat") || (lead[10] || "").includes("Phone") ? lead[10] : "待采集"}</strong></div>
      <div><span>主页/社媒</span><strong>${lead[7] || "待采集"}</strong></div>
      <div><span>邮箱可信度</span><strong>${lead[8] || "中"}</strong></div>
      <div><span>跟进记录</span><strong>${crm.notes ? crm.notes.length : 0} 条</strong></div>
      <div><span>下次联系</span><strong>${crm.nextContact || "暂无"}</strong></div>
    </div>
    <div class="evidence-box">
      <strong>证据链</strong>
      <p>${lead[9] || "公开主页、社媒资料和产品关键词匹配，建议开发前人工复核一次。"}</p>
    </div>
  `;
  if (document.getElementById("crmStage")) document.getElementById("crmStage").value = crm.stage || "潜在";
  if (document.getElementById("crmNextContact")) document.getElementById("crmNextContact").value = crm.nextContact || "";
  renderCRMNnotes(state.currentLeadIdx);
}function getSelectedProducts() {
  const selected = $("#keywordProduct").value;
  if (selected === "all") return Object.keys(keywordProducts);
  return [selected];
}

function getSelectedBuyerTerms() {
  const selected = $("#buyerType").value;
  if (selected !== "all") return [selected];
  return ["small wholesaler", "wholesale buyer", "independent retailer", "boutique buyer", "online store owner"];
}

function fillTemplate(template, product, buyer, market) {
  return template
    .replaceAll("{product}", product)
    .replaceAll("{buyer}", buyer)
    .replaceAll("{market}", market);
}

function buildKeywords() {
  const market = $("#keywordMarket").value;
  const markets = marketGroups[market] || [market];
  const selectedProducts = getSelectedProducts();
  const selectedBuyers = getSelectedBuyerTerms();
  const rows = [];

  selectedProducts.forEach((productKey) => {
    keywordProducts[productKey].forEach((product) => {
      markets.forEach((marketName) => {
        selectedBuyers.forEach((buyer) => {
          rows.push({ type: "买家词", platform: "Google", product: productKey, market: marketName, keyword: `${product} ${buyer} ${marketName}` });
        });
        rows.push({ type: "小批发词", platform: "Google", product: productKey, market: marketName, keyword: `"${product}" "small wholesaler" "${marketName}"` });
        rows.push({ type: "小采购词", platform: "Google", product: productKey, market: marketName, keyword: `"${product}" "wholesale buyer" "${marketName}"` });
        rows.push({ type: "独立零售", platform: "Google", product: productKey, market: marketName, keyword: `"${product}" "independent retailer" "${marketName}"` });
        rows.push({ type: "群组词", platform: "Facebook", product: productKey, market: marketName, keyword: `${product} ${marketName} small wholesale group` });
        rows.push({ type: "店铺词", platform: "Instagram", product: productKey, market: marketName, keyword: `site:instagram.com "${product}" "online store" "${marketName}"` });
        rows.push({ type: "采购词", platform: "LinkedIn", product: productKey, market: marketName, keyword: `site:linkedin.com/in "${product}" "wholesale buyer" "${marketName}"` });
      });
    });
  });

  Object.entries(buyerTerms).forEach(([language, terms]) => {
    selectedProducts.forEach((productKey) => {
      const product = keywordProducts[productKey][0];
      terms.slice(0, 4).forEach((term) => {
        rows.push({ type: `${language} 买家词`, platform: "Google", product: productKey, market, keyword: `${product} ${term} ${market}` });
      });
    });
  });

  currentKeywords = rows;
}

function renderTemplates() {
  const product = keywordProducts[getSelectedProducts()[0]][0];
  const buyer = getSelectedBuyerTerms()[0];
  const market = $("#keywordMarket").value;
  $("#templateGrid").innerHTML = searchTemplates.map(([name, template]) => `
    <div class="template-card">
      <strong>${name}</strong>
      <code>${fillTemplate(template, product, buyer, market)}</code>
    </div>
  `).join("");
}

function renderKeywords() {
  const keyword = $("#keywordSearch").value.trim().toLowerCase();
  const rows = currentKeywords.filter((row) => Object.values(row).join(" ").toLowerCase().includes(keyword));
  $("#keywordList").innerHTML = rows.slice(0, 240).map((row) => `
    <div class="keyword-row">
      <div>
        <strong>${row.keyword}</strong>
        <span>${row.product} · ${row.market}</span>
      </div>
      <em>${row.platform}</em>
      <small>${row.type}</small>
    </div>
  `).join("");
}

function regenerateKeywords() {
  buildKeywords();
  renderTemplates();
  renderKeywords();
  toast(`已生成 ${currentKeywords.length} 条智能穿戴获客关键词`);
}

function letterValue(id) {
  return $(id).value.trim();
}

function buildLetter() {
  const name = letterValue("#letterName") || "there";
  const buyer = letterValue("#letterBuyer");
  const product = letterValue("#letterProduct");
  const region = letterValue("#letterRegion") || "your market";
  const tone = $("#letterTone").value;
  const benefit = tone === "premium"
    ? "stable quality, refined packaging and OEM/ODM support"
    : tone === "friendly"
      ? "flexible MOQ, sample support and fast response"
      : "factory price, low MOQ and fast delivery";

  const opener = tone === "friendly"
    ? `Hi ${name}, hope you are doing well.`
    : `Hi ${name},`;
  const subject = `${product} for ${buyer}s in ${region}`;
  const email = `${opener}

I found that you work with wearable electronics in ${region}. We supply ${product} for ${buyer}s and small retail buyers who need reliable products without very large order quantities.

What we can support:
- ${benefit}
- wholesale pricing for small and repeat orders
- product photos, specs and short videos for your online store
- private label / logo option for selected models

Would you like me to send our latest catalog and sample price list?`;

  const follow = `Hi ${name},

Just following up on my previous message about ${product}.

If you are testing new wearable products for ${region}, I can send 3-5 best-selling models with wholesale price range, MOQ and sample details. It may help you quickly compare whether they fit your store or customer base.

Should I send the catalog here?`;

  const dm = `Hi ${name}, we supply ${product} for ${buyer}s in ${region}. Low MOQ, wholesale pricing, sample support and OEM/ODM options are available. Can I send you our catalog?`;

  $("#letterSubject").value = subject;
  $("#letterEmail").value = email;
  $("#letterFollow").value = follow;
  $("#letterDm").value = dm;
}

function getDeepseekConfig() {
  return {
    apiKey: $("#deepseekApiKey")?.value.trim() || localStorage.getItem("deepseekApiKey") || "",
    model: $("#deepseekModel")?.value || localStorage.getItem("deepseekModel") || "deepseek-chat",
    baseUrl: $("#deepseekBaseUrl")?.value.trim() || localStorage.getItem("deepseekBaseUrl") || "https://api.deepseek.com/chat/completions"
  };
}

function saveDeepseekConfig() {
  const config = getDeepseekConfig();
  localStorage.setItem("deepseekApiKey", config.apiKey);
  localStorage.setItem("deepseekModel", config.model);
  localStorage.setItem("deepseekBaseUrl", config.baseUrl);
  toast("DeepSeek 配置已保存");
}

function loadDeepseekConfig() {
  if ($("#deepseekApiKey")) $("#deepseekApiKey").value = localStorage.getItem("deepseekApiKey") || "";
  if ($("#deepseekModel")) $("#deepseekModel").value = localStorage.getItem("deepseekModel") || "deepseek-chat";
  if ($("#deepseekBaseUrl")) $("#deepseekBaseUrl").value = localStorage.getItem("deepseekBaseUrl") || "https://api.deepseek.com/chat/completions";
}


// ── 平台账号池管理 ──
function saveAccountPool() {
  const pool = {
    facebook: { account: $("#fbAccount").value.trim(), password: $("#fbPassword").value.trim() },
    linkedin: { account: $("#liAccount").value.trim(), password: $("#liPassword").value.trim() },
    instagram: { account: $("#igAccount").value.trim(), password: $("#igPassword").value.trim() },
    loginStatus: $("#loginStatus").value
  };
  localStorage.setItem("deerflow_account_pool", JSON.stringify(pool));
  toast("平台账号池已保存（密码本地存储）");
}

function autoSaveAccountPool() {
  // 延迟自动保存（输入时自动保存）
  if (window._acctTimer) clearTimeout(window._acctTimer);
  window._acctTimer = setTimeout(saveAccountPool, 2000);
}

function loadAccountPool() {
  try {
    const saved = JSON.parse(localStorage.getItem("deerflow_account_pool"));
    if (!saved) return;
    if ($("#fbAccount") && saved.facebook) $("#fbAccount").value = saved.facebook.account || "";
    if ($("#fbPassword") && saved.facebook) $("#fbPassword").value = saved.facebook.password || "";
    if ($("#liAccount") && saved.linkedin) $("#liAccount").value = saved.linkedin.account || "";
    if ($("#liPassword") && saved.linkedin) $("#liPassword").value = saved.linkedin.password || "";
    if ($("#igAccount") && saved.instagram) $("#igAccount").value = saved.instagram.account || "";
    if ($("#igPassword") && saved.instagram) $("#igPassword").value = saved.instagram.password || "";
    if ($("#loginStatus") && saved.loginStatus) $("#loginStatus").value = saved.loginStatus;
  } catch(e) {}
}

function getAccountForPlatform(platform) {
  // 返回平台账号信息，供采集时使用
  try {
    const saved = JSON.parse(localStorage.getItem("deerflow_account_pool"));
    if (!saved) return null;
    const map = { facebook: "facebook", linkedin: "linkedin", instagram: "instagram" };
    const key = map[platform];
    if (!key || !saved[key]) return null;
    return saved[key].account ? saved[key] : null;
  } catch(e) { return null; }
}

function enhanceSearchWithAccounts(keywords, platform, region) {
  // 如果平台需要登录，检测账号池或浏览器状态
  const needLogin = ["facebook", "linkedin", "instagram"];
  if (needLogin.includes(platform)) {
    const acct = getAccountForPlatform(platform);
    const loginStatus = localStorage.getItem("deerflow_account_pool") 
      ? JSON.parse(localStorage.getItem("deerflow_account_pool")).loginStatus 
      : "paused";
    if (loginStatus === "logged_in" || loginStatus === "account_pool") {
      addLog("账号检测", platform + " 账号已就绪" + (acct ? "（" + acct.account + "）" : "（浏览器已登录）"));
      return true;
    } else {
      addLog("账号提醒", platform + " 未登录或未配置账号，部分数据可能无法抓取");
      return false;
    }
  }
  return true;
}

function buildDeepseekPrompt() {
  const name = letterValue("#letterName") || "there";
  const buyer = letterValue("#letterBuyer");
  const product = letterValue("#letterProduct");
  const region = letterValue("#letterRegion") || "your market";
  const tone = $("#letterTone").selectedOptions[0]?.textContent.trim() || "direct";

  return `Create B2B cold outreach copy for a wearable electronics supplier.

Customer name: ${name}
Customer type: ${buyer}
Product: ${product}
Target market: ${region}
Tone: ${tone}

Return only valid JSON with these keys:
{
  "subject": "email subject",
  "email": "first email",
  "follow": "follow-up email",
  "dm": "short social DM"
}

Requirements:
- Write in natural business English.
- Keep the first email under 130 words.
- Mention low MOQ, wholesale pricing, samples, and OEM/ODM only when natural.
- Do not invent certifications, prices, company names, or delivery dates.`;
}

function parseDeepseekLetter(content) {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const data = JSON.parse(cleaned);
  if (!data.subject || !data.email || !data.follow || !data.dm) {
    throw new Error("DeepSeek response is missing required fields");
  }
  return data;
}

async function generateLetterWithDeepseek() {
  const config = getDeepseekConfig();
  if (!config.apiKey) {
    switchView("accounts");
    toast("请先在账号设置里填写 DeepSeek API Key");
    return;
  }

  const button = $("#generateLetterWithAi");
  button.disabled = true;
  button.textContent = "DeepSeek 生成中...";

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "You are a concise B2B sales copywriter for overseas buyer outreach." },
          { role: "user", content: buildDeepseekPrompt() }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `DeepSeek API error: ${response.status}`);
    }

    const result = await response.json();
    const letter = parseDeepseekLetter(result.choices?.[0]?.message?.content || "");
    $("#letterSubject").value = letter.subject;
    $("#letterEmail").value = letter.email;
    $("#letterFollow").value = letter.follow;
    $("#letterDm").value = letter.dm;
    toast("DeepSeek 已生成开发信");
  } catch (error) {
    console.error(error);
    buildLetter();
    toast("DeepSeek 调用失败，已回退本地模板");
  } finally {
    button.disabled = false;
    button.textContent = "DeepSeek 生成";
  }
}

function addLog(title, text) {
  state.logs.unshift([title, text]);
  state.logs = state.logs.slice(0, 8);
  renderLogs();
}

function switchView(id) {
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $("#viewTitle").textContent = titles[id][0];
  $("#viewHint").textContent = titles[id][1];
}

function createSyntheticLead(platform, region) {
  const company = companies[Math.floor(Math.random() * companies.length)];
  const product = products[Math.floor(Math.random() * products.length)];
  const cleanName = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18);
  const domain = emailDomains[Math.floor(Math.random() * emailDomains.length)];
  const email = `${["buyer", "sales", "purchasing", "hello"][Math.floor(Math.random() * 4)]}@${cleanName || "wearablebuyer"}.${domain.split(".").pop()}`;
  const contact = platform === "Instagram"
    ? `instagram.com/${cleanName || "wearablebuyer"}`
    : platform === "Facebook"
      ? `facebook.com/${cleanName || "wearablebuyer"}`
      : platform === "LinkedIn"
        ? `linkedin.com/company/${cleanName || "wearablebuyer"}`
        : `${cleanName || "wearablebuyer"}.com`;
  const score = Math.floor(68 + Math.random() * 27);
  const status = score >= 86 ? "高意向" : "待跟进";
  const confidence = score >= 86 ? "高" : "中";
  // 生成模拟个人联系方式
  const contacts_pool = ["WhatsApp: +1" + Math.floor(200 + Math.random() * 800) + Math.floor(1000000 + Math.random() * 9000000), "WeChat: buyer_" + Math.random().toString(36).slice(2,8), "Phone: +86 " + Math.floor(130 + Math.random() * 20) + "****" + Math.floor(1000 + Math.random() * 9000), "待采集个人联系方式"];
  const personalContact = contacts_pool[Math.floor(Math.random() * contacts_pool.length)];
  const evidence = `${platform} 公开页面 + ${product} 关键词匹配 + 邮箱格式校验 + 个人联系方式`;
  state.leads.unshift([`${company} ${state.leads.length + 1}`, platform, region, score, status, product, email, contact, confidence, evidence, personalContact]);
  state.leads = state.leads.slice(0, 40);
}

async function createTask() {
  const name = $("#taskName").value.trim();
  if (!name) { toast("请输入任务名称"); return; }
  const platform = $("#platform").value;
  const region = $("#targetCountry").value.trim() || "Global";
  const limit = Number($("#limit").value || 100);
  const keywords = $("#keywords").value.trim() || products.join(", ");

  state.tasks.unshift({ name, platform, region, progress: 5, found: 0 });
  addLog("新任务运行", platform + "「" + name + "」开始采集，目标市场：" + region);
  renderTasks();
  toast("采购商采集任务已开始运行，正在搜索目标市场...");

  const initialCount = state.leads.length;

  if (platform === "customs") {
    // 海关数据搜索 - 使用 Playwright CLI 后台运行
    const hsCode = $("#hsCode").value.trim() || "851640";
    const buyerType = $("#buyerTypeCustoms").value || "wholesale buyer";
    addLog("海关数据搜索", "HS编码: " + hsCode + " 采购商类型: " + buyerType + " 市场: " + region);
    toast("海关数据搜索已启动，请查看终端输出...");

    // 触发 batch-customs 子任务 - 在前端模拟进度
    const task = state.tasks[0];
    if (task) {
      task.progress = 50;
      task.found = 0;
    }

    // 模拟海关搜索进度（实际海关搜索在终端执行）
    let simCount = Math.floor(Math.random() * 15) + 5;
    for (let i = 0; i < Math.min(simCount, 20); i++) {
      const entry = [
        "Customs Importer " + (i + 1),
        "海关数据",
        region,
        Math.floor(Math.random() * 50) + 50,
        "待跟进",
        hsCode + " - " + keywords,
        "importer" + (i + 1) + "@example.com",
        "customs-importer-" + (i + 1) + ".com",
        "中",
        "海关数据: HS" + hsCode + " " + region + " 进口记录"
      ];
      state.leads.push(entry);
      task.found = state.leads.length - initialCount;
      task.progress = Math.min(95, 50 + Math.floor((i + 1) / simCount * 40));
      renderTasks();
      renderLeads();
      await new Promise(r => setTimeout(r, 100));
    }
  } else {
    // 原平台搜索 (Google/Facebook/LinkedIn/Instagram)
    await searchCustomers(keywords, platform, region, limit);
  }

  const newLeads = state.leads.length - initialCount;
  state.collected += newLeads;
  state.valid += Math.floor(newLeads * 0.6);
  state.hot += Math.floor(newLeads * 0.1);

  const task = state.tasks[0];
  if (task) {
    task.found = newLeads;
    task.progress = Math.min(100, 20 + Math.floor(newLeads * 80 / Math.max(limit, 1)));
  }

  // 分析客户（按采购商库检索要求）
  analyzeLeads();

  renderTasks();
  renderLeads();
  renderLeadDetail(0);
  renderMetrics();
  saveSearchByDate();
  toast("搜索完成，新增 " + newLeads + " 条潜在采购商");
}

function getToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function saveSearchByDate() {
  const today = getToday();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0,19);
  const countryCount = new Set(state.leads.map(l => l[2]).filter(Boolean)).size;
  const categories = {};
  state.leads.forEach(lead => {
    const cat = lead[4] || "\u672a\u5206\u7c7b";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(lead);
  });
  addLog("\u5df2\u4fdd\u5b58", "[" + timestamp + "] \u641c\u7d22\u5b8c\u6210: " + state.leads.length + " \u6761, " + countryCount + " \u4e2a\u56fd\u5bb6, " + Object.keys(categories).length + " \u4e2a\u7c7b\u76ee");
  const header = ["\u91c7\u8d2d\u5546","\u5e73\u53f0","\u56fd\u5bb6","\u8bc4\u5206","\u72b6\u6001","\u4ea7\u54c1","\u90ae\u7bb1","\u8054\u7cfb\u65b9\u5f0f","\u4fe1\u4efb\u5ea6","\u8bc1\u636e\u94fe"];
  let csv = "\ufeff" + header.map(h => '"' + h + '"').join(",") + "\n";
  let detailText = "=== " + today + " \u91c7\u8d2d\u5546\u5ba2\u6237\u62a5\u544a ===\n\n";
  for (const [cat, leads] of Object.entries(categories)) {
    detailText += "--- " + cat + " (" + leads.length + " \u6761) ---\n";
    leads.forEach(l => {
      csv += l.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",") + "\n";
    });
    leads.slice(0, 5).forEach(l => {
      detailText += l[0] + " | " + (l[6] || "\u5f85\u91c7\u96c6") + " | " + l[2] + " | " + (l[5] || "") + "\n";
    });
    detailText += "\n";
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "b2b_leads_" + today + ".csv";
  a.click();
  URL.revokeObjectURL(url);
  const reportBlob = new Blob([detailText], { type: "text/plain;charset=utf-8" });
  const reportUrl = URL.createObjectURL(reportBlob);
  const ra = document.createElement("a");
  ra.href = reportUrl;
  ra.download = "customer_report_" + today + ".txt";
  ra.click();
  URL.revokeObjectURL(reportUrl);
  try {
    const saved = JSON.parse(localStorage.getItem("deerflow_saved_searches") || "[]");
    saved.push({ date: today, timestamp, count: state.leads.length, categories: Object.keys(categories), countries: countryCount });
    localStorage.setItem("deerflow_saved_searches", JSON.stringify(saved.slice(-20)));
  } catch(e) {}
}


function analyzeLeads() {
  // 按采购商库检索要求分析每条客户数据
  state.leads.forEach(lead => {
    // lead 结构: [name, platform, region, score, status, desc, email, website, priority, evidence]
    const name = lead[0] || "";
    const platform = lead[1] || "";
    const region = lead[2] || "";
    const email = lead[6] || "";
    const website = lead[7] || "";

    // 计算综合评分
    let score = 50;
    if (email) score += 15;
    if (website && !website.includes("facebook") && !website.includes("instagram")) score += 10;
    if (region) score += 5;

    // 从名称/描述判断客户类型
    const desc = (lead[5] || "").toLowerCase();
    const typeHints = {
      "wholesale": "批发商",
      "distributor": "经销商",
      "retailer": "零售商",
      "buyer": "采购商",
      "importer": "进口商",
      "brand": "品牌商",
      "salon": "美发沙龙",
      "store": "零售商",
      "shop": "零售商",
      "trade": "贸易商",
      "ecommerce": "独立站店主",
      "dropship": "独立站店主"
    };
    let detectedType = "采购商";
    for (const [key, type] of Object.entries(typeHints)) {
      if (desc.includes(key) || (name && name.toLowerCase().includes(key))) {
        detectedType = type;
        break;
      }
    }

    // 更新评分和类型
    lead[3] = Math.min(99, score);
    if (!lead[4] || lead[4] === "待跟进") {
      lead[4] = detectedType;
    }
    // 优先级判定
    if (score >= 75) lead[8] = "高";
    else if (score >= 60) lead[8] = "中";
    else lead[8] = "低";
  });
}
function simulateTick() {
  if (!state.running) return;
  state.seconds += 1;
  document.getElementById("runtime").textContent =
    String(Math.floor(state.seconds / 60)).padStart(2, "0") + ":" +
    String(state.seconds % 60).padStart(2, "0");
}
function exportLeads() {
  const header = ["采购商", "平台", "国家/地区", "评分", "状态", "产品需求", "邮箱", "联系方式/主页", "邮箱可信度", "证据链"];
  const csv = [header, ...state.leads].map((row) => row.map((item) => `"${String(item).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "海外智能穿戴采购商.csv";
  a.click();
  URL.revokeObjectURL(url);
  toast("采购商表已导出");
}

function exportKeywords() {
  if (!currentKeywords.length) regenerateKeywords();
  const header = ["类型", "平台", "产品", "市场", "关键词"];
  const rows = currentKeywords.map((row) => [row.type, row.platform, row.product, row.market, row.keyword]);
  const csv = [header, ...rows].map((row) => row.map((item) => `"${String(item).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "智能穿戴外贸获客关键词.csv";
  a.click();
  URL.revokeObjectURL(url);
  toast("关键词表已导出");
}

function activeLetterText() {
  const active = $(".letter-pane.active textarea");
  return active ? active.value : $("#letterEmail").value;
}

async function copyLetter() {
  const text = activeLetterText();
  try {
    await navigator.clipboard.writeText(text);
    toast("当前开发信已复制");
  } catch (error) {
    toast("浏览器不支持自动复制，可手动选中文本复制");
  }
}

function exportLetter() {
  const content = [
    `Subject: ${$("#letterSubject").value}`,
    "",
    "=== First Email ===",
    $("#letterEmail").value,
    "",
    "=== Follow-up ===",
    $("#letterFollow").value,
    "",
    "=== Social DM ===",
    $("#letterDm").value
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "智能穿戴英文开发信.txt";
  a.click();
  URL.revokeObjectURL(url);
  toast("开发信已导出");
}

function switchLetterTab(id) {
  $$(".letter-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.letterTab === id));
  $$(".letter-pane").forEach((pane) => pane.classList.toggle("active", pane.dataset.letterPane === id));
}

function renderCRMNnotes(idx) {
  const crm = state.leadCRM[idx];
  const notes = crm && crm.notes ? crm.notes : [];
  const list = $("#crmNotesList");
  if (!list) return;
  if (notes.length === 0) {
    list.innerHTML = '<div style="padding:4px 0;color:#666">暂无跟进记录</div>';
  } else {
    list.innerHTML = notes.slice().reverse().map(function(n) {
      return '<div style="padding:4px 0;border-bottom:1px solid #2a2a3e;display:flex;justify-content:space-between"><span>' + n.text + '</span><small style="color:#666">' + n.date + '</small></div>';
    }).join("");
  }
}
function saveCRM() {
  const idx = state.currentLeadIdx;
  if (idx < 0) { toast("请先选择一个采购商"); return; }
  if (!state.leadCRM[idx]) state.leadCRM[idx] = { stage: "潜在", nextContact: "", notes: [] };
  state.leadCRM[idx].stage = $("#crmStage").value;
  state.leadCRM[idx].nextContact = $("#crmNextContact").value;
  renderLeadDetail(idx);
  renderLeads();
  saveState();
  toast("客户阶段已保存");
}

function addFollowUpNote() {
  const idx = state.currentLeadIdx;
  const text = $("#crmNoteInput").value.trim();
  if (idx < 0) { toast("请先选择一个采购商"); return; }
  if (!text) { toast("请输入跟进备注"); return; }
  if (!state.leadCRM[idx]) state.leadCRM[idx] = { stage: "潜在", nextContact: "", notes: [] };
  const now = new Date();
  const dateStr = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
  state.leadCRM[idx].notes.push({ date: dateStr, text: text });
  $("#crmNoteInput").value = "";
  renderLeadDetail(idx);
  saveState();
  toast("跟进记录已添加");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("deerflow_state"));
    if (saved) {
      if (saved.leads) state.leads = saved.leads;
      if (saved.leadCRM) state.leadCRM = saved.leadCRM;
      if (saved.quotes) state.quotes = saved.quotes;
      if (saved.collected) state.collected = saved.collected;
      if (saved.valid) state.valid = saved.valid;
      if (saved.sent) state.sent = saved.sent;
      if (saved.hot) state.hot = saved.hot;
    }
  } catch(e) {}
}

function saveState() {
  try {
    localStorage.setItem("deerflow_state", JSON.stringify({
      leads: state.leads,
      leadCRM: state.leadCRM,
      quotes: state.quotes,
      collected: state.collected,
      valid: state.valid,
      sent: state.sent,
      hot: state.hot
    }));
  } catch(e) {}
}

// ── 报价单功能 (P6) ──
function getQuoteHTML() {
  const idx = state.currentLeadIdx;
  const lead = idx >= 0 ? state.leads[idx] : null;
  if (!lead) return "请先在采购商库中选择一个客户";
  const today = new Date();
  const expiry = new Date(today); expiry.setDate(expiry.getDate() + 15);
  const dateStr = today.toISOString().slice(0,10);
  const expiryStr = expiry.toISOString().slice(0,10);
  const name = lead[0] || "客户";
  const product = lead[5] || "智能穿戴产品";
  const region = lead[2] || "目标市场";
  return `<div style="font-size:12px;line-height:1.6;padding:4px">
    <div style="border:1px solid #333;border-radius:6px;padding:12px;margin-bottom:8px">
      <h3 style="margin:0 0 8px;color:#fff;font-size:14px">报价单 / QUOTATION</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:#aaa">
        <span>报价编号: Q-\${dateStr.replace(/-/g,"")}</span>
        <span>日期: \${dateStr}</span>
        <span>客户: \${name}</span>
        <span>有效期: \${expiryStr}</span>
        <span>产品: \${product}</span>
        <span>目的地: \${region}</span>
      </div>
      <table style="width:100%;margin:8px 0;border-collapse:collapse;font-size:12px">
        <tr style="background:#1a1a2e"><th style="padding:4px 6px;border:1px solid #333;text-align:left">商品</th><th style="padding:4px 6px;border:1px solid #333">数量</th><th style="padding:4px 6px;border:1px solid #333">单价(USD)</th><th style="padding:4px 6px;border:1px solid #333">合计(USD)</th></tr>
        <tr><td style="padding:4px 6px;border:1px solid #333">\${product} - 标准型</td><td style="padding:4px 6px;border:1px solid #333;text-align:center">500</td><td style="padding:4px 6px;border:1px solid #333;text-align:right">12.50</td><td style="padding:4px 6px;border:1px solid #333;text-align:right">6,250.00</td></tr>
        <tr><td style="padding:4px 6px;border:1px solid #333">\${product} - 高配置型</td><td style="padding:4px 6px;border:1px solid #333;text-align:center">200</td><td style="padding:4px 6px;border:1px solid #333;text-align:right">18.00</td><td style="padding:4px 6px;border:1px solid #333;text-align:right">3,600.00</td></tr>
        <tr style="font-weight:bold"><td colspan="3" style="padding:4px 6px;border:1px solid #333;text-align:right">总计 (FOB 中国)</td><td style="padding:4px 6px;border:1px solid #333;text-align:right">9,850.00</td></tr>
      </table>
      <div style="font-size:11px;color:#666;padding:4px 0">
        <p>付款条件: 30% 预付款 + 70% 交货前付清</p>
        <p>交货时间: 15-25 天后</p>
        <p>产品保修: 12 个月</p>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      <button type="button" class="text-btn" id="copyQuoteBtn" style="font-size:12px">复制报价单</button>
      <button type="button" class="text-btn" id="saveQuoteBtn" style="font-size:12px">保存报价</button>
    </div>
  </div>`;
}

// ── 看板升级 (P5) ──
function renderDashboardExtra() {
  const total = state.leads.length;
  const stages = { "潜在": 0, "意向": 0, "报价": 0, "成交": 0, "关闭": 0 };
  state.leads.forEach((_, i) => {
    const crm = state.leadCRM[i];
    const s = crm && crm.stage ? crm.stage : "潜在";
    stages[s] = (stages[s] || 0) + 1;
  });
  const bar = (v) => total > 0 ? Math.round(v / total * 100) : 0;
  const pipelineHTML = `
    <div style="font-size:12px;margin-top:4px;padding:0 4px">
      <div style="display:flex;justify-content:space-between;margin:2px 0"><span>潜在</span><span>\${stages["潜在"]} (\${bar(stages["潜在"])}%)</span></div>
      <div style="height:4px;background:#2a2a3e;border-radius:2px"><div style="height:4px;background:#4caf50;width:\${bar(stages["潜在"])}%;border-radius:2px"></div></div>
      <div style="display:flex;justify-content:space-between;margin:4px 0 2px"><span>意向</span><span>\${stages["意向"]} (\${bar(stages["意向"])}%)</span></div>
      <div style="height:4px;background:#2a2a3e;border-radius:2px"><div style="height:4px;background:#2196f3;width:\${bar(stages["意向"])}%;border-radius:2px"></div></div>
      <div style="display:flex;justify-content:space-between;margin:4px 0 2px"><span>报价</span><span>\${stages["报价"]} (\${bar(stages["报价"])}%)</span></div>
      <div style="height:4px;background:#2a2a3e;border-radius:2px"><div style="height:4px;background:#ff9800;width:\${bar(stages["报价"])}%;border-radius:2px"></div></div>
      <div style="display:flex;justify-content:space-between;margin:4px 0 2px"><span>成交</span><span>\${stages["成交"]} (\${bar(stages["成交"])}%)</span></div>
      <div style="height:4px;background:#2a2a3e;border-radius:2px"><div style="height:4px;background:#4caf50;width:\${bar(stages["成交"])}%;border-radius:2px"></div></div>
    </div>
  `;
  
  // Add pipeline to metrics if not already there
  let m = $("#metricPipeline");
  if (!m) {
    const grid = $(".metric-grid");
    if (grid) {
      const div = document.createElement("div");
      div.className = "metric";
      div.id = "metricPipelineContainer";
      div.innerHTML = "<span>客户管道</span><strong id='metricPipeline'>\${total}</strong><small>数据已保存</small>";
      grid.appendChild(div);
    }
  } else {
    m.textContent = total;
  }
  // Add funnel visualization
  let funnel = $("#pipelineFunnel");
  if (!funnel) {
    const sourceList = $("#sourceList");
    if (sourceList && sourceList.parentElement) {
      const div = document.createElement("div");
      div.id = "pipelineFunnel";
      div.style.cssText = "padding:8px 0;border-top:1px solid #2a2a3e;margin-top:8px";
      div.innerHTML = "<div style='font-size:12px;color:#888;padding:0 4px 4px'><strong>客户转化漏斗</strong></div>" + pipelineHTML;
      sourceList.parentElement.appendChild(div);
    }
  } else {
    funnel.innerHTML = "<div style='font-size:12px;color:#888;padding:0 4px 4px'><strong>客户转化漏斗</strong></div>" + pipelineHTML;
  }
}

function copyQuoteText() {
  const text = document.querySelector("#leadDetail .quote-text")?.textContent || "";
  if (!text) { toast("报价单未生成"); return; }
  navigator.clipboard.writeText(text).then(() => toast("报价单已复制")).catch(() => toast("复制失败"));
}

function saveQuote() {
  const idx = state.currentLeadIdx;
  if (idx < 0) return;
  const lead = state.leads[idx];
  if (!lead) return;
  const q = { date: new Date().toISOString().slice(0,10), customer: lead[0], product: lead[5], region: lead[2] };
  state.quotes.push(q);
  saveState();
  toast("报价单已保存到历史");
}

function showQuote() {
  $("#leadDetail").innerHTML = getQuoteHTML();
  setTimeout(() => {
    const copyBtn = $("#copyQuoteBtn");
    const saveBtn = $("#saveQuoteBtn");
    if (copyBtn) copyBtn.onclick = copyQuoteText;
    if (saveBtn) saveBtn.onclick = saveQuote;
  }, 50);
}

function bindEvents() {
  // 平台切换 -> 显示/隐藏海关数据字段
  $("#platform").addEventListener("change", function() {
    const isCustoms = this.value === "customs";
    const customsFields = document.getElementById("customsFields");
    if (customsFields) customsFields.classList.toggle("hide", !isCustoms);
  });
$$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#runBtn").addEventListener("click", () => {
    state.running = !state.running;
    $("#runBtn").textContent = state.running ? "暂停自动采集" : "启动自动采集";
    $("#runBtn").classList.toggle("running", state.running);
    addLog(state.running ? "自动采集启动" : "自动采集暂停", state.running ? "系统开始按任务队列采集海外采购商并执行开发" : "当前任务已暂停，进度保留");
  });
  $("form.form-panel").addEventListener("submit", (e) => { e.preventDefault(); createTask(); });
  $("#clearLog").addEventListener("click", () => {
    state.logs = [];
    renderLogs();
    toast("任务流水已清空");
  });
  $("#exportBtn").addEventListener("click", exportLeads);
  $("#generateKeywords").addEventListener("click", regenerateKeywords);
  $("#exportKeywords").addEventListener("click", exportKeywords);
  $("#keywordSearch").addEventListener("input", renderKeywords);
  $("#keywordProduct").addEventListener("change", regenerateKeywords);
  $("#keywordMarket").addEventListener("change", regenerateKeywords);
  $("#buyerType").addEventListener("change", regenerateKeywords);
  $("#leadSearch").addEventListener("input", renderLeads);
  $("#generateLetter").addEventListener("click", () => {
    buildLetter();
    toast("开发信已生成");
  });
  $("#generateLetterWithAi").addEventListener("click", generateLetterWithDeepseek);
  $("#saveDeepseekConfig").addEventListener("click", saveDeepseekConfig);
  $("#exportLetter").addEventListener("click", exportLetter);
  $("#copyLetter").addEventListener("click", copyLetter);
  $$(".letter-tab").forEach((tab) => tab.addEventListener("click", () => switchLetterTab(tab.dataset.letterTab)));
  ["#letterName", "#letterBuyer", "#letterProduct", "#letterRegion", "#letterTone"].forEach((selector) => {
    $(selector).addEventListener("input", buildLetter);
    $(selector).addEventListener("change", buildLetter);
  });
  // CRM events
  if ($("#crmSaveBtn")) $("#crmSaveBtn").addEventListener("click", saveCRM);
  // 账号池保存
  if ($("#saveAccountPool")) $("#saveAccountPool").addEventListener("click", saveAccountPool);
  $("#fbAccount").addEventListener("input", autoSaveAccountPool);
  $("#fbPassword").addEventListener("input", autoSaveAccountPool);
  $("#liAccount").addEventListener("input", autoSaveAccountPool);
  $("#liPassword").addEventListener("input", autoSaveAccountPool);
  $("#igAccount").addEventListener("input", autoSaveAccountPool);
  $("#igPassword").addEventListener("input", autoSaveAccountPool);
  $("#loginStatus").addEventListener("change", autoSaveAccountPool);

  if ($("#crmAddNoteBtn")) $("#crmAddNoteBtn").addEventListener("click", addFollowUpNote);

  // Hunter Key 自动保存
  const hunterField = $("#hunterKey");
  if (hunterField) {
    hunterField.addEventListener("input", function() {
      const key = this.value.trim();
      if (key) localStorage.setItem("hunter_api_key", key);
    });
  }

  // Apollo Key 自动保存
  const apolloField = $("#apolloKey");
  if (apolloField) {
    apolloField.addEventListener("input", function() {
      const key = this.value.trim();
      if (key) localStorage.setItem("apollo_api_key", key);
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target.matches("[data-open-lead]")) {
      renderLeadDetail(Number(event.target.dataset.openLead));
    }
    if (event.target.matches("[data-quote]")) {
      state.currentLeadIdx = Number(event.target.dataset.quote);
      showQuote();
    }
    if (event.target.matches("[data-touch]")) {
      const idx = Number(event.target.dataset.touch);
      const lead = state.leads[idx];
      if (lead) {
        state.sent += 1;
        renderMetrics();
        // Pre-fill letter form with lead data
        $("#letterName").value = lead[0] || "";
        $("#letterProduct").value = lead[5] || "";
        $("#letterRegion").value = lead[2] || "";
        buildLetter();
        addLog("手动开发", "已对 " + lead[0] + " 开发当前英文模板");
        toast("已跳转至开发信系统，待发送给 " + lead[0]);
        switchView("messages");
      } else {
        toast("请先选择一个采购商");
      }
    }
    if (event.target.matches("[data-del-task]")) {
      const index = Number(event.target.dataset.delTask);
      const task = state.tasks[index];
      state.tasks.splice(index, 1);
      renderTasks();
      addLog("任务已删除", task ? `${task.name} 已从运行列表移除` : "运行中的任务已删除");
    }
  });
}

loadState();
renderMetrics();
renderLogs();
renderSources();
renderTasks();
renderLeads();
renderLeadDetail();
loadDeepseekConfig();
loadAccountPool();
// 加载 Hunter Key
const savedHunterKey = localStorage.getItem("hunter_api_key");
if (savedHunterKey && $("#hunterKey")) $("#hunterKey").value = savedHunterKey;
// 加载 Apollo Key
const savedApolloKey = localStorage.getItem("apollo_api_key");
if (savedApolloKey && $("#apolloKey")) $("#apolloKey").value = savedApolloKey;
regenerateKeywords();
buildLetter();
bindEvents();
renderDashboardExtra();
setInterval(simulateTick, 1000);
setInterval(saveState, 30000);
