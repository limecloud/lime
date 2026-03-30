import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, RefreshCw, ScrollText, Sparkles, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { clearSiteAdapterCatalogCache } from "@/lib/siteAdapterCatalogBootstrap";
import {
  emitSiteAdapterCatalogBootstrap,
  extractSiteAdapterCatalogFromBootstrapPayload,
  subscribeSiteAdapterCatalogChanged,
} from "@/lib/siteAdapterCatalogBootstrap";
import {
  siteGetAdapterCatalogStatus,
  siteImportAdapterYamlBundle,
  siteListAdapters,
  type SiteAdapterCatalogStatus,
  type SiteAdapterDefinition,
} from "@/lib/webview-api";
import {
  DANGER_BUTTON_CLASS_NAME,
  DeveloperInlineMessage,
  type DeveloperPanelMessage,
  SECONDARY_BUTTON_CLASS_NAME,
} from "./shared";

const DEFAULT_SITE_ADAPTER_CATALOG_EDITOR_VALUE = JSON.stringify(
  {
    siteAdapterCatalog: {
      catalogVersion: "tenant-site-2026-03-26",
      tenantId: "tenant-demo",
      syncedAt: "2026-03-26T12:00:00.000Z",
      adapters: [
        {
          name: "github/search",
          domain: "github.com",
          description: "服务端下发的 GitHub 搜索脚本",
          read_only: true,
          capabilities: ["search", "research"],
          args: [
            {
              name: "query",
              description: "搜索关键词",
              required: true,
              arg_type: "string",
              example: "model context protocol",
            },
          ],
          example: 'github/search {"query":"model context protocol"}',
          entry: {
            kind: "fixed_url",
            url: "https://github.com/search",
          },
          script:
            "async ({ query }) => ({ items: [{ title: query, url: location.href }] })",
          sourceVersion: "tenant-site-2026-03-26",
        },
      ],
    },
  },
  null,
  2,
);

const DEFAULT_SITE_ADAPTER_IMPORT_EDITOR_VALUE = `site: reddit
name: hot
description: Reddit 热门帖子
domain: www.reddit.com
args:
  subreddit:
    type: str
    default: ""
    description: Subreddit 名称
  limit:
    type: int
    default: 20
    description: 返回条目数量
pipeline:
  - navigate: https://www.reddit.com
  - evaluate: |
      (async () => {
        const sub = \${{ args.subreddit | json }};
        const path = sub ? '/r/' + sub + '/hot.json' : '/hot.json';
        const limit = \${{ args.limit }};
        const response = await fetch(path + '?limit=' + limit, { credentials: 'include' });
        const data = await response.json();
        return (data?.data?.children || []).map((item) => ({
          title: item.data.title,
          subreddit: item.data.subreddit_name_prefixed,
          score: item.data.score,
        }));
      })()
  - map:
      rank: \${{ index + 1 }}
      title: \${{ item.title }}
      subreddit: \${{ item.subreddit }}
      score: \${{ item.score }}
  - limit: \${{ args.limit }}
columns: [rank, title, subreddit, score]
`;

function toErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SiteAdapterCatalogTools() {
  const [busy, setBusy] = useState(false);
  const [siteCatalogEditorValue, setSiteCatalogEditorValue] = useState("");
  const [siteImportEditorValue, setSiteImportEditorValue] = useState("");
  const [siteCatalogStatus, setSiteCatalogStatus] =
    useState<SiteAdapterCatalogStatus | null>(null);
  const [siteAdapters, setSiteAdapters] = useState<SiteAdapterDefinition[]>([]);
  const [message, setMessage] = useState<DeveloperPanelMessage | null>(null);

  const showMessage = useCallback((next: DeveloperPanelMessage) => {
    setMessage(next);
    setTimeout(() => setMessage(null), 2500);
  }, []);

  const loadSiteAdapterCatalog = useCallback(async () => {
    const [status, adapters] = await Promise.all([
      siteGetAdapterCatalogStatus(),
      siteListAdapters(),
    ]);
    setSiteCatalogStatus(status);
    setSiteAdapters(adapters);
    return { status, adapters };
  }, []);

  useEffect(() => {
    void loadSiteAdapterCatalog().catch((error) => {
      console.error("加载站点脚本目录失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "读取站点脚本目录失败"),
      });
    });
  }, [loadSiteAdapterCatalog, showMessage]);

  useEffect(() => {
    return subscribeSiteAdapterCatalogChanged(() => {
      void loadSiteAdapterCatalog().catch((error) => {
        console.error("刷新站点脚本目录失败:", error);
        showMessage({
          type: "error",
          text: toErrorText(error, "刷新站点脚本目录失败"),
        });
      });
    });
  }, [loadSiteAdapterCatalog, showMessage]);

  const handleHydrateSiteCatalogEditorWithTemplate = useCallback(() => {
    setSiteCatalogEditorValue(DEFAULT_SITE_ADAPTER_CATALOG_EDITOR_VALUE);
    showMessage({
      type: "success",
      text: "已写入站点脚本目录示例 Payload",
    });
  }, [showMessage]);

  const handleHydrateSiteImportEditorWithTemplate = useCallback(() => {
    setSiteImportEditorValue(DEFAULT_SITE_ADAPTER_IMPORT_EDITOR_VALUE);
    showMessage({
      type: "success",
      text: "已写入外部来源 YAML 示例",
    });
  }, [showMessage]);

  const handleRefreshSiteCatalog = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { adapters } = await loadSiteAdapterCatalog();
      showMessage({
        type: "success",
        text: `已刷新站点脚本目录状态：${adapters.length} 项生效适配器`,
      });
    } catch (error) {
      console.error("刷新站点脚本目录状态失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "刷新站点脚本目录状态失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [loadSiteAdapterCatalog, showMessage]);

  const handleApplySiteCatalogPayload = useCallback(async () => {
    const raw = siteCatalogEditorValue.trim();
    if (!raw) {
      showMessage({
        type: "error",
        text: "请先输入 siteAdapterCatalog JSON",
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(raw) as unknown;
      const previewCatalog =
        extractSiteAdapterCatalogFromBootstrapPayload(parsed);
      if (!previewCatalog) {
        throw new Error(
          "JSON 中未找到合法的 siteAdapterCatalog，可传目录本体或 { siteAdapterCatalog: ... }",
        );
      }

      const adapterCount = Array.isArray(
        (previewCatalog as { adapters?: unknown }).adapters,
      )
        ? ((previewCatalog as { adapters: unknown[] }).adapters?.length ?? 0)
        : 0;
      emitSiteAdapterCatalogBootstrap(parsed);
      showMessage({
        type: "success",
        text: `已通过 bootstrap 事件注入站点脚本目录：${adapterCount} 项`,
      });
    } catch (error) {
      console.error("注入站点脚本目录失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "注入站点脚本目录失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [showMessage, siteCatalogEditorValue]);

  const handleClearSiteCatalog = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await clearSiteAdapterCatalogCache();
      const { adapters } = await loadSiteAdapterCatalog();
      showMessage({
        type: "success",
        text: `已清空站点脚本目录缓存，当前回退到应用内置：${adapters.length} 项`,
      });
    } catch (error) {
      console.error("清空站点脚本目录缓存失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "清空站点脚本目录缓存失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [loadSiteAdapterCatalog, showMessage]);

  const handleImportSiteAdapterYamlBundle = useCallback(async () => {
    const raw = siteImportEditorValue.trim();
    if (!raw) {
      showMessage({
        type: "error",
        text: "请先输入外部来源 YAML",
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await siteImportAdapterYamlBundle({
        yaml_bundle: raw,
      });
      const { adapters } = await loadSiteAdapterCatalog();
      showMessage({
        type: "success",
        text: `已按 Lime 标准导入 ${result.adapter_count} 项外部适配器，当前生效 ${adapters.length} 项`,
      });
    } catch (error) {
      console.error("导入外部站点适配器来源失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "导入外部站点适配器来源失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [loadSiteAdapterCatalog, showMessage, siteImportEditorValue]);

  const siteCatalogSourceLabel = useMemo(() => {
    if (!siteCatalogStatus) {
      return "加载中";
    }

    if (siteCatalogStatus.source_kind === "server_synced") {
      return "服务端同步";
    }

    if (siteCatalogStatus.source_kind === "imported") {
      return "外部导入";
    }

    return "应用内置";
  }, [siteCatalogStatus]);

  return (
    <div className="space-y-4">
      {message ? <DeveloperInlineMessage message={message} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Source
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {siteCatalogSourceLabel}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Effective
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {siteAdapters.length}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Catalog
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {siteCatalogStatus?.exists ? siteCatalogStatus.adapter_count : 0}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Synced At
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {siteCatalogStatus?.synced_at ?? "未同步"}
          </p>
        </div>
      </div>

      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">
              当前生效目录摘要
            </p>
            <p className="text-sm leading-6 text-slate-500">
              这里展示的是运行时当前可见的适配器。如果外部导入或服务端同步只覆盖了部分站点，其余能力仍会由应用内置目录补位。
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
            {busy ? "目录操作执行中" : "目录状态空闲"}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {siteAdapters.slice(0, 4).map((adapter) => (
            <span
              key={adapter.name}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              {adapter.name}
            </span>
          ))}
          {siteAdapters.length > 4 ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
              还有 {siteAdapters.length - 4} 项
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
          <div>目录版本：{siteCatalogStatus?.catalog_version ?? "应用内置"}</div>
          <div>租户：{siteCatalogStatus?.tenant_id ?? "未绑定租户"}</div>
        </div>
      </div>

      <div className="space-y-3 rounded-[22px] border border-slate-200/80 bg-white p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">
            外部来源 YAML 导入
          </p>
          <p className="text-sm leading-6 text-slate-500">
            把外部来源 YAML 粘贴到这里，点击“导入到 Lime 标准”后会先走 Lime
            白名单编译层，再写入
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              imported
            </code>
            目录。这里只接受当前支持子集：
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              navigate / evaluate / map / filter / limit / sort
            </code>
            。
          </p>
        </div>

        <Textarea
          aria-label="站点来源 YAML 导入输入"
          value={siteImportEditorValue}
          onChange={(event) => setSiteImportEditorValue(event.target.value)}
          placeholder={DEFAULT_SITE_ADAPTER_IMPORT_EDITOR_VALUE}
          className="min-h-[260px] rounded-[18px] border-slate-200/80 bg-slate-50/60 font-mono text-xs leading-6 text-slate-700"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleHydrateSiteImportEditorWithTemplate}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <ScrollText className="h-4 w-4" />
            填入 YAML 示例
          </button>
          <button
            type="button"
            onClick={() => void handleImportSiteAdapterYamlBundle()}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <Sparkles className="h-4 w-4" />
            导入到 Lime 标准
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-[22px] border border-slate-200/80 bg-white p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">
            Bootstrap Payload 调试输入
          </p>
          <p className="text-sm leading-6 text-slate-500">
            支持目录本体，或
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              {"{ siteAdapterCatalog: ... }"}
            </code>
            包装对象。点击“通过事件注入”会走与服务端运行时推送一致的客户端链路。
          </p>
        </div>

        <Textarea
          aria-label="站点脚本目录调试输入"
          value={siteCatalogEditorValue}
          onChange={(event) => setSiteCatalogEditorValue(event.target.value)}
          placeholder={DEFAULT_SITE_ADAPTER_CATALOG_EDITOR_VALUE}
          className="min-h-[240px] rounded-[18px] border-slate-200/80 bg-slate-50/60 font-mono text-xs leading-6 text-slate-700"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleHydrateSiteCatalogEditorWithTemplate}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <ScrollText className="h-4 w-4" />
            填入站点示例
          </button>
          <button
            type="button"
            onClick={() => void handleRefreshSiteCatalog()}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <RefreshCw className="h-4 w-4" />
            刷新站点状态
          </button>
          <button
            type="button"
            onClick={() => void handleApplySiteCatalogPayload()}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <Globe className="h-4 w-4" />
            注入站点目录
          </button>
          <button
            type="button"
            onClick={() => void handleClearSiteCatalog()}
            disabled={busy}
            className={DANGER_BUTTON_CLASS_NAME}
          >
            <Trash2 className="h-4 w-4" />
            清空站点目录缓存
          </button>
        </div>
      </div>
    </div>
  );
}
