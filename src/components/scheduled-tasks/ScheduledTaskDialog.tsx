import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  scheduledTasksApi,
  type ScheduledTaskSchedule,
} from "@/lib/api/scheduledTasks";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import {
  validateScheduledTaskForm,
  type ScheduledTaskFormErrors,
  type ScheduledTaskFormState,
} from "./scheduledTaskViewModel";

interface ScheduledTaskDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialForm: ScheduledTaskFormState | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: ScheduledTaskFormState) => Promise<void>;
}

export function ScheduledTaskDialog({
  open,
  mode,
  initialForm,
  saving,
  onOpenChange,
  onSubmit,
}: ScheduledTaskDialogProps) {
  const { i18n, t } = useTranslation("workspace");
  const [form, setForm] = useState<ScheduledTaskFormState | null>(initialForm);
  const [errors, setErrors] = useState<ScheduledTaskFormErrors>({});
  const [preview, setPreview] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initialForm);
    setErrors({});
    setPreview([]);
  }, [initialForm, open]);

  const handlePreview = async (schedule: ScheduledTaskSchedule) => {
    setPreviewLoading(true);
    try {
      const response = await scheduledTasksApi.previewSchedule(schedule);
      setPreview(response.nextRunAt);
    } catch (error) {
      toast.error(
        t("scheduledTasks.error.preview", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form) {
      return;
    }
    const normalizedForm = form.title.trim()
      ? form
      : {
          ...form,
          title: form.prompt.trim().split(/\r?\n/, 1)[0]?.slice(0, 80) || form.title,
        };
    const nextErrors = validateScheduledTaskForm(normalizedForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(t("scheduledTasks.editor.validation.fix"));
      return;
    }
    await onSubmit(normalizedForm);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-[548px]"
        className="lime-workbench-theme-scope overflow-hidden rounded-[20px] border border-slate-200 bg-white p-0 shadow-2xl"
      >
        {form ? (
          <ScheduledTaskEditor
            mode={mode}
            compact
            form={form}
            errors={errors}
            preview={preview}
            previewLoading={previewLoading}
            saving={saving}
            locale={i18n.language}
            t={t}
            onChange={setForm}
            onPreview={(schedule) => void handlePreview(schedule)}
            onSave={() => void handleSave()}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
