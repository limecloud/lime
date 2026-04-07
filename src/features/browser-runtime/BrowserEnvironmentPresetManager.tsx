import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Archive, PencilLine, RotateCcw, Save, SquarePen } from "lucide-react";
import { browserRuntimeApi } from "./api";
import type { BrowserEnvironmentPresetRecord } from "./api";

type RuntimeMessage = {
  type: "success" | "error";
  text: string;
};

interface BrowserEnvironmentPresetManagerProps {
  onMessage?: (message: RuntimeMessage) => void;
  selectedPresetId?: string;
  onSelectedPresetChange?: (presetId: string) => void;
  onPresetsChanged?: (presets: BrowserEnvironmentPresetRecord[]) => void;
}

type PresetFormState = {
  id?: string;
  name: string;
  description: string;
  proxy_server: string;
  timezone_id: string;
  locale: string;
  accept_language: string;
  geolocation_lat: string;
  geolocation_lng: string;
  geolocation_accuracy_m: string;
  user_agent: string;
  platform: string;
  viewport_width: string;
  viewport_height: string;
  device_scale_factor: string;
};

const EMPTY_FORM: PresetFormState = {
  name: "",
  description: "",
  proxy_server: "",
  timezone_id: "",
  locale: "",
  accept_language: "",
  geolocation_lat: "",
  geolocation_lng: "",
  geolocation_accuracy_m: "",
  user_agent: "",
  platform: "",
  viewport_width: "",
  viewport_height: "",
  device_scale_factor: "",
};

function toFormState(preset: BrowserEnvironmentPresetRecord): PresetFormState {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description ?? "",
    proxy_server: preset.proxy_server ?? "",
    timezone_id: preset.timezone_id ?? "",
    locale: preset.locale ?? "",
    accept_language: preset.accept_language ?? "",
    geolocation_lat:
      preset.geolocation_lat === null ? "" : String(preset.geolocation_lat),
    geolocation_lng:
      preset.geolocation_lng === null ? "" : String(preset.geolocation_lng),
    geolocation_accuracy_m:
      preset.geolocation_accuracy_m === null
        ? ""
        : String(preset.geolocation_accuracy_m),
    user_agent: preset.user_agent ?? "",
    platform: preset.platform ?? "",
    viewport_width:
      preset.viewport_width === null ? "" : String(preset.viewport_width),
    viewport_height:
      preset.viewport_height === null ? "" : String(preset.viewport_height),
    device_scale_factor:
      preset.device_scale_factor === null
        ? ""
        : String(preset.device_scale_factor),
  };
}

function parseOptionalNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function BrowserEnvironmentPresetManager(
  props: BrowserEnvironmentPresetManagerProps,
) {
  const {
    onMessage,
    selectedPresetId = "",
    onSelectedPresetChange,
    onPresetsChanged,
  } = props;
  const [presets, setPresets] = useState<BrowserEnvironmentPresetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PresetFormState>(EMPTY_FORM);

  const activePresets = useMemo(
    () => presets.filter((preset) => preset.archived_at === null),
    [presets],
  );

  const refreshPresets = useCallback(
    async (includeArchived = showArchived) => {
      setLoading(true);
      try {
        const nextPresets =
          await browserRuntimeApi.listBrowserEnvironmentPresets({
            include_archived: includeArchived,
          });
        const nextActivePresets = nextPresets.filter(
          (preset) => preset.archived_at === null,
        );
        startTransition(() => {
          setPresets(nextPresets);
        });
        onPresetsChanged?.(nextActivePresets);
        if (
          selectedPresetId &&
          !nextActivePresets.some((preset) => preset.id === selectedPresetId)
        ) {
          onSelectedPresetChange?.("");
        }
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `读取环境预设失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setLoading(false);
      }
    },
    [
      onMessage,
      onPresetsChanged,
      onSelectedPresetChange,
      selectedPresetId,
      showArchived,
    ],
  );

  useEffect(() => {
    void refreshPresets(showArchived);
  }, [refreshPresets, showArchived]);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormOpen(false);
  }, []);

  const handleCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((preset: BrowserEnvironmentPresetRecord) => {
    setForm(toFormState(preset));
    setFormOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      onMessage?.({ type: "error", text: "环境预设名称不能为空" });
      return;
    }

    const request = {
      id: form.id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      proxy_server: form.proxy_server.trim() || undefined,
      timezone_id: form.timezone_id.trim() || undefined,
      locale: form.locale.trim() || undefined,
      accept_language: form.accept_language.trim() || undefined,
      geolocation_lat: parseOptionalNumber(form.geolocation_lat),
      geolocation_lng: parseOptionalNumber(form.geolocation_lng),
      geolocation_accuracy_m: parseOptionalNumber(form.geolocation_accuracy_m),
      user_agent: form.user_agent.trim() || undefined,
      platform: form.platform.trim() || undefined,
      viewport_width: parseOptionalNumber(form.viewport_width),
      viewport_height: parseOptionalNumber(form.viewport_height),
      device_scale_factor: parseOptionalNumber(form.device_scale_factor),
    };

    const hasInvalidNumber = [
      request.geolocation_lat,
      request.geolocation_lng,
      request.geolocation_accuracy_m,
      request.viewport_width,
      request.viewport_height,
      request.device_scale_factor,
    ].some((value) => Number.isNaN(value));
    if (hasInvalidNumber) {
      onMessage?.({ type: "error", text: "数字字段格式不正确" });
      return;
    }

    setSubmitting(true);
    try {
      const saved =
        await browserRuntimeApi.saveBrowserEnvironmentPreset(request);
      await refreshPresets(showArchived);
      setForm(toFormState(saved));
      onMessage?.({
        type: "success",
        text: form.id
          ? `已更新环境预设：${saved.name}`
          : `已创建环境预设：${saved.name}`,
      });
      setFormOpen(false);
    } catch (error) {
      onMessage?.({
        type: "error",
        text: `保存环境预设失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setSubmitting(false);
    }
  }, [form, onMessage, refreshPresets, showArchived]);

  const handleArchive = useCallback(
    async (preset: BrowserEnvironmentPresetRecord) => {
      try {
        await browserRuntimeApi.archiveBrowserEnvironmentPreset(preset.id);
        await refreshPresets(showArchived);
        if (form.id === preset.id) {
          resetForm();
        }
        onMessage?.({
          type: "success",
          text: `已归档环境预设：${preset.name}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `归档环境预设失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [form.id, onMessage, refreshPresets, resetForm, showArchived],
  );

  const handleRestore = useCallback(
    async (preset: BrowserEnvironmentPresetRecord) => {
      try {
        await browserRuntimeApi.restoreBrowserEnvironmentPreset(preset.id);
        await refreshPresets(showArchived);
        onMessage?.({
          type: "success",
          text: `已恢复环境预设：${preset.name}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `恢复环境预设失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [onMessage, refreshPresets, showArchived],
  );

  return (
    <section className="rounded-lg border p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">环境预设</h2>
          <p className="text-sm text-muted-foreground">
            统一管理代理、时区、语言、地理位置与设备视口。代理属于启动参数，切换前需要先关闭当前资料会话。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>资料启动环境</span>
            <select
              value={selectedPresetId}
              onChange={(event) => onSelectedPresetChange?.(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">无预设</option>
              {activePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refreshPresets(showArchived)}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-60"
          >
            {loading ? "刷新中..." : "刷新预设"}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-sm text-white transition hover:bg-slate-700 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            <SquarePen className="h-4 w-4" />
            新建预设
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          活跃预设:
          <span className="ml-1 font-medium text-foreground">
            {activePresets.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setShowArchived((value) => !value)}
          className="rounded-md border px-2 py-1 transition hover:bg-muted"
        >
          {showArchived ? "隐藏已归档" : "显示已归档"}
        </button>
      </div>

      {formOpen ? (
        <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">预设名称</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  name: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="例如：美区桌面住宅网络"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">代理服务器</span>
            <input
              value={form.proxy_server}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  proxy_server: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="http://127.0.0.1:7890"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">时区</span>
            <input
              value={form.timezone_id}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  timezone_id: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="America/Los_Angeles"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Locale</span>
            <input
              value={form.locale}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  locale: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="en-US"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Accept-Language</span>
            <input
              value={form.accept_language}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  accept_language: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="en-US,en;q=0.9"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Platform</span>
            <input
              value={form.platform}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  platform: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="MacIntel"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">纬度</span>
            <input
              value={form.geolocation_lat}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  geolocation_lat: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="37.7749"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">经度</span>
            <input
              value={form.geolocation_lng}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  geolocation_lng: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="-122.4194"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">精度(米)</span>
            <input
              value={form.geolocation_accuracy_m}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  geolocation_accuracy_m: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="100"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">视口宽度</span>
            <input
              value={form.viewport_width}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  viewport_width: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="1440"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">视口高度</span>
            <input
              value={form.viewport_height}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  viewport_height: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="900"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">设备像素比</span>
            <input
              value={form.device_scale_factor}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  device_scale_factor: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="2"
            />
          </label>
          <label className="space-y-1 text-sm xl:col-span-3">
            <span className="text-muted-foreground">User-Agent</span>
            <input
              value={form.user_agent}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  user_agent: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="Mozilla/5.0 ..."
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2 xl:col-span-3">
            <span className="text-muted-foreground">说明</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  description: event.target.value,
                }))
              }
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2"
              placeholder="记录网络来源、地区语境、适用站点等"
            />
          </label>
          <div className="md:col-span-2 xl:col-span-3 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-sm text-white transition hover:bg-emerald-600 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {submitting ? "保存中..." : form.id ? "更新预设" : "创建预设"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {presets.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            还没有环境预设。先创建一个环境，再从资料卡片选择它进行启动。
          </div>
        ) : null}

        {presets.map((preset) => {
          const isArchived = preset.archived_at !== null;
          return (
            <article
              key={preset.id}
              className={`rounded-xl border px-4 py-4 transition ${
                isArchived ? "border-dashed opacity-70" : "bg-background"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{preset.name}</h3>
                    {selectedPresetId === preset.id && !isArchived ? (
                      <span className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">
                        当前启动环境
                      </span>
                    ) : null}
                    {isArchived ? (
                      <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                        已归档
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>代理: {preset.proxy_server || "未设置"}</span>
                    <span>时区: {preset.timezone_id || "未设置"}</span>
                    <span>Locale: {preset.locale || "未设置"}</span>
                    <span>最近使用: {preset.last_used_at || "从未"}</span>
                  </div>
                  {preset.description ? (
                    <p className="max-w-3xl text-sm text-muted-foreground">
                      {preset.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isArchived ? (
                    <button
                      type="button"
                      onClick={() => void handleRestore(preset)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleEdit(preset)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchive(preset)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        归档
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
