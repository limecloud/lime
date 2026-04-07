import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SiteSkillExecutionState } from "./useWorkspaceBrowserAssistRuntime";

interface ServiceSkillExecutionCardProps {
  state: SiteSkillExecutionState | null;
  onOpenBrowserRuntime?: () => void;
}

const PHASE_LABELS: Record<SiteSkillExecutionState["phase"], string> = {
  running: "执行中",
  success: "已完成",
  error: "执行失败",
  blocked: "需要先准备浏览器",
};

const PHASE_TONE_CLASSES: Record<SiteSkillExecutionState["phase"], string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  blocked: "border-amber-200 bg-amber-50 text-amber-900",
};

export function ServiceSkillExecutionCard({
  state,
  onOpenBrowserRuntime,
}: ServiceSkillExecutionCardProps) {
  if (!state) {
    return null;
  }

  const resultTitle = state.result?.saved_content?.title?.trim();
  const projectRootPath =
    state.result?.saved_content?.project_root_path?.trim() || "";
  const markdownRelativePath =
    state.result?.saved_content?.markdown_relative_path?.trim() || "";
  const imagesRelativeDir =
    state.result?.saved_content?.images_relative_dir?.trim() || "";
  const imageCount = state.result?.saved_content?.image_count;

  return (
    <section
      className={cn(
        "mx-4 mb-3 rounded-[24px] border px-4 py-4 shadow-sm shadow-slate-950/5",
        PHASE_TONE_CLASSES[state.phase],
      )}
      data-testid="service-skill-execution-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] opacity-65">
            站点技能执行
          </div>
          <div className="mt-1 text-sm font-semibold">
            {state.skillTitle || state.adapterName}
          </div>
        </div>
        <span className="rounded-full border border-current/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium">
          {PHASE_LABELS[state.phase]}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6">{state.message}</p>

      {resultTitle ? (
        <p className="mt-2 text-xs leading-5 opacity-80">
          已沉淀内容：{resultTitle}
        </p>
      ) : null}
      {projectRootPath ? (
        <p className="mt-2 break-all text-xs leading-5 opacity-80">
          项目目录：{projectRootPath}
        </p>
      ) : null}
      {markdownRelativePath ? (
        <p className="mt-2 break-all text-xs leading-5 opacity-80">
          Markdown 文件：{markdownRelativePath}
        </p>
      ) : null}
      {typeof imageCount === "number" ? (
        <p className="mt-2 break-all text-xs leading-5 opacity-80">
          图片资源：{imageCount} 张
          {imagesRelativeDir ? ` · ${imagesRelativeDir}` : ""}
        </p>
      ) : null}
      {state.sourceUrl ? (
        <p className="mt-2 break-all text-xs leading-5 opacity-80">
          来源页面：{state.sourceUrl}
        </p>
      ) : null}
      {state.reportHint ? (
        <p className="mt-2 text-xs leading-5 opacity-80">{state.reportHint}</p>
      ) : null}

      {onOpenBrowserRuntime && state.phase === "blocked" ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={onOpenBrowserRuntime}
            data-testid="service-skill-execution-open-browser-runtime"
          >
            去浏览器工作台
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export default ServiceSkillExecutionCard;
