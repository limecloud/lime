import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, ScrollText, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  clearServiceSkillCatalogCache,
  getServiceSkillCatalog,
  subscribeServiceSkillCatalogChanged,
  type ServiceSkillCatalog,
} from "@/lib/api/serviceSkills";
import {
  emitServiceSkillCatalogBootstrap,
  extractServiceSkillCatalogFromBootstrapPayload,
} from "@/lib/serviceSkillCatalogBootstrap";
import {
  DANGER_BUTTON_CLASS_NAME,
  DeveloperInlineMessage,
  type DeveloperPanelMessage,
  SECONDARY_BUTTON_CLASS_NAME,
} from "./shared";

function toErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ServiceSkillCatalogTools() {
  const [busy, setBusy] = useState(false);
  const [catalogEditorValue, setCatalogEditorValue] = useState("");
  const [serviceCatalog, setServiceCatalog] =
    useState<ServiceSkillCatalog | null>(null);
  const [message, setMessage] = useState<DeveloperPanelMessage | null>(null);

  const showMessage = useCallback((next: DeveloperPanelMessage) => {
    setMessage(next);
    setTimeout(() => setMessage(null), 2500);
  }, []);

  const loadServiceSkillCatalog = useCallback(async () => {
    const catalog = await getServiceSkillCatalog();
    setServiceCatalog(catalog);
    return catalog;
  }, []);

  useEffect(() => {
    void loadServiceSkillCatalog().catch((error) => {
      console.error("加载服务型技能目录失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "读取服务型技能目录失败"),
      });
    });
  }, [loadServiceSkillCatalog, showMessage]);

  useEffect(() => {
    return subscribeServiceSkillCatalogChanged(() => {
      void loadServiceSkillCatalog().catch((error) => {
        console.error("刷新服务型技能目录失败:", error);
        showMessage({
          type: "error",
          text: toErrorText(error, "刷新服务型技能目录失败"),
        });
      });
    });
  }, [loadServiceSkillCatalog, showMessage]);

  const handleHydrateCatalogEditor = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const catalog = await loadServiceSkillCatalog();
      setCatalogEditorValue(
        JSON.stringify(
          {
            serviceSkillCatalog: catalog,
          },
          null,
          2,
        ),
      );
      showMessage({
        type: "success",
        text: "已把当前目录写入调试编辑器",
      });
    } catch (error) {
      console.error("读取服务型技能目录失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "读取服务型技能目录失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [loadServiceSkillCatalog, showMessage]);

  const handleApplyCatalogPayload = useCallback(async () => {
    const raw = catalogEditorValue.trim();
    if (!raw) {
      showMessage({
        type: "error",
        text: "请先输入 serviceSkillCatalog JSON",
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(raw) as unknown;
      const previewCatalog =
        extractServiceSkillCatalogFromBootstrapPayload(parsed);
      if (!previewCatalog) {
        throw new Error(
          "JSON 中未找到合法的 serviceSkillCatalog，可传目录本体或 { serviceSkillCatalog: ... }",
        );
      }

      emitServiceSkillCatalogBootstrap(parsed);
      showMessage({
        type: "success",
        text: `已通过 bootstrap 事件注入目录：${previewCatalog.items.length} 项`,
      });
    } catch (error) {
      console.error("注入服务型技能目录失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "注入服务型技能目录失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [catalogEditorValue, showMessage]);

  const handleClearServiceSkillCatalog = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      clearServiceSkillCatalogCache();
      const catalog = await loadServiceSkillCatalog();
      showMessage({
        type: "success",
        text: `已清空远端目录缓存，当前回退到 seeded：${catalog.items.length} 项`,
      });
    } catch (error) {
      console.error("清空服务型技能目录缓存失败:", error);
      showMessage({
        type: "error",
        text: toErrorText(error, "清空服务型技能目录缓存失败"),
      });
    } finally {
      setBusy(false);
    }
  }, [loadServiceSkillCatalog, showMessage]);

  return (
    <div className="space-y-4">
      {message ? <DeveloperInlineMessage message={message} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Tenant
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {serviceCatalog?.tenantId ?? "加载中"}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Version
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {serviceCatalog?.version ?? "加载中"}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Items
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            {serviceCatalog?.items.length ?? 0}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
          <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
            Synced At
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {serviceCatalog?.syncedAt ?? "加载中"}
          </p>
        </div>
      </div>

      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900">当前目录摘要</p>
            <p className="text-sm leading-6 text-slate-500">
              这里展示当前客户端实际生效的目录。若首页服务型技能没刷新，先看这里是否已经同步。
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
            {busy ? "目录操作执行中" : "目录状态空闲"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(serviceCatalog?.items ?? []).slice(0, 4).map((item) => (
            <span
              key={item.id}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              {item.title}
            </span>
          ))}
          {(serviceCatalog?.items.length ?? 0) > 4 ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
              还有 {(serviceCatalog?.items.length ?? 0) - 4} 项
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-[22px] border border-slate-200/80 bg-white p-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">
            Bootstrap Payload 调试输入
          </p>
          <p className="text-sm leading-6 text-slate-500">
            支持两种格式：目录本体，或
            <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              {"{ serviceSkillCatalog: ... }"}
            </code>
            包装对象。点击“通过事件注入”会走和服务端运行时推送相同的客户端链路。
          </p>
        </div>

        <Textarea
          aria-label="服务型技能目录调试输入"
          value={catalogEditorValue}
          onChange={(event) => setCatalogEditorValue(event.target.value)}
          placeholder='{\n  "serviceSkillCatalog": {\n    "version": "tenant-2026-03-24",\n    "tenantId": "tenant-demo",\n    "syncedAt": "2026-03-24T12:00:00.000Z",\n    "items": []\n  }\n}'
          className="min-h-[240px] rounded-[18px] border-slate-200/80 bg-slate-50/60 font-mono text-xs leading-6 text-slate-700"
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleHydrateCatalogEditor()}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <ScrollText className="h-4 w-4" />
            载入当前目录
          </button>
          <button
            type="button"
            onClick={() => void handleApplyCatalogPayload()}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS_NAME}
          >
            <DatabaseZap className="h-4 w-4" />
            通过事件注入
          </button>
          <button
            type="button"
            onClick={() => void handleClearServiceSkillCatalog()}
            disabled={busy}
            className={DANGER_BUTTON_CLASS_NAME}
          >
            <Trash2 className="h-4 w-4" />
            清空目录缓存
          </button>
        </div>
      </div>
    </div>
  );
}
