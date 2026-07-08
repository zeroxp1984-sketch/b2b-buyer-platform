import { chromium } from "playwright";

const APP_URL = "http://localhost:5500"; // 你的应用地址，可按需修改

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("🚀 打开 B2B 采购商采集系统...");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  console.log("✅ 页面加载成功");

  // 1. 检查页面标题
  const title = await page.title();
  console.log(`📌 页面标题: ${title}`);

  // 2. 检查核心指标是否显示
  const metrics = await page.locator(".metric strong").allTextContents();
  console.log("📊 仪表盘指标:", metrics);

  // 3. 截图保存
  await page.screenshot({ path: "screenshots/dashboard.png", fullPage: true });
  console.log("📸 截图已保存到 screenshots/dashboard.png");

  // 4. 测试导航切换
  const navItems = ["tasks", "keywords", "leads", "messages", "accounts"];
  for (const item of navItems) {
    await page.click(`[data-view="${item}"]`);
    await page.waitForTimeout(300);
    const activeView = await page.locator(".view.active").getAttribute("id");
    console.log(`  导航 [${item}] → 视图 [#${activeView}] ${activeView === item ? "✅" : "❌"}`);
  }

  // 5. 测试关键操作按钮
  await page.click('[data-view="dashboard"]'); await page.waitForTimeout(200);
  const runBtn = page.locator("#runBtn");
  await runBtn.click(); await page.waitForTimeout(200);
  console.log(`  启动按钮文字: ${await runBtn.textContent()} ✅`);

  // 6. 测试任务创建区
  await page.click('[data-view="tasks"]'); await page.waitForTimeout(200);
  const taskInputs = await page.locator("form.form-panel input, form.form-panel select").count();
  console.log(`📋 任务表单字段数: ${taskInputs}`);

  // 7. 检查采购商列表
  await page.click('[data-view="leads"]'); await page.waitForTimeout(200);
  const leadRows = await page.locator("table tbody tr").count();
  console.log(`👥 采购商列表行数: ${leadRows}`);

  // 8. 检查开发信系统
  await page.click('[data-view="messages"]'); await page.waitForTimeout(200);
  const textareas = await page.locator(".letter-output textarea").count();
  console.log(`✉️ 开发信编辑器数量: ${textareas}`);

  await browser.close();
  console.log("\n🎉 所有测试完成！");
}

run().catch((err) => {
  console.error("❌ 测试失败:", err.message);
  process.exit(1);
});
