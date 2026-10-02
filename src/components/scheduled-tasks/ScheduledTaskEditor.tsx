import { CalendarDays, ChevronDown, LoaderCircle, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  ScheduledTaskSchedule,
  ScheduledTaskWeekday,
} from "@/lib/api/scheduledTasks";
import { cn } from "@/lib/utils";
import { formatScheduledTaskTime } from "./scheduledTaskPresentation";
import {
  buildScheduledTaskSchedule,
  toggleScheduledTaskWeekday,
  type ScheduledTaskFormErrors,
  type ScheduledTaskFormState,
} from "./scheduledTaskViewModel";

interface ScheduledTaskEditorProps {
  mode: "create" | "edit";
  compact?: boolean;
  form: ScheduledTaskFormState;
  errors: ScheduledTaskFormErrors;
  preview: string[];
  previewLoading: boolean;
  saving: boolean;
  locale: string;
  t: TFunction<"workspace">;
  onChange: (form: ScheduledTaskFormState) => void;
  onPreview: (schedule: ScheduledTaskSchedule) => void;
  onSave: () => void;
  onCancel: () => void;
}

const WEEKDAYS: ScheduledTaskWeekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function ScheduledTaskEditor({
  mode,
  compact = false,
  form,
  errors,
  preview,
  previewLoading,
  saving,
  locale,
  t,
  onChange,
  onPreview,
  onSave,
  onCancel,
}: ScheduledTaskEditorProps) {
  const update = <K extends keyof ScheduledTaskFormState>(
    field: K,
    value: ScheduledTaskFormState[K],
  ) => onChange({ ...form, [field]: value });
  const showDays = form.scheduleType === "weekly" || form.scheduleType === "hourly";
  const modelSelectionLabel = [
    form.modelProviderId?.trim(),
    form.modelId.trim(),
  ]
    .filter(Boolean)
    .join(" / ");

  if (compact) {
    return (
      <CompactScheduledTaskEditor
        mode={mode}
        form={form}
        errors={errors}
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        locale={locale}
        t={t}
        onChange={onChange}
        onPreview={onPreview}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 px-5 py-3 sm:px-7">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {t(mode === "create" ? "scheduledTasks.editor.eyebrow.create" : "scheduledTasks.editor.eyebrow.edit")}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-slate-950">
            {mode === "create"
              ? t("scheduledTasks.editor.title.create")
              : form.title || t("scheduledTasks.editor.title.edit")}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("scheduledTasks.action.close")}
          title={t("scheduledTasks.action.close")}
          onClick={onCancel}
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        <div className="mx-auto max-w-[760px] space-y-8">
          <EditorSection title={t("scheduledTasks.editor.section.basic")}>
            <Field label={t("scheduledTasks.editor.field.title")} error={errors.title ? t("scheduledTasks.editor.validation.title") : undefined}>
              <Input
                value={form.title}
                maxLength={80}
                disabled={saving}
                onChange={(event) => update("title", event.target.value)}
                placeholder={t("scheduledTasks.editor.placeholder.title")}
                aria-invalid={Boolean(errors.title)}
              />
            </Field>
            <Field label={t("scheduledTasks.editor.field.prompt")} error={errors.prompt ? t("scheduledTasks.editor.validation.prompt") : undefined}>
              <Textarea
                value={form.prompt}
                maxLength={20_000}
                disabled={saving}
                onChange={(event) => update("prompt", event.target.value)}
                placeholder={t("scheduledTasks.editor.placeholder.prompt")}
                className="min-h-32 resize-y"
                aria-invalid={Boolean(errors.prompt)}
              />
            </Field>
          </EditorSection>

          <EditorSection title={t("scheduledTasks.editor.section.execution")}>
            <Field label={t("scheduledTasks.editor.field.threadMode")}>
              <select
                value={form.threadMode}
                disabled={saving}
                onChange={(event) =>
                  update("threadMode", event.target.value as ScheduledTaskFormState["threadMode"])
                }
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-300"
              >
                <option value="new_thread">{t("scheduledTasks.editor.threadMode.new")}</option>
                <option value="continue_thread">{t("scheduledTasks.editor.threadMode.continue")}</option>
              </select>
            </Field>
            {form.threadMode === "continue_thread" ? (
              <Field label={t("scheduledTasks.editor.field.sourceThread")} error={errors.sourceThreadId ? t("scheduledTasks.editor.validation.sourceThread") : undefined}>
                <Input
                  value={form.sourceThreadId}
                  disabled={saving}
                  onChange={(event) => update("sourceThreadId", event.target.value)}
                  placeholder={t("scheduledTasks.editor.placeholder.sourceThread")}
                  aria-invalid={Boolean(errors.sourceThreadId)}
                />
              </Field>
            ) : null}
            <Field label={t("scheduledTasks.editor.field.project")}>
              <Input
                value={form.projectId}
                disabled={saving}
                onChange={(event) => update("projectId", event.target.value)}
                placeholder={t("scheduledTasks.editor.placeholder.project")}
              />
            </Field>
            <details
              className="group border-t border-slate-200 pt-4"
              open={Boolean(errors.modelId)}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700">
                {t("scheduledTasks.editor.moreRuntime")}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t("scheduledTasks.editor.field.cwd")}>
                  <Input value={form.cwd} disabled={saving} onChange={(event) => update("cwd", event.target.value)} placeholder={t("scheduledTasks.editor.placeholder.cwd")} />
                </Field>
                <Field
                  label={t("scheduledTasks.editor.field.model")}
                  error={errors.modelId ? t("scheduledTasks.editor.validation.model") : undefined}
                >
                  <Input
                    value={modelSelectionLabel}
                    disabled={saving}
                    readOnly
                    placeholder={t("scheduledTasks.editor.placeholder.inherit")}
                    aria-invalid={Boolean(errors.modelId)}
                    aria-readonly="true"
                    className="bg-slate-50 text-slate-700"
                  />
                </Field>
                <Field label={t("scheduledTasks.editor.field.reasoning")}>
                  <select value={form.reasoningEffort} disabled={saving} onChange={(event) => update("reasoningEffort", event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300">
                    <option value="">{t("scheduledTasks.editor.value.inherit")}</option>
                    {['low', 'medium', 'high', 'xhigh'].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label={t("scheduledTasks.editor.field.notification")}>
                  <select value={form.notificationPolicy} disabled={saving} onChange={(event) => update("notificationPolicy", event.target.value as ScheduledTaskFormState["notificationPolicy"])} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300">
                    <option value="all_runs">{t("scheduledTasks.notification.all")}</option>
                    <option value="failures">{t("scheduledTasks.notification.failures")}</option>
                    <option value="none">{t("scheduledTasks.notification.none")}</option>
                  </select>
                </Field>
              </div>
            </details>
          </EditorSection>

          <EditorSection title={t("scheduledTasks.editor.section.schedule")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("scheduledTasks.editor.field.repeat")}>
                <select
                  value={form.scheduleType}
                  disabled={saving}
                  onChange={(event) => update("scheduleType", event.target.value as ScheduledTaskFormState["scheduleType"])}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-300"
                >
                  <option value="hourly">{t("scheduledTasks.repeat.hourly")}</option>
                  <option value="daily">{t("scheduledTasks.repeat.daily")}</option>
                  <option value="weekdays">{t("scheduledTasks.repeat.weekdays")}</option>
                  <option value="weekly">{t("scheduledTasks.repeat.weekly")}</option>
                </select>
              </Field>
              {form.scheduleType === "hourly" ? (
                <Field label={t("scheduledTasks.editor.field.interval")} error={errors.intervalHours ? t("scheduledTasks.editor.validation.interval") : undefined}>
                  <Input type="number" min={1} max={24} value={form.intervalHours} disabled={saving} onChange={(event) => update("intervalHours", Number(event.target.value))} aria-invalid={Boolean(errors.intervalHours)} />
                </Field>
              ) : null}
              <Field label={t("scheduledTasks.editor.field.time")} error={errors.time ? t("scheduledTasks.editor.validation.time") : undefined}>
                <Input type="time" value={form.time} disabled={saving} onChange={(event) => update("time", event.target.value)} aria-invalid={Boolean(errors.time)} />
              </Field>
              <Field label={t("scheduledTasks.editor.field.timezone")} error={errors.timezone ? t("scheduledTasks.editor.validation.timezone") : undefined}>
                <Input value={form.timezone} disabled={saving} onChange={(event) => update("timezone", event.target.value)} placeholder="Asia/Shanghai" aria-invalid={Boolean(errors.timezone)} />
              </Field>
            </div>
            {showDays ? (
              <Field label={t("scheduledTasks.editor.field.days")} error={errors.days ? t("scheduledTasks.editor.validation.days") : undefined}>
                <div className="grid grid-cols-7 gap-1" role="group" aria-label={t("scheduledTasks.editor.field.days")}>
                  {WEEKDAYS.map((day) => {
                    const selected = form.days.includes(day);
                    return (
                      <button key={day} type="button" disabled={saving} aria-pressed={selected} onClick={() => update("days", toggleScheduledTaskWeekday(form.days, day))} className={cn("h-9 rounded-md border border-slate-200 text-xs font-medium text-slate-600", selected && "border-slate-900 bg-slate-900 text-white")}>
                        {t(`scheduledTasks.weekday.short.${day}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}
            <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
              <div className="flex items-center gap-3">
                <Switch checked={form.enabled} disabled={saving} onCheckedChange={(value) => update("enabled", value)} aria-label={t("scheduledTasks.editor.field.enabled")} />
                <span className="text-sm text-slate-700">{t("scheduledTasks.editor.field.enabled")}</span>
              </div>
              <Button variant="outline" size="sm" disabled={previewLoading || saving} onClick={() => onPreview(buildScheduledTaskSchedule(form))}>
                {previewLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                {t("scheduledTasks.editor.preview")}
              </Button>
            </div>
            {preview.length ? (
              <div className="border-l-2 border-sky-300 pl-4">
                <p className="text-xs font-semibold text-slate-700">{t("scheduledTasks.editor.previewTitle")}</p>
                <ol className="mt-2 space-y-1 text-xs text-slate-500">
                  {preview.map((value) => <li key={value}>{formatScheduledTaskTime(value, locale)}</li>)}
                </ol>
              </div>
            ) : null}
          </EditorSection>
        </div>
      </div>

      <footer className="flex min-h-16 items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-7">
        <Button variant="outline" disabled={saving} onClick={onCancel}>{t("scheduledTasks.action.cancel")}</Button>
        <Button className="min-w-28 bg-slate-900 hover:bg-slate-800" disabled={saving} onClick={onSave}>
          {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t(mode === "create" ? "scheduledTasks.action.create" : "scheduledTasks.action.save")}
        </Button>
      </footer>
    </div>
  );
}

function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4"><h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">{title}</h3>{children}</section>;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-slate-700">{label}</span>{children}{error ? <span className="block text-xs text-rose-600">{error}</span> : null}</label>;
}

function CompactScheduledTaskEditor({
  mode,
  form,
  errors,
  preview,
  previewLoading,
  saving,
  locale,
  t,
  onChange,
  onPreview,
  onSave,
  onCancel,
}: ScheduledTaskEditorProps) {
  const update = <K extends keyof ScheduledTaskFormState>(
    field: K,
    value: ScheduledTaskFormState[K],
  ) => onChange({ ...form, [field]: value });
  const showDays = form.scheduleType === "weekly" || form.scheduleType === "hourly";
  const modelSelectionLabel = [form.modelProviderId?.trim(), form.modelId.trim()]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="flex max-h-[min(520px,calc(100vh-48px))] flex-col bg-white">
      <header className="shrink-0 px-4 pb-2 pt-4">
        <h2 className="text-[15px] font-semibold text-slate-900">
          {mode === "create"
            ? t("scheduledTasks.editor.title.setup", "设置定时任务")
            : t("scheduledTasks.editor.title.edit")}
        </h2>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        <div>
          <Textarea
            value={form.prompt}
            maxLength={20_000}
            disabled={saving}
            onChange={(event) => update("prompt", event.target.value)}
            placeholder={t("scheduledTasks.editor.placeholder.prompt", "说明...")}
            aria-label={t("scheduledTasks.editor.field.prompt")}
            aria-invalid={Boolean(errors.prompt)}
            className="min-h-24 resize-none rounded-2xl border-slate-200 bg-white px-3 py-3 text-sm shadow-none placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-slate-300"
          />
          {errors.prompt ? (
            <p className="mt-1 text-xs text-rose-600">
              {t("scheduledTasks.editor.validation.prompt")}
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 px-3">
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm text-slate-700">
            <span>{t("scheduledTasks.editor.field.repeat")}</span>
            <select
              value={form.scheduleType}
              disabled={saving}
              onChange={(event) =>
                update(
                  "scheduleType",
                  event.target.value as ScheduledTaskFormState["scheduleType"],
                )
              }
              className="max-w-[150px] bg-transparent text-right text-sm text-slate-500 outline-none"
            >
              <option value="hourly">{t("scheduledTasks.repeat.hourly")}</option>
              <option value="daily">{t("scheduledTasks.repeat.daily")}</option>
              <option value="weekdays">{t("scheduledTasks.repeat.weekdays")}</option>
              <option value="weekly">{t("scheduledTasks.repeat.weekly")}</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm text-slate-700">
            <span>{t("scheduledTasks.editor.field.time")}</span>
            <Input
              type="time"
              value={form.time}
              disabled={saving}
              onChange={(event) => update("time", event.target.value)}
              aria-invalid={Boolean(errors.time)}
              className="h-8 w-auto border-0 bg-transparent p-0 text-right text-sm text-slate-500 shadow-none focus-visible:ring-0"
            />
          </label>
        </div>

        <details className="group rounded-xl px-1" open={Boolean(errors.timezone || errors.days)}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-slate-500">
            {t("scheduledTasks.editor.moreRuntime", "高级")}
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-3 rounded-xl border border-slate-200 p-3">
            <Field label={t("scheduledTasks.editor.field.timezone")} error={errors.timezone ? t("scheduledTasks.editor.validation.timezone") : undefined}>
              <Input
                value={form.timezone}
                disabled={saving}
                onChange={(event) => update("timezone", event.target.value)}
                placeholder="Asia/Shanghai"
                aria-invalid={Boolean(errors.timezone)}
              />
            </Field>
            <Field label={t("scheduledTasks.editor.field.project")}>
              <Input
                value={form.projectId}
                disabled={saving}
                onChange={(event) => update("projectId", event.target.value)}
                placeholder={t("scheduledTasks.editor.placeholder.project")}
              />
            </Field>
            <Field label={t("scheduledTasks.editor.field.model")}>
              <Input
                value={modelSelectionLabel}
                disabled={saving}
                readOnly
                placeholder={t("scheduledTasks.editor.placeholder.inherit")}
                aria-readonly="true"
                className="bg-slate-50 text-slate-700"
              />
            </Field>
            <Field label={t("scheduledTasks.editor.field.threadMode")}>
              <select
                value={form.threadMode}
                disabled={saving}
                onChange={(event) =>
                  update(
                    "threadMode",
                    event.target.value as ScheduledTaskFormState["threadMode"],
                  )
                }
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="new_thread">{t("scheduledTasks.editor.threadMode.new")}</option>
                <option value="continue_thread">{t("scheduledTasks.editor.threadMode.continue")}</option>
              </select>
            </Field>
            {showDays ? (
              <Field label={t("scheduledTasks.editor.field.days")} error={errors.days ? t("scheduledTasks.editor.validation.days") : undefined}>
                <div className="grid grid-cols-7 gap-1" role="group" aria-label={t("scheduledTasks.editor.field.days")}>
                  {WEEKDAYS.map((day) => {
                    const selected = form.days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={saving}
                        aria-pressed={selected}
                        onClick={() => update("days", toggleScheduledTaskWeekday(form.days, day))}
                        className={cn(
                          "h-8 rounded-md border border-slate-200 text-[11px] font-medium text-slate-600",
                          selected && "border-slate-900 bg-slate-900 text-white",
                        )}
                      >
                        {t(`scheduledTasks.weekday.short.${day}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>{t("scheduledTasks.editor.field.enabled")}</span>
              <Switch checked={form.enabled} disabled={saving} onCheckedChange={(value) => update("enabled", value)} />
            </label>
            <Button variant="outline" size="sm" disabled={previewLoading || saving} onClick={() => onPreview(buildScheduledTaskSchedule(form))}>
              {previewLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
              {t("scheduledTasks.editor.preview")}
            </Button>
            {preview.length ? (
              <ol className="space-y-1 text-xs text-slate-500">
                {preview.map((value) => <li key={value}>{formatScheduledTaskTime(value, locale)}</li>)}
              </ol>
            ) : null}
          </div>
        </details>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 px-4 pb-4 pt-1">
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          {t("scheduledTasks.action.cancel")}
        </Button>
        <Button size="sm" className="rounded-full bg-slate-900 px-4 hover:bg-slate-800" disabled={saving} onClick={onSave}>
          {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t(mode === "create" ? "scheduledTasks.action.create" : "scheduledTasks.action.save")}
        </Button>
      </footer>
    </div>
  );
}
