import { CheckCircle2, ChevronRight, Circle, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  OpenClawScene,
  OpenClawSceneDefinition,
  OpenClawSceneStatus,
} from "./types";
import { openClawPanelClassName } from "./openclawStyles";

interface OpenClawSceneNavProps {
  scenes: OpenClawSceneDefinition[];
  currentScene: OpenClawScene;
  onSelect: (scene: OpenClawScene) => void;
  resolveStatus: (scene: OpenClawScene) => OpenClawSceneStatus;
}

function statusBadgeClass(tone: string): string {
  switch (tone) {
    case "running":
    case "healthy":
    case "connected":
    case "done":
      return "border-emerald-300/60 bg-emerald-50 text-emerald-700";
    case "starting":
    case "active":
      return "border-amber-300/60 bg-amber-50 text-amber-700";
    case "error":
    case "unhealthy":
    case "disconnected":
      return "border-rose-300/60 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function renderSceneIcon(current: boolean, tone: string) {
  if (current) {
    return <PlayCircle className="h-5 w-5 text-emerald-600" />;
  }

  if (tone === "done") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  }

  return <Circle className="h-5 w-5 text-slate-400" />;
}

export function OpenClawSceneNav({
  scenes,
  currentScene,
  onSelect,
  resolveStatus,
}: OpenClawSceneNavProps) {
  return (
    <section className={openClawPanelClassName}>
      <div className="px-1 pb-4">
        <h2 className="text-sm font-semibold text-slate-900">流程导航</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          按“安装环境 → 配置模型 → 运行与访问”的顺序推进，避免跳步骤后状态混乱。
        </p>
      </div>

      <div className="space-y-2">
        {scenes.map((scene) => {
          const current = currentScene === scene.id;
          const status = resolveStatus(scene.id);

          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelect(scene.id)}
              className={cn(
                "w-full rounded-[22px] border px-4 py-4 text-left transition hover:border-slate-300 hover:bg-slate-50",
                current &&
                  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_54%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10 hover:opacity-95",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {renderSceneIcon(current, status.tone)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{scene.title}</div>
                      <p
                        className={cn(
                          "mt-1 text-xs leading-5",
                          current ? "text-slate-600" : "text-slate-500",
                        )}
                      >
                        {scene.description}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        current
                          ? "border-emerald-200 bg-white/90 text-emerald-700"
                          : statusBadgeClass(status.tone),
                      )}
                    >
                      {status.label}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "mt-3 inline-flex items-center gap-1 text-xs",
                      current ? "text-slate-600" : "text-slate-500",
                    )}
                  >
                    <span>{current ? "当前步骤" : "切换到此步骤"}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
