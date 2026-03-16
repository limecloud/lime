import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Archive,
  PencilLine,
  Play,
  RotateCcw,
  Save,
  SquarePen,
} from "lucide-react";
import { browserRuntimeApi } from "./api";
import { getExistingSessionTabLabel } from "./existingSessionBridge";
import { getExistingSessionBridgeStatus } from "./existingSessionBridgeClient";
import type {
  BrowserEnvironmentPresetRecord,
  BrowserProfileRecord,
  BrowserProfileTransportKind,
} from "./api";
import { useExistingSessionProfileManager } from "./useExistingSessionProfileManager";

type RuntimeMessage = {
  type: "success" | "error";
  text: string;
};

interface BrowserProfileManagerProps {
  onMessage?: (message: RuntimeMessage) => void;
  onProfileLaunched?: (profileKey: string) => void;
  launchEnvironmentPresetId?: string;
  launchEnvironmentPresetOptions?: Array<
    Pick<BrowserEnvironmentPresetRecord, "id" | "name">
  >;
  onLaunchEnvironmentPresetChange?: (presetId: string) => void;
}

type ProfileFormState = {
  id?: string;
  profile_key: string;
  name: string;
  description: string;
  site_scope: string;
  launch_url: string;
  transport_kind: BrowserProfileTransportKind;
};

const EMPTY_FORM: ProfileFormState = {
  profile_key: "",
  name: "",
  description: "",
  site_scope: "",
  launch_url: "",
  transport_kind: "managed_cdp",
};

const PROFILE_TRANSPORT_OPTIONS: Array<{
  value: BrowserProfileTransportKind;
  label: string;
  description: string;
}> = [
  {
    value: "managed_cdp",
    label: "托管浏览器",
    description:
      "由 ProxyCast 启动并管理独立 Chrome 资料，兼容当前实时会话链路。",
  },
  {
    value: "existing_session",
    label: "附着当前 Chrome",
    description: "复用你已登录的 Chrome，会话附着链路后续单独接入。",
  },
];

function getProfileTransportLabel(transportKind: BrowserProfileTransportKind) {
  return (
    PROFILE_TRANSPORT_OPTIONS.find((option) => option.value === transportKind)
      ?.label ?? "托管浏览器"
  );
}

function getExistingSessionEnvironmentNotice(
  presetName?: string | null,
): string | null {
  if (!presetName) {
    return null;
  }
  return `已选择启动环境 "${presetName}"，但附着当前 Chrome 模式暂不应用代理、时区、语言、UA 或视口等启动级配置；如需这些能力，请改用托管浏览器模式。`;
}

function toFormState(profile: BrowserProfileRecord): ProfileFormState {
  return {
    id: profile.id,
    profile_key: profile.profile_key,
    name: profile.name,
    description: profile.description ?? "",
    site_scope: profile.site_scope ?? "",
    launch_url: profile.launch_url ?? "",
    transport_kind: profile.transport_kind ?? "managed_cdp",
  };
}

export function BrowserProfileManager(props: BrowserProfileManagerProps) {
  const {
    onMessage,
    onProfileLaunched,
    launchEnvironmentPresetId = "",
    launchEnvironmentPresetOptions = [],
    onLaunchEnvironmentPresetChange,
  } = props;
  const [profiles, setProfiles] = useState<BrowserProfileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);

  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.archived_at === null),
    [profiles],
  );
  const selectedLaunchEnvironmentPreset = useMemo(
    () =>
      launchEnvironmentPresetOptions.find(
        (preset) => preset.id === launchEnvironmentPresetId,
      ) ?? null,
    [launchEnvironmentPresetId, launchEnvironmentPresetOptions],
  );
  const existingSessionEnvironmentNotice = useMemo(
    () =>
      getExistingSessionEnvironmentNotice(
        selectedLaunchEnvironmentPreset?.name ?? null,
      ),
    [selectedLaunchEnvironmentPreset],
  );
  const {
    attachProfiles,
    bridgeObserverMap,
    bridgeConnectionCount,
    connectedAttachCount,
    pageInfoByProfileKey,
    tabsByProfileKey,
    tabPanelsOpen,
    loadingTabsByProfileKey,
    switchingTabKey,
    syncBridgeStatus,
    loadExistingSessionTabs,
    handleAttachExistingSession,
    handleToggleExistingSessionTabs,
    handleSwitchExistingSessionTab,
  } = useExistingSessionProfileManager({
    profiles,
    existingSessionEnvironmentNotice,
    onMessage,
    onProfileLaunched,
  });

  const refreshProfiles = useCallback(
    async (includeArchived = showArchived) => {
      setLoading(true);
      try {
        const [nextProfiles, nextBridgeStatus] = await Promise.all([
          browserRuntimeApi.listBrowserProfiles({
            include_archived: includeArchived,
          }),
          getExistingSessionBridgeStatus(),
        ]);
        startTransition(() => {
          setProfiles(nextProfiles);
        });
        syncBridgeStatus(nextBridgeStatus);
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `读取已保存资料失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        setLoading(false);
      }
    },
    [onMessage, showArchived, syncBridgeStatus],
  );

  useEffect(() => {
    void refreshProfiles(showArchived);
  }, [refreshProfiles, showArchived]);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormOpen(false);
  }, []);

  const handleCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((profile: BrowserProfileRecord) => {
    setForm(toFormState(profile));
    setFormOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      onMessage?.({ type: "error", text: "资料名称不能为空" });
      return;
    }
    if (!form.id && !form.profile_key.trim()) {
      onMessage?.({ type: "error", text: "新建资料时必须填写资料 Key" });
      return;
    }

    setSubmitting(true);
    try {
      const saved = await browserRuntimeApi.saveBrowserProfile({
        id: form.id,
        profile_key: form.profile_key.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        site_scope: form.site_scope.trim() || undefined,
        launch_url: form.launch_url.trim() || undefined,
        transport_kind: form.transport_kind,
      });
      await refreshProfiles(showArchived);
      setForm(toFormState(saved));
      onMessage?.({
        type: "success",
        text: form.id
          ? `已更新资料：${saved.name}`
          : `已创建资料：${saved.name}`,
      });
      setFormOpen(false);
    } catch (error) {
      onMessage?.({
        type: "error",
        text: `保存资料失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setSubmitting(false);
    }
  }, [form, onMessage, refreshProfiles, showArchived]);

  const handleArchive = useCallback(
    async (profile: BrowserProfileRecord) => {
      try {
        await browserRuntimeApi.archiveBrowserProfile(profile.id);
        await refreshProfiles(showArchived);
        if (form.id === profile.id) {
          resetForm();
        }
        onMessage?.({
          type: "success",
          text: `已归档资料：${profile.name}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `归档资料失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [form.id, onMessage, refreshProfiles, resetForm, showArchived],
  );

  const handleRestore = useCallback(
    async (profile: BrowserProfileRecord) => {
      try {
        await browserRuntimeApi.restoreBrowserProfile(profile.id);
        await refreshProfiles(showArchived);
        onMessage?.({
          type: "success",
          text: `已恢复资料：${profile.name}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `恢复资料失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [onMessage, refreshProfiles, showArchived],
  );

  const handleLaunch = useCallback(
    async (profile: BrowserProfileRecord) => {
      try {
        if (profile.transport_kind === "existing_session") {
          await handleAttachExistingSession(profile);
          return;
        }
        await browserRuntimeApi.launchBrowserSession({
          profile_id: profile.id,
          environment_preset_id: launchEnvironmentPresetId || undefined,
          open_window: false,
          stream_mode: "both",
        });
        await refreshProfiles(showArchived);
        onProfileLaunched?.(profile.profile_key);
        onMessage?.({
          type: "success",
          text: selectedLaunchEnvironmentPreset
            ? `已启动资料：${profile.name}（环境：${selectedLaunchEnvironmentPreset.name}）`
            : `已启动资料：${profile.name}`,
        });
      } catch (error) {
        onMessage?.({
          type: "error",
          text: `启动资料失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [
      handleAttachExistingSession,
      launchEnvironmentPresetId,
      onMessage,
      onProfileLaunched,
      refreshProfiles,
      selectedLaunchEnvironmentPreset,
      showArchived,
    ],
  );

  return (
    <section className="rounded-lg border p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">已保存资料</h2>
          <p className="text-sm text-muted-foreground">
            把浏览器登录态从临时 `profile_key`
            升级为可管理资料，后续任务与环境预设都围绕这里收口。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>启动环境</span>
            <select
              value={launchEnvironmentPresetId}
              onChange={(event) =>
                onLaunchEnvironmentPresetChange?.(event.target.value)
              }
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">无预设</option>
              {launchEnvironmentPresetOptions.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refreshProfiles(showArchived)}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-60"
          >
            {loading ? "刷新中..." : "刷新资料"}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-sm text-white transition hover:bg-slate-700 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            <SquarePen className="h-4 w-4" />
            新建资料
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          活跃资料:
          <span className="ml-1 font-medium text-foreground">
            {activeProfiles.length}
          </span>
        </span>
        <span>
          当前 Chrome 附着:
          <span className="ml-1 font-medium text-foreground">
            {connectedAttachCount}
          </span>
          /{attachProfiles.length}
        </span>
        <button
          type="button"
          onClick={() => setShowArchived((value) => !value)}
          className="rounded-md border px-2 py-1 transition hover:bg-muted"
        >
          {showArchived ? "隐藏已归档" : "显示已归档"}
        </button>
        <span>
          当前启动环境:
          <span className="ml-1 font-medium text-foreground">
            {selectedLaunchEnvironmentPreset?.name || "无预设"}
          </span>
        </span>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          bridgeConnectionCount > 0
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
        }`}
      >
        <span className="font-medium">
          {bridgeConnectionCount > 0
            ? "附着模式当前设备可用。"
            : "附着模式当前设备未就绪。"}
        </span>
        <span className="ml-1">
          {bridgeConnectionCount > 0
            ? `已检测到 ${bridgeConnectionCount} 个当前 Chrome 连接，可直接用于发文、填表和已登录页面操作。`
            : "请先在当前 Chrome 安装并连接 Proxycast Browser Bridge；如需立即使用代理、时区、语言、UA 或视口配置，请改用托管浏览器模式。"}
        </span>
      </div>

      {formOpen ? (
        <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">资料名称</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  name: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="例如：美区电商账号"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">资料 Key</span>
            <input
              value={form.profile_key}
              disabled={Boolean(form.id)}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  profile_key: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3 disabled:cursor-not-allowed disabled:bg-muted"
              placeholder="例如：shop_us"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">运行模式</span>
            <select
              value={form.transport_kind}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  transport_kind: event.target
                    .value as BrowserProfileTransportKind,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {PROFILE_TRANSPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">站点范围</span>
            <input
              value={form.site_scope}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  site_scope: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="例如：seller.amazon.com"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">默认启动地址</span>
            <input
              value={form.launch_url}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  launch_url: event.target.value,
                }))
              }
              className="h-10 w-full rounded-md border bg-background px-3"
              placeholder="https://example.com"
            />
          </label>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 md:col-span-2 dark:text-amber-200">
            {PROFILE_TRANSPORT_OPTIONS.find(
              (option) => option.value === form.transport_kind,
            )?.description ?? ""}
            {form.transport_kind === "existing_session"
              ? " 当前版本先通过 Proxycast Browser Bridge 扩展接入可见页面，适合发文、填表和切换标签页。"
              : ""}
          </div>
          {form.transport_kind === "existing_session" &&
          existingSessionEnvironmentNotice ? (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 md:col-span-2 dark:text-sky-200">
              {existingSessionEnvironmentNotice}
            </div>
          ) : null}
          <label className="space-y-1 text-sm md:col-span-2">
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
              placeholder="记录账号用途、地区、登录约束等信息"
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2">
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
              {submitting ? "保存中..." : form.id ? "更新资料" : "创建资料"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {profiles.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            还没有已保存资料。先创建一个资料，再用它启动浏览器并完成登录。
          </div>
        ) : null}

        {profiles.map((profile) => {
          const isArchived = profile.archived_at !== null;
          const transportKind = profile.transport_kind ?? "managed_cdp";
          const bridgeObserver =
            transportKind === "existing_session"
              ? bridgeObserverMap.get(profile.profile_key)
              : null;
          const pageInfo =
            transportKind === "existing_session"
              ? pageInfoByProfileKey[profile.profile_key] ??
                bridgeObserver?.last_page_info ??
                null
              : null;
          const currentTabs = tabsByProfileKey[profile.profile_key] ?? [];
          const isTabPanelOpen = tabPanelsOpen[profile.profile_key] === true;
          const isTabsLoading =
            loadingTabsByProfileKey[profile.profile_key] === true;
          return (
            <article
              key={profile.id}
              className={`rounded-xl border px-4 py-4 transition ${
                isArchived ? "border-dashed opacity-70" : "bg-background"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{profile.name}</h3>
                    <span className="rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {profile.profile_key}
                    </span>
                    <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-200">
                      {getProfileTransportLabel(transportKind)}
                    </span>
                    {transportKind === "existing_session" ? (
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] ${
                          bridgeObserver
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {bridgeObserver
                          ? "当前 Chrome 已连接"
                          : "等待当前 Chrome 连接"}
                      </span>
                    ) : null}
                    {isArchived ? (
                      <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                        已归档
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>站点: {profile.site_scope || "未设置"}</span>
                    <span>
                      默认地址:{" "}
                      {profile.launch_url || "https://www.google.com/"}
                    </span>
                    <span>最近使用: {profile.last_used_at || "从未"}</span>
                    {bridgeObserver ? (
                      <span>
                        当前页面:{" "}
                        {pageInfo?.title || pageInfo?.url || "已连接"}
                      </span>
                    ) : null}
                  </div>
                  {profile.description ? (
                    <p className="max-w-3xl text-sm text-muted-foreground">
                      {profile.description}
                    </p>
                  ) : null}
                  {transportKind === "existing_session" &&
                  existingSessionEnvironmentNotice ? (
                    <p className="max-w-3xl text-xs text-amber-700 dark:text-amber-300">
                      {existingSessionEnvironmentNotice}
                    </p>
                  ) : null}
                  {transportKind === "existing_session" && isTabPanelOpen ? (
                    <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-foreground">
                            当前窗口标签页
                          </div>
                          <p className="text-xs text-muted-foreground">
                            切换后会同步更新当前页面摘要，适合在发文或填表前选中目标页。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void loadExistingSessionTabs(profile, {
                              quiet: true,
                              open: true,
                            }).catch(() => undefined)
                          }
                          disabled={isTabsLoading}
                          className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs hover:bg-muted disabled:opacity-60"
                        >
                          {isTabsLoading ? "刷新中..." : "刷新标签页"}
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {currentTabs.length === 0 ? (
                          <div className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                            还没有读取到当前窗口标签页。可先在 Chrome
                            中打开目标页面，再刷新标签页。
                          </div>
                        ) : (
                          currentTabs.map((tab) => {
                            const currentSwitchingTabKey = `${profile.profile_key}:${tab.id}`;
                            const isSwitching =
                              switchingTabKey === currentSwitchingTabKey;
                            return (
                              <div
                                key={tab.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                                      #{tab.index + 1}
                                    </span>
                                    {tab.active ? (
                                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-200">
                                        当前页
                                      </span>
                                    ) : null}
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {getExistingSessionTabLabel(tab)}
                                    </span>
                                  </div>
                                  {tab.url ? (
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                      {tab.url}
                                    </p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSwitchExistingSessionTab(
                                      profile,
                                      tab,
                                    )
                                  }
                                  disabled={tab.active || isSwitching}
                                  className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {tab.active
                                    ? "当前标签页"
                                    : isSwitching
                                      ? "切换中..."
                                      : "切换到此页"}
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isArchived ? (
                    <button
                      type="button"
                      onClick={() => void handleRestore(profile)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复
                    </button>
                  ) : (
                    <>
                      {transportKind === "existing_session" ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleExistingSessionTabs(profile)
                          }
                          disabled={!bridgeObserver || isTabsLoading}
                          className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isTabsLoading
                            ? "读取中..."
                            : isTabPanelOpen
                              ? "收起标签页"
                              : "查看标签页"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleLaunch(profile)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-700 bg-sky-700 px-2.5 text-xs text-white transition hover:bg-sky-600"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {transportKind === "existing_session"
                          ? "附着当前 Chrome"
                          : "启动实时会话"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(profile)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-muted"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchive(profile)}
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
