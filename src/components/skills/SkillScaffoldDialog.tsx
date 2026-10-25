import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
}: SkillScaffoldDialogProps) {
  const { t } = useTranslation("agent");
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
  });

  const handleSubmit = async () => {
    const draft = buildDraftSnapshot();
    const trimmedDirectory = draft.directory?.trim() || "";
    const trimmedName = draft.name?.trim() || "";
    const trimmedDescription = draft.description?.trim() || "";

    if (!trimmedDirectory) {
      setError(t("skills.scaffoldDialog.validation.directory"));
      return;
    }
    if (!trimmedName) {
      setError(t("skills.scaffoldDialog.validation.name"));
      return;
    }
    if (!trimmedDescription) {
      setError(t("skills.scaffoldDialog.validation.description"));
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

  const targetDescription =
    target === "project"
      ? t("skills.scaffoldDialog.target.projectDescription")
      : t("skills.scaffoldDialog.target.userDescription");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="max-w-xl" className="space-y-4">
        <DialogHeader>
          <DialogTitle>{t("skills.scaffoldDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("skills.scaffoldDialog.description.default")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">
              {t("skills.scaffoldDialog.target.label")}
            </div>
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
                  {t("skills.scaffoldDialog.target.project")}
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
                {t("skills.scaffoldDialog.target.user")}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{targetDescription}</p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-directory"
              className="block text-sm font-medium text-foreground"
            >
              {t("skills.scaffoldDialog.directory.label")}
            </label>
            <input
              id="skill-scaffold-directory"
              type="text"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t("skills.scaffoldDialog.directory.helper")}
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-name"
              className="block text-sm font-medium text-foreground"
            >
              {t("skills.scaffoldDialog.name.label")}
            </label>
            <input
              id="skill-scaffold-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("skills.scaffoldDialog.name.placeholder")}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="skill-scaffold-description"
              className="block text-sm font-medium text-foreground"
            >
              {t("skills.scaffoldDialog.description.label")}
            </label>
            <textarea
              id="skill-scaffold-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("skills.scaffoldDialog.description.placeholder")}
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
            {t("skills.scaffoldDialog.action.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating
              ? t("skills.scaffoldDialog.action.creating")
              : t("skills.scaffoldDialog.action.create")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
