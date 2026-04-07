import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  siteGetAdapterLaunchReadiness,
  type SiteAdapterLaunchReadinessResult,
} from "@/lib/webview-api";
import {
  createDefaultServiceSkillSlotValues,
  formatServiceSkillPromptPreview,
  validateServiceSkillSlotValues,
} from "./promptComposer";
import {
  getServiceSkillOutputDestination,
  getServiceSkillPrimaryActionLabel,
  getServiceSkillTypeLabel,
  listServiceSkillDependencies,
} from "./skillPresentation";
import { supportsServiceSkillLocalAutomation } from "./automationDraft";
import {
  buildServiceSkillNaturalLaunchMessage,
  buildSiteLaunchBlockedMessage,
  isServiceSkillExecutableAsSiteAdapter,
  isSiteLaunchReadinessReady,
} from "./siteCapabilityBinding";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";

type SiteLaunchReadinessState =
  | { phase: "idle" | "checking" }
  | { phase: "ready" | "blocked"; result: SiteAdapterLaunchReadinessResult }
  | { phase: "error"; message: string };

interface ServiceSkillLaunchDialogProps {
  skill: ServiceSkillHomeItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunch: (
    skill: ServiceSkillHomeItem,
    slotValues: ServiceSkillSlotValues,
  ) => void | Promise<void>;
  onCreateAutomation?: (
    skill: ServiceSkillHomeItem,
    slotValues: ServiceSkillSlotValues,
  ) => void | Promise<void>;
  onOpenBrowserRuntime?: (
    skill: ServiceSkillHomeItem,
    slotValues: ServiceSkillSlotValues,
  ) => void | Promise<void>;
}

function renderFieldControl(params: {
  slot: ServiceSkillSlotDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const { slot, value, onChange } = params;
  const sharedProps = {
    id: `service-skill-slot-${slot.key}`,
    "data-testid": `service-skill-slot-${slot.key}`,
  };

  if (slot.type === "textarea" || slot.type === "account_list") {
    return (
      <Textarea
        {...sharedProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={slot.placeholder}
        className="min-h-[96px]"
      />
    );
  }

  if (slot.type === "enum" || slot.type === "platform") {
    return (
      <select
        {...sharedProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        )}
      >
        <option value="">{slot.placeholder}</option>
        {(slot.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <Input
      {...sharedProps}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={slot.placeholder}
      type={slot.type === "url" ? "url" : "text"}
    />
  );
}

function renderInfoList(title: string, items?: string[]) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-800">{title}</div>
      <div className="space-y-1 text-xs leading-5 text-slate-600">
        {items.map((item) => (
          <div key={`${title}-${item}`} className="flex gap-2">
            <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-slate-300" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceSkillLaunchDialog({
  skill,
  open,
  onOpenChange,
  onLaunch,
  onCreateAutomation,
  onOpenBrowserRuntime,
}: ServiceSkillLaunchDialogProps) {
  const [slotValues, setSlotValues] = useState<ServiceSkillSlotValues>({});
  const [siteLaunchReadiness, setSiteLaunchReadiness] =
    useState<SiteLaunchReadinessState>({
      phase: "idle",
    });

  useEffect(() => {
    if (!skill || !open) {
      return;
    }
    setSlotValues(createDefaultServiceSkillSlotValues(skill));
  }, [open, skill]);

  const validation = useMemo(() => {
    if (!skill) {
      return {
        valid: false,
        missing: [],
      };
    }
    return validateServiceSkillSlotValues(skill, slotValues);
  }, [skill, slotValues]);

  const preview = useMemo(() => {
    if (!skill) {
      return "";
    }
    if (isServiceSkillExecutableAsSiteAdapter(skill)) {
      return buildServiceSkillNaturalLaunchMessage({
        skill,
        slotValues,
      });
    }
    return formatServiceSkillPromptPreview(skill, slotValues);
  }, [skill, slotValues]);
  const supportsAutomation = useMemo(
    () => (skill ? supportsServiceSkillLocalAutomation(skill) : false),
    [skill],
  );
  const canCreateAutomation =
    supportsAutomation && typeof onCreateAutomation === "function";
  const isSiteSkill = skill
    ? isServiceSkillExecutableAsSiteAdapter(skill)
    : false;
  const canOpenBrowserRuntime =
    isSiteSkill && typeof onOpenBrowserRuntime === "function";
  const dependencyItems = useMemo(
    () => (skill ? listServiceSkillDependencies(skill) : []),
    [skill],
  );
  const outputDestination = useMemo(
    () => (skill ? getServiceSkillOutputDestination(skill) : ""),
    [skill],
  );
  const primaryActionLabel = skill
    ? isSiteSkill
      ? siteLaunchReadiness.phase === "blocked"
        ? "先准备浏览器再执行"
        : "在 Claw 中执行"
      : getServiceSkillPrimaryActionLabel(skill, canCreateAutomation)
    : "进入工作区";
  const canLaunchInClaw =
    validation.valid &&
    (!isSiteSkill || siteLaunchReadiness.phase !== "blocked");

  const refreshSiteLaunchReadiness = useCallback(async () => {
    if (!open || !skill || !isServiceSkillExecutableAsSiteAdapter(skill)) {
      setSiteLaunchReadiness({ phase: "idle" });
      return;
    }
    const siteCapabilityBinding = skill.siteCapabilityBinding;

    setSiteLaunchReadiness({ phase: "checking" });
    try {
      const result = await siteGetAdapterLaunchReadiness({
        adapter_name: siteCapabilityBinding.adapterName,
      });
      setSiteLaunchReadiness({
        phase: result.status === "ready" ? "ready" : "blocked",
        result,
      });
    } catch (error) {
      setSiteLaunchReadiness({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [open, skill]);

  useEffect(() => {
    if (!open || !skill || !isServiceSkillExecutableAsSiteAdapter(skill)) {
      setSiteLaunchReadiness({ phase: "idle" });
      return;
    }
    const siteCapabilityBinding = skill.siteCapabilityBinding;

    let cancelled = false;
    void (async () => {
      setSiteLaunchReadiness({ phase: "checking" });
      try {
        const result = await siteGetAdapterLaunchReadiness({
          adapter_name: siteCapabilityBinding.adapterName,
        });
        if (cancelled) {
          return;
        }
        setSiteLaunchReadiness({
          phase: result.status === "ready" ? "ready" : "blocked",
          result,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSiteLaunchReadiness({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, skill]);

  const readinessToneClass =
    siteLaunchReadiness.phase === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : siteLaunchReadiness.phase === "blocked"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : siteLaunchReadiness.phase === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  const readinessLabel =
    siteLaunchReadiness.phase === "ready"
      ? "可直接执行"
      : siteLaunchReadiness.phase === "blocked"
        ? "需要先准备浏览器"
        : siteLaunchReadiness.phase === "error"
          ? "检测失败"
          : "检测中";
  const readinessMessage =
    siteLaunchReadiness.phase === "ready" ||
    siteLaunchReadiness.phase === "blocked"
      ? siteLaunchReadiness.result.message
      : siteLaunchReadiness.phase === "error"
        ? siteLaunchReadiness.message
        : "正在检查是否存在可复用的真实浏览器会话。";
  const readinessHint =
    siteLaunchReadiness.phase === "ready" ||
    siteLaunchReadiness.phase === "blocked"
      ? siteLaunchReadiness.result.report_hint
      : null;

  if (!skill) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-32px)] overflow-y-auto overscroll-contain sm:max-w-[720px] space-y-4">
        <DialogHeader>
          <DialogTitle>{skill.title}</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">{skill.summary}</span>
            <span className="block text-xs text-slate-500">
              {getServiceSkillTypeLabel(skill)} · {skill.runnerLabel} · 产出：
              {skill.outputHint}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          <div className="font-medium text-slate-800">执行预览</div>
          <div className="mt-1">{preview}</div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid gap-0 md:grid-cols-3">
            <div className="border-b border-slate-200 px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
                执行方式
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {skill.runnerLabel}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {skill.runnerDescription}
              </p>
            </div>
            <div className="border-b border-slate-200 px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
                依赖条件
              </div>
              {dependencyItems.length > 0 ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                  {dependencyItems.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  当前没有额外依赖，补完参数后即可开始。
                </p>
              )}
              {isSiteSkill ? (
                <div
                  className={cn(
                    "mt-3 rounded-2xl border px-3 py-3 text-xs leading-5",
                    readinessToneClass,
                  )}
                  data-testid="service-skill-site-readiness"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">Claw 直跑检测</div>
                    <span className="text-[11px] font-medium">
                      {readinessLabel}
                    </span>
                  </div>
                  <p className="mt-2">{readinessMessage}</p>
                  {readinessHint ? (
                    <p className="mt-2 text-[11px] opacity-80">
                      {readinessHint}
                    </p>
                  ) : null}
                  {siteLaunchReadiness.phase === "blocked" &&
                  canOpenBrowserRuntime ? (
                    <p className="mt-2 text-[11px] opacity-80">
                      {buildSiteLaunchBlockedMessage(
                        siteLaunchReadiness.result,
                      )}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center rounded-xl border border-current/15 bg-white/70 px-2.5 py-1 text-[11px] font-medium transition hover:bg-white"
                    data-testid="service-skill-refresh-readiness"
                    onClick={() => {
                      void refreshSiteLaunchReadiness();
                    }}
                  >
                    重新检测会话
                  </button>
                </div>
              ) : null}
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
                结果去向
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {outputDestination}
              </p>
            </div>
          </div>
          {(skill.triggerHints?.length ||
            skill.usageGuidelines?.length ||
            skill.examples?.length) && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
              <div className="grid gap-4 md:grid-cols-3">
                {renderInfoList("适合什么时候用", skill.usageGuidelines)}
                {renderInfoList("常见触发", skill.triggerHints)}
                {renderInfoList("示例", skill.examples)}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4">
          {skill.slotSchema.map((slot) => (
            <div key={slot.key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`service-skill-slot-${slot.key}`}>
                  {slot.label}
                </Label>
                {slot.required ? (
                  <span className="text-[11px] font-medium text-rose-500">
                    必填
                  </span>
                ) : null}
              </div>
              {renderFieldControl({
                slot,
                value: slotValues[slot.key] ?? "",
                onChange: (nextValue) =>
                  setSlotValues((previous) => ({
                    ...previous,
                    [slot.key]: nextValue,
                  })),
              })}
              {slot.helpText ? (
                <p className="text-[11px] leading-5 text-slate-500">
                  {slot.helpText}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {!validation.valid ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
            还缺少必填参数：
            {validation.missing.map((slot) => slot.label).join("、")}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          {canCreateAutomation ? (
            <Button
              type="button"
              variant="outline"
              data-testid="service-skill-enter-workspace"
              disabled={!validation.valid}
              onClick={() => {
                void onLaunch(skill, slotValues);
              }}
            >
              先进入工作区
            </Button>
          ) : null}
          {canOpenBrowserRuntime ? (
            <Button
              type="button"
              variant="outline"
              data-testid="service-skill-open-browser-runtime"
              disabled={!validation.valid}
              onClick={() => {
                void onOpenBrowserRuntime?.(skill, slotValues);
              }}
            >
              去浏览器工作台
            </Button>
          ) : null}
          <Button
            type="button"
            data-testid={
              canCreateAutomation
                ? "service-skill-create-automation"
                : "service-skill-launch"
            }
            disabled={!canLaunchInClaw}
            onClick={() => {
              if (
                isSiteSkill &&
                siteLaunchReadiness.phase === "blocked" &&
                !isSiteLaunchReadinessReady(siteLaunchReadiness.result)
              ) {
                return;
              }
              if (canCreateAutomation && onCreateAutomation) {
                void onCreateAutomation(skill, slotValues);
                return;
              }
              void onLaunch(skill, slotValues);
            }}
          >
            {primaryActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ServiceSkillLaunchDialog;
