/**
 * 启动性能诊断工具
 *
 * 用于追踪和记录应用启动过程中的关键时间点,
 * 帮助定位排版错乱和晃动的根本原因
 */

export interface StartupMilestone {
  name: string;
  timestamp: number;
  relativeTime: number;
}

class StartupPerformanceTracker {
  private startTime: number;
  private milestones: StartupMilestone[] = [];
  private enabled: boolean;

  constructor() {
    this.startTime = performance.now();
    this.enabled = typeof window !== "undefined" &&
      (window.localStorage.getItem("lime.debug.startup") === "true" ||
       new URLSearchParams(window.location.search).has("debug-startup"));
  }

  mark(name: string): void {
    if (!this.enabled) return;

    const timestamp = performance.now();
    const relativeTime = timestamp - this.startTime;

    this.milestones.push({
      name,
      timestamp,
      relativeTime,
    });

    console.log(
      `[Startup] ${name} @ ${relativeTime.toFixed(2)}ms`,
    );
  }

  getMilestones(): StartupMilestone[] {
    return [...this.milestones];
  }

  report(): void {
    if (!this.enabled || this.milestones.length === 0) return;

    console.group("🚀 Startup Performance Report");
    console.table(
      this.milestones.map((m) => ({
        Milestone: m.name,
        "Time (ms)": m.relativeTime.toFixed(2),
        "Delta (ms)": this.milestones.indexOf(m) > 0
          ? (m.relativeTime - this.milestones[this.milestones.indexOf(m) - 1].relativeTime).toFixed(2)
          : "0.00",
      })),
    );
    console.groupEnd();
  }

  reset(): void {
    this.startTime = performance.now();
    this.milestones = [];
  }
}

export const startupTracker = new StartupPerformanceTracker();

// 自动在页面加载完成后输出报告
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    setTimeout(() => {
      startupTracker.report();
    }, 1000);
  });
}
