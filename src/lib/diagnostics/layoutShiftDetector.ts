/**
 * 布局偏移检测器
 *
 * 使用 PerformanceObserver 监听 CLS (Cumulative Layout Shift)
 * 帮助定位导致排版晃动的具体元素
 */

export interface LayoutShiftEntry {
  timestamp: number;
  value: number;
  sources: Array<{
    node: string;
    previousRect: DOMRectReadOnly;
    currentRect: DOMRectReadOnly;
  }>;
}

class LayoutShiftDetector {
  private shifts: LayoutShiftEntry[] = [];
  private observer: PerformanceObserver | null = null;
  private enabled: boolean;
  private cumulativeScore = 0;

  constructor() {
    this.enabled = typeof window !== "undefined" &&
      (window.localStorage.getItem("lime.debug.layout-shift") === "true" ||
       new URLSearchParams(window.location.search).has("debug-layout-shift"));

    if (this.enabled && typeof PerformanceObserver !== "undefined") {
      this.startObserving();
    }
  }

  private startObserving(): void {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "layout-shift" && !(entry as any).hadRecentInput) {
            const layoutShiftEntry = entry as any;
            this.cumulativeScore += layoutShiftEntry.value;

            const shift: LayoutShiftEntry = {
              timestamp: entry.startTime,
              value: layoutShiftEntry.value,
              sources: (layoutShiftEntry.sources || []).map((source: any) => ({
                node: source.node?.nodeName || "unknown",
                previousRect: source.previousRect,
                currentRect: source.currentRect,
              })),
            };

            this.shifts.push(shift);

            console.warn(
              `[Layout Shift] Score: ${layoutShiftEntry.value.toFixed(4)} @ ${entry.startTime.toFixed(2)}ms`,
              shift.sources,
            );
          }
        }
      });

      this.observer.observe({ type: "layout-shift", buffered: true });
    } catch (error) {
      console.error("Failed to start layout shift observer:", error);
    }
  }

  getShifts(): LayoutShiftEntry[] {
    return [...this.shifts];
  }

  getCumulativeScore(): number {
    return this.cumulativeScore;
  }

  report(): void {
    if (!this.enabled || this.shifts.length === 0) return;

    console.group("📐 Layout Shift Report");
    console.log(`Total CLS Score: ${this.cumulativeScore.toFixed(4)}`);
    console.log(`Number of shifts: ${this.shifts.length}`);
    console.table(
      this.shifts.map((shift, index) => ({
        "#": index + 1,
        "Time (ms)": shift.timestamp.toFixed(2),
        Score: shift.value.toFixed(4),
        "Affected Elements": shift.sources.length,
      })),
    );
    console.groupEnd();
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

export const layoutShiftDetector = new LayoutShiftDetector();

// 自动在页面加载完成后输出报告
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    setTimeout(() => {
      layoutShiftDetector.report();
    }, 2000);
  });
}
