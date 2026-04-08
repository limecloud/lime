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
import {
  A2UIRenderer,
  type A2UIFormData,
  type A2UIResponse,
} from "@/lib/workspace/a2ui";
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
  buildServiceSkillSlotFieldA2UI,
  buildServiceSkillSlotFormData,
  readServiceSkillSlotValueFromA2UIFormData,
  toServiceSkillSlotA2UIField,
} from "./slotFormA2UI";
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
  initialSlotValues?: ServiceSkillSlotValues;
  prefillHint?: string;
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

function getServiceSkillSlotFieldId(slotKey: string): string {
  return `service-skill-slot-${slotKey}`;
}

function buildServiceSkillSlotA2UIResponse(
  skill: ServiceSkillHomeItem,
): A2UIResponse {
  const components: A2UIResponse["components"] = [];
  const childIds: string[] = [];

  for (const slot of skill.slotSchema) {
    const fieldId = getServiceSkillSlotFieldId(slot.key);
    components.push(
      buildServiceSkillSlotFieldA2UI(toServiceSkillSlotA2UIField(slot), {
        fieldId,
        includeRequiredLabelSuffix: true,
      }),
    );
    childIds.push(fieldId);
  }

  const rootId = `${skill.id}:service-skill-slot-form`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `service-skill-slot-form:${skill.id}`,
    root: rootId,
    components,
    data: {},
  };
}

function buildInitialServiceSkillA2UIFormData(
  skill: ServiceSkillHomeItem,
  initialSlotValues?: ServiceSkillSlotValues,
): A2UIFormData {
  const mergedValues = {
    ...createDefaultServiceSkillSlotValues(skill),
    ...(initialSlotValues || {}),
  };
  return buildServiceSkillSlotFormData(
    skill.slotSchema.map(toServiceSkillSlotA2UIField),
    mergedValues,
    {
      fieldIdForKey: getServiceSkillSlotFieldId,
    },
  );
}

function readServiceSkillSlotValuesFromA2UIFormData(
  skill: ServiceSkillHomeItem,
  formData: A2UIFormData,
): ServiceSkillSlotValues {
  const slotValues: ServiceSkillSlotValues = {};

  for (const slot of skill.slotSchema) {
    const normalizedValue = readServiceSkillSlotValueFromA2UIFormData(
      formData,
      getServiceSkillSlotFieldId(slot.key),
    );
    if (!normalizedValue) {
      continue;
    }

    slotValues[slot.key] = normalizedValue;
  }

  return slotValues;
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
  initialSlotValues,
  prefillHint,
  onLaunch,
  onCreateAutomation,
  onOpenBrowserRuntime,
}: ServiceSkillLaunchDialogProps) {
  const [formData, setFormData] = useState<A2UIFormData>({});
  const [siteLaunchReadiness, setSiteLaunchReadiness] =
    useState<SiteLaunchReadinessState>({
      phase: "idle",
    });

  useEffect(() => {
    if (!skill || !open) {
      return;
    }
    setFormData(buildInitialServiceSkillA2UIFormData(skill, initialSlotValues));
  }, [initialSlotValues, open, skill]);

  const slotValues = useMemo(
    () =>
      skill
        ? readServiceSkillSlotValuesFromA2UIFormData(skill, formData)
        : {},
    [formData, skill],
  );

  const slotFormResponse = useMemo(
    () => (skill ? buildServiceSkillSlotA2UIResponse(skill) : null),
    [skill],
  );

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
        ? "先连接浏览器"
        : "直接开始"
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
      ? "可直接开始"
      : siteLaunchReadiness.phase === "blocked"
        ? "先连接浏览器"
        : siteLaunchReadiness.phase === "error"
          ? "读取失败"
          : "读取中";
  const readinessMessage =
    siteLaunchReadiness.phase === "ready" ||
    siteLaunchReadiness.phase === "blocked"
      ? siteLaunchReadiness.result.message
      : siteLaunchReadiness.phase === "error"
        ? siteLaunchReadiness.message
        : "正在检查当前能不能直接复用浏览器。";
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
                怎么开始
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
                开始前
              </div>
              {dependencyItems.length > 0 ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                  {dependencyItems.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  参数补齐后就可以开始。
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
                    <div className="font-medium">浏览器状态</div>
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
                    重新检查
                  </button>
                </div>
              ) : null}
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
                结果位置
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
          {prefillHint ? (
            <div
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600"
              data-testid="service-skill-prefill-hint"
            >
              {prefillHint}
            </div>
          ) : null}
          {slotFormResponse ? (
            <A2UIRenderer
              response={slotFormResponse}
              initialFormData={formData}
              onFormStateChange={setFormData}
              className="space-y-4 [&_.a2ui-field-stack]:space-y-2 [&_.a2ui-field-label]:text-sm [&_.a2ui-field-label]:font-medium [&_.a2ui-field-label]:text-slate-900 [&_.a2ui-helper-text]:text-[11px] [&_.a2ui-helper-text]:leading-5 [&_.a2ui-helper-text]:text-slate-500 [&_.a2ui-option-list]:gap-2.5 [&_.a2ui-choice-option]:rounded-2xl [&_.a2ui-choice-option]:px-4 [&_.a2ui-choice-option]:py-3 [&_.a2ui-text-input]:h-11 [&_.a2ui-text-input]:rounded-2xl [&_.a2ui-text-input]:border-slate-200 [&_.a2ui-textarea]:min-h-[96px] [&_.a2ui-textarea]:rounded-2xl [&_.a2ui-textarea]:border-slate-200"
            />
          ) : null}
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
              打开浏览器工作台
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
