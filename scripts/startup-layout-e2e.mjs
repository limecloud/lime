/**
 * 启动排版诊断 E2E 测试
 *
 * 使用 Playwright MCP 测试应用启动时的排版稳定性
 * 检测 CLS (Cumulative Layout Shift) 和关键渲染时间点
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

interface LayoutShiftMetric {
  timestamp: number;
  value: number;
  sources: Array<{
    node: string;
    previousRect: { x: number; y: number; width: number; height: number };
    currentRect: { x: number; y: number; width: number; height: number };
  }>;
}

interface PerformanceMetrics {
  domContentLoaded: number;
  loadComplete: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  layoutShifts: LayoutShiftMetric[];
}

async function collectLayoutShifts(page: Page): Promise<LayoutShiftMetric[]> {
  return page.evaluate(() => {
    return new Promise<LayoutShiftMetric[]>((resolve) => {
      const shifts: LayoutShiftMetric[] = [];

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "layout-shift" && !(entry as any).hadRecentInput) {
            const layoutShiftEntry = entry as any;
            shifts.push({
              timestamp: entry.startTime,
              value: layoutShiftEntry.value,
              sources: (layoutShiftEntry.sources || []).map((source: any) => ({
                node: source.node?.nodeName || "unknown",
                previousRect: {
                  x: source.previousRect.x,
                  y: source.previousRect.y,
                  width: source.previousRect.width,
                  height: source.previousRect.height,
                },
                currentRect: {
                  x: source.currentRect.x,
                  y: source.currentRect.y,
                  width: source.currentRect.width,
                  height: source.currentRect.height,
                },
              })),
            });
          }
        }
      });

      observer.observe({ type: "layout-shift", buffered: true });

      // 等待 3 秒后返回结果
      setTimeout(() => {
        observer.disconnect();
        resolve(shifts);
      }, 3000);
    });
  });
}

async function collectPerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
  const performanceTiming = await page.evaluate(() => {
    const timing = performance.timing;
    const navigationStart = timing.navigationStart;

    return {
      domContentLoaded: timing.domContentLoadedEventEnd - navigationStart,
      loadComplete: timing.loadEventEnd - navigationStart,
    };
  });

  const paintMetrics = await page.evaluate(() => {
    const entries = performance.getEntriesByType("paint");
    const result: Record<string, number> = {};

    for (const entry of entries) {
      result[entry.name] = entry.startTime;
    }

    return result;
  });

  const lcpMetric = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let lcp = 0;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as any;
        lcp = lastEntry.renderTime || lastEntry.loadTime;
      });

      observer.observe({ type: "largest-contentful-paint", buffered: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(lcp);
      }, 3000);
    });
  });

  const layoutShifts = await collectLayoutShifts(page);
  const cumulativeLayoutShift = layoutShifts.reduce((sum, shift) => sum + shift.value, 0);

  return {
    domContentLoaded: performanceTiming.domContentLoaded,
    loadComplete: performanceTiming.loadComplete,
    firstPaint: paintMetrics["first-paint"] || 0,
    firstContentfulPaint: paintMetrics["first-contentful-paint"] || 0,
    largestContentfulPaint: lcpMetric,
    cumulativeLayoutShift,
    layoutShifts,
  };
}

async function takeScreenshotSequence(page: Page, outputDir: string): Promise<void> {
  const timestamps = [0, 100, 200, 300, 500, 800, 1200, 2000];

  for (const delay of timestamps) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    await page.screenshot({
      path: `${outputDir}/startup-${delay}ms.png`,
      fullPage: false,
    });
  }
}

async function runStartupDiagnostics() {
  console.log("🚀 启动排版诊断 E2E 测试\n");

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // 启动浏览器
    console.log("1. 启动 Chrome 浏览器...");
    browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });

    page = await context.newPage();

    // 启用性能监控
    await page.evaluateOnNewDocument(() => {
      (window as any).__STARTUP_DIAGNOSTICS_ENABLED__ = true;
    });

    console.log("2. 导航到应用首页...");
    const startTime = Date.now();

    await page.goto("http://127.0.0.1:1420/?debug-startup&debug-layout-shift", {
      waitUntil: "domcontentloaded",
    });

    console.log("3. 等待应用加载完成...");

    // 等待 Splash 消失
    try {
      await page.waitForSelector('[data-testid="splash-screen"]', {
        state: "hidden",
        timeout: 2000,
      });
      console.log("   ✓ Splash 已消失");
    } catch {
      console.log("   ⚠ 未检测到 Splash 或已提前消失");
    }

    // 等待主应用渲染
    await page.waitForSelector('[data-lime-window-drag-region]', {
      state: "visible",
      timeout: 5000,
    });
    console.log("   ✓ 主应用已渲染");

    const loadTime = Date.now() - startTime;
    console.log(`   总加载时间: ${loadTime}ms\n`);

    // 收集性能指标
    console.log("4. 收集性能指标...");
    const metrics = await collectPerformanceMetrics(page);

    console.log("\n📊 性能指标:");
    console.log(`   DOM Content Loaded: ${metrics.domContentLoaded.toFixed(2)}ms`);
    console.log(`   Load Complete: ${metrics.loadComplete.toFixed(2)}ms`);
    console.log(`   First Paint: ${metrics.firstPaint.toFixed(2)}ms`);
    console.log(`   First Contentful Paint: ${metrics.firstContentfulPaint.toFixed(2)}ms`);
    console.log(`   Largest Contentful Paint: ${metrics.largestContentfulPaint.toFixed(2)}ms`);
    console.log(`   Cumulative Layout Shift: ${metrics.cumulativeLayoutShift.toFixed(4)}`);

    // 分析布局偏移
    console.log("\n📐 布局偏移分析:");
    if (metrics.layoutShifts.length === 0) {
      console.log("   ✓ 未检测到布局偏移");
    } else {
      console.log(`   ⚠ 检测到 ${metrics.layoutShifts.length} 次布局偏移:\n`);

      metrics.layoutShifts.forEach((shift, index) => {
        console.log(`   #${index + 1} @ ${shift.timestamp.toFixed(2)}ms`);
        console.log(`      Score: ${shift.value.toFixed(4)}`);
        console.log(`      Affected elements: ${shift.sources.length}`);

        shift.sources.forEach((source, sourceIndex) => {
          console.log(`      - ${source.node}`);
          console.log(`        Previous: ${source.previousRect.width}x${source.previousRect.height} @ (${source.previousRect.x}, ${source.previousRect.y})`);
          console.log(`        Current:  ${source.currentRect.width}x${source.currentRect.height} @ (${source.currentRect.x}, ${source.currentRect.y})`);
        });
        console.log();
      });
    }

    // CLS 评分标准
    console.log("\n🎯 CLS 评分:");
    if (metrics.cumulativeLayoutShift < 0.1) {
      console.log("   ✓ 优秀 (< 0.1)");
    } else if (metrics.cumulativeLayoutShift < 0.25) {
      console.log("   ⚠ 需要改进 (0.1 - 0.25)");
    } else {
      console.log("   ❌ 差 (> 0.25)");
    }

    // 检查控制台错误
    console.log("\n🔍 控制台检查:");
    const consoleLogs: Array<{ type: string; text: string }> = [];

    page.on("console", (msg) => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
      });
    });

    await page.waitForTimeout(1000);

    const errors = consoleLogs.filter((log) => log.type === "error");
    const warnings = consoleLogs.filter((log) => log.type === "warning");

    console.log(`   Errors: ${errors.length}`);
    console.log(`   Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log("\n   错误详情:");
      errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.text}`);
      });
    }

    // 截图序列
    console.log("\n📸 生成截图序列...");
    await page.goto("http://127.0.0.1:1420/?debug-startup&debug-layout-shift");
    await takeScreenshotSequence(page, "./screenshots");
    console.log("   ✓ 截图已保存到 ./screenshots/");

    // 生成报告
    console.log("\n📝 生成诊断报告...");
    const report = {
      timestamp: new Date().toISOString(),
      loadTime,
      metrics,
      consoleLogs: {
        errors: errors.length,
        warnings: warnings.length,
        errorDetails: errors.slice(0, 10),
      },
      recommendations: generateRecommendations(metrics),
    };

    const fs = await import("fs/promises");
    await fs.mkdir("./diagnostics", { recursive: true });
    await fs.writeFile(
      "./diagnostics/startup-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log("   ✓ 报告已保存到 ./diagnostics/startup-report.json");

    console.log("\n✅ 诊断完成!");

  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    throw error;
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

function generateRecommendations(metrics: PerformanceMetrics): string[] {
  const recommendations: string[] = [];

  if (metrics.cumulativeLayoutShift > 0.1) {
    recommendations.push(
      "CLS 分数过高,建议检查启动时的 CSS 变量注入时机和侧边栏显示逻辑",
    );
  }

  if (metrics.largestContentfulPaint > 2500) {
    recommendations.push(
      "LCP 过慢,建议优化关键资源加载顺序或延长 Splash 显示时间",
    );
  }

  if (metrics.layoutShifts.length > 3) {
    recommendations.push(
      `检测到 ${metrics.layoutShifts.length} 次布局偏移,建议为关键元素设置固定尺寸或使用 skeleton`,
    );
  }

  const earlyShifts = metrics.layoutShifts.filter((shift) => shift.timestamp < 1000);
  if (earlyShifts.length > 0) {
    recommendations.push(
      "启动前 1 秒内发生布局偏移,建议在 HTML 中预注入关键 CSS 变量",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("启动性能良好,无需优化");
  }

  return recommendations;
}

// 运行测试
runStartupDiagnostics().catch((error) => {
  console.error(error);
  process.exit(1);
});
