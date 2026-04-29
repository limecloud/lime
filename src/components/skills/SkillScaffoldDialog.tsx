import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CreateSkillScaffoldRequest,
  SkillScaffoldTarget,
} from "@/lib/api/skills";
import type { SkillScaffoldDraft } from "@/types/page";

export interface SkillScaffoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (request: CreateSkillScaffoldRequest) => Promise<void>;
  creating: boolean;
  allowProjectTarget: boolean;
  initialValues?: SkillScaffoldDraft | null;
  sourceHint?: string | null;
  onBringBackToCreation?: (draft: SkillScaffoldDraft) => void;
}

function getDefaultTarget(allowProjectTarget: boolean): SkillScaffoldTarget {
  return allowProjectTarget ? "project" : "user";
}

function resolveInitialTarget(
  allowProjectTarget: boolean,
  target?: SkillScaffoldTarget,
): SkillScaffoldTarget {
  if (target === "project" && allowProjectTarget) {
    return target;
  }
  if (target === "user") {
    return target;
  }
  return getDefaultTarget(allowProjectTarget);
}

function normalizeStructuredItems(value?: string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function pickStructuredScaffoldFields(
  initialValues?: SkillScaffoldDraft | null,
): SkillScaffoldDraft {
  return {
    whenToUse: normalizeStructuredItems(initialValues?.whenToUse),
    inputs: normalizeStructuredItems(initialValues?.inputs),
    outputs: normalizeStructuredItems(initialValues?.outputs),
    steps: normalizeStructuredItems(initialValues?.steps),
    fallbackStrategy: normalizeStructuredItems(initialValues?.fallbackStrategy),
  };
}

export function SkillScaffoldDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  allowProjectTarget,
  initialValues,
  sourceHint,
  onBringBackToCreation,
}: SkillScaffoldDialogProps) {
  const [target, setTarget] = useState<SkillScaffoldTarget>(
    getDefaultTarget(allowProjectTarget),
  );
  const [directory, setDirectory] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }

    setTarget(resolveInitialTarget(allowProjectTarget, initialValues?.target));
    setDirectory(initialValues?.directory?.trim() ?? "");
    setName(initialValues?.name?.trim() ?? "");
    setDescription(initialValues?.description?.trim() ?? "");
    setError(null);
  }, [allowProjectTarget, initialValues, open]);

  const buildDraftSnapshot = (): SkillScaffoldDraft => ({
    ...pickStructuredScaffoldFields(initialValues),
    target,
    directory: directory.trim() || undefined,
    name: name.trim() || undefined,
    description: description.trim() || undefined,
    sourceMessageId: initialValues?.sourceMessageId?.trim() || undefined,
    sourceExcerpt: initialValues?.sourceExcerpt?.trim() || undefined,
  });

  const handleSubmit = async () => {
    const draft = buildDraftSnapshot();
    const trimmedDirectory = draft.directory?.trim() || "";
    const trimmedName = draft.name?.trim() || "";
    const trimmedDescription = draft.description?.trim() || "";

    if (!trimmedDirectory) {
      setError("请输入目录名");
      return;
    }
    if (!trimmedName) {
      setError("请输入 Skill 名称");
      return;
    }
    if (!trimmedDescription) {
      setError("请输入 Skill 描述");
      return;
    }

    setError(null);
    try {
      await onCreate({
        ...pickStructuredScaffoldFields(initialValues),
        target: draft.target || getDefaultTarget(allowProjectTarget),
        directory: trimmedDirectory,
        name: trimmedName,
        description: trimmedDescription,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const canBringBackToCreation = Boolean(
    onBringBackToCreation &&
    (sourceHint ||
      initialValues?.sourceExcerpt ||
      initialValues?.sourceMessageId),
  );

  const handleBringBackToCreation = () => {
    if (!onBringBackToCreation) {
      return;
    }

    onBringBackToCreation(buildDraftSnapshot());
    onOpenChange(false);
  };

  const targetDescription =
    target === "project"
      ? "将创建到当前工作区的 `./.agents/skills`。"
      : "将创建到应用级 Skills 目录。";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="max-w-xl" className="space-y-4">
        <DialogHeader>
          <DialogTitle>新建 Skill</DialogTitle>
          <DialogDescription>
            {sourceHint
              ? "已根据刚才的结果预填一版技能草稿，并补好适用场景、输入输出与执行步骤。"
              : "创建一个最小可用的标准 Agent Skills 包骨架。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {sourceHint ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              来源结果：{sourceHint}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">创建位置</div>
            <div className="flex gap-2">
              {allowProjectTarget && (
                <button
                  type="button"
                  id="skill-scaffold-target-project"
                  onClick={() => setTarget("project")}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    target === "project"
                      ? "border-primary bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  项目级
                </button>
              )}
              <button
                type="button"
                id="skill-scaffold-target-user"
                onClick={() => setTarget("user")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  target === "user"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                用户级
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{targetDescription}</p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-directory"
              className="block text-sm font-medium text-foreground"
            >
              目录名
            </label>
            <input
              id="skill-scaffold-directory"
              type="text"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="social_post_outline"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              只允许单层目录名，推荐小写字母、数字和连字符。
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-name"
              className="block text-sm font-medium text-foreground"
            >
              Skill 名称
            </label>
            <input
              id="skill-scaffold-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="内容发布提纲"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-description"
              className="block text-sm font-medium text-foreground"
            >
              描述
            </label>
            <textarea
              id="skill-scaffold-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="帮助用户快速产出某类任务的结构化结果。"
              rows={4}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            取消
          </button>
          {canBringBackToCreation ? (
            <button
              type="button"
              onClick={handleBringBackToCreation}
              disabled={creating}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              带回创作输入
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? "创建中..." : "创建 Skill"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
