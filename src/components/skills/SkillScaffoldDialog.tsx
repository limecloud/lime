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

export interface SkillScaffoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (request: CreateSkillScaffoldRequest) => Promise<void>;
  creating: boolean;
  allowProjectTarget: boolean;
}

function getDefaultTarget(allowProjectTarget: boolean): SkillScaffoldTarget {
  return allowProjectTarget ? "project" : "user";
}

export function SkillScaffoldDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  allowProjectTarget,
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

    setTarget(getDefaultTarget(allowProjectTarget));
    setDirectory("");
    setName("");
    setDescription("");
    setError(null);
  }, [open, allowProjectTarget]);

  const handleSubmit = async () => {
    const trimmedDirectory = directory.trim();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

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
        target,
        directory: trimmedDirectory,
        name: trimmedName,
        description: trimmedDescription,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
            创建一个最小可用的标准 Agent Skills 包骨架。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
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
