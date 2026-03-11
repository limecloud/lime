import { useState } from "react";
import {
  Plus,
  Trash2,
  Globe,
  ArrowRight,
  Terminal,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { AmpConfig, AmpModelMapping } from "@/lib/api/providerRuntime";

interface AmpConfigSectionProps {
  config: AmpConfig;
  onChange: (config: AmpConfig) => void;
  onSave?: () => Promise<void>;
}

export function AmpConfigSection({
  config,
  onChange,
  onSave,
}: AmpConfigSectionProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editingMapping, setEditingMapping] = useState(false);
  const [mappingFrom, setMappingFrom] = useState("");
  const [mappingTo, setMappingTo] = useState("");

  // Ensure model_mappings is always an array
  const modelMappings = config?.model_mappings ?? [];

  const updateConfig = (updates: Partial<AmpConfig>) => {
    onChange({ ...config, ...updates });
  };

  const addMapping = () => {
    if (!mappingFrom.trim() || !mappingTo.trim()) return;
    const newMapping: AmpModelMapping = {
      from: mappingFrom.trim(),
      to: mappingTo.trim(),
    };
    updateConfig({
      model_mappings: [...modelMappings, newMapping],
    });
    setMappingFrom("");
    setMappingTo("");
  };

  const removeMapping = (from: string) => {
    updateConfig({
      model_mappings: modelMappings.filter((m) => m.from !== from),
    });
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    setMessage(null);
    try {
      await onSave();
      setMessage({ type: "success", text: "Amp CLI 配置已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setMessage({ type: "error", text: `保存失败: ${errorMessage}` });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-5 w-5 text-indigo-500" />
        <div>
          <h3 className="text-sm font-medium">Amp CLI 集成</h3>
          <p className="text-xs text-muted-foreground">
            配置 Amp CLI 的路由和模型映射
          </p>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${
            message.type === "error"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {message.text}
        </div>
      )}

      <div className="p-4 rounded-lg border space-y-4">
        {/* Upstream URL */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            <Globe className="h-4 w-4 inline mr-1" />
            上游 URL
          </label>
          <input
            type="text"
            value={config.upstream_url || ""}
            onChange={(e) =>
              updateConfig({ upstream_url: e.target.value || null })
            }
            placeholder="https://ampcode.com"
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Amp CLI 管理端点的上游服务器地址
          </p>
        </div>

        {/* Restrict Management to Localhost */}
        <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
          <div>
            <span className="text-sm font-medium">限制管理端点为本地访问</span>
            <p className="text-xs text-muted-foreground">
              仅允许 localhost 访问 Amp 管理端点
            </p>
          </div>
          <input
            type="checkbox"
            checked={config.restrict_management_to_localhost}
            onChange={(e) =>
              updateConfig({
                restrict_management_to_localhost: e.target.checked,
              })
            }
            className="w-4 h-4 rounded border-gray-300"
          />
        </label>

        {/* Model Mappings */}
        <div>
          <label className="block text-sm font-medium mb-2">模型映射</label>
          <p className="text-xs text-muted-foreground mb-3">
            将不可用的模型请求映射到可用的替代模型
          </p>

          {/* Existing Mappings */}
          {modelMappings.length > 0 && (
            <div className="space-y-2 mb-3">
              {modelMappings.map((mapping) => (
                <div
                  key={mapping.from}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm"
                >
                  <span className="font-mono text-xs bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded text-red-700 dark:text-red-400">
                    {mapping.from}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-xs bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-green-700 dark:text-green-400">
                    {mapping.to}
                  </span>
                  <button
                    onClick={() => removeMapping(mapping.from)}
                    className="ml-auto p-1 rounded hover:bg-red-100 text-red-500"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add New Mapping */}
          {editingMapping ? (
            <div className="space-y-2 p-3 rounded-lg border border-dashed">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={mappingFrom}
                  onChange={(e) => setMappingFrom(e.target.value)}
                  placeholder="源模型 (如 claude-opus-4.5)"
                  className="flex-1 px-3 py-1.5 rounded border bg-background text-sm"
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={mappingTo}
                  onChange={(e) => setMappingTo(e.target.value)}
                  placeholder="目标模型 (如 claude-sonnet-4)"
                  className="flex-1 px-3 py-1.5 rounded border bg-background text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addMapping}
                  disabled={!mappingFrom.trim() || !mappingTo.trim()}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
                >
                  添加
                </button>
                <button
                  onClick={() => {
                    setEditingMapping(false);
                    setMappingFrom("");
                    setMappingTo("");
                  }}
                  className="px-3 py-1.5 rounded border text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditingMapping(true)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="h-4 w-4" />
              添加模型映射
            </button>
          )}
        </div>

        {/* Save Button */}
        {onSave && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存 Amp CLI 配置"}
          </button>
        )}
      </div>
    </div>
  );
}
