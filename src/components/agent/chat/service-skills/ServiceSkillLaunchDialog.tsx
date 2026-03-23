import { useEffect, useMemo, useState } from "react";
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
  createDefaultServiceSkillSlotValues,
  formatServiceSkillPromptPreview,
  validateServiceSkillSlotValues,
} from "./promptComposer";
import { supportsServiceSkillLocalAutomation } from "./automationDraft";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";

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
        <option value="">
          {slot.placeholder}
        </option>
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

export function ServiceSkillLaunchDialog({
  skill,
  open,
  onOpenChange,
  onLaunch,
  onCreateAutomation,
}: ServiceSkillLaunchDialogProps) {
  const [slotValues, setSlotValues] = useState<ServiceSkillSlotValues>({});

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
    return formatServiceSkillPromptPreview(skill, slotValues);
  }, [skill, slotValues]);
  const supportsAutomation = useMemo(
    () => (skill ? supportsServiceSkillLocalAutomation(skill) : false),
    [skill],
  );
  const canCreateAutomation = supportsAutomation && typeof onCreateAutomation === "function";

  if (!skill) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] space-y-4">
        <DialogHeader>
          <DialogTitle>{skill.title}</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">{skill.summary}</span>
            <span className="block text-xs text-slate-500">
              {skill.runnerLabel} · 产出：{skill.outputHint}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-600">
          <div className="font-medium text-slate-800">预览</div>
          <div className="mt-1">{preview}</div>
          {canCreateAutomation ? (
            <div className="mt-2 text-[11px] text-slate-500">
              这类任务支持直接生成本地自动化草稿；你也可以只先进入工作区做首版结果。
            </div>
          ) : null}
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
            还缺少必填参数：{validation.missing.map((slot) => slot.label).join("、")}
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
          <Button
            type="button"
            data-testid={
              canCreateAutomation
                ? "service-skill-create-automation"
                : "service-skill-launch"
            }
            disabled={!validation.valid}
            onClick={() => {
              if (canCreateAutomation && onCreateAutomation) {
                void onCreateAutomation(skill, slotValues);
                return;
              }
              void onLaunch(skill, slotValues);
            }}
          >
            {canCreateAutomation ? "创建任务并进入工作区" : "进入工作区"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ServiceSkillLaunchDialog;
