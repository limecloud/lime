import { useState } from "react";
import { Plus, RefreshCw, Trash2, Download, Upload } from "lucide-react";
import { useMcpServers } from "@/hooks/useMcpServers";
import { McpServer } from "@/lib/api/mcp";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HelpTip } from "@/components/HelpTip";

// 预设 MCP 服务器配置
const mcpPresets = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "文件系统访问",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub API",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "" },
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "数据库访问",
    server_config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: { DATABASE_URL: "" },
    },
  },
  {
    id: "custom",
    name: "自定义",
    description: "自定义配置",
    server_config: {
      command: "",
      args: [],
    },
  },
];

// 默认配置模板
const defaultServerConfig = JSON.stringify(
  {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-example"],
    env: {},
  },
  null,
  2,
);

interface McpPageProps {
  hideHeader?: boolean;
}

export function McpPage({ hideHeader = false }: McpPageProps) {
  const {
    servers,
    loading,
    importing,
    error,
    addServer,
    updateServer,
    deleteServer,
    importFromApp,
    importFromAllApps,
    syncAllToLive,
    refresh,
  } = useMcpServers();

  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // 编辑表单状态
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editConfig, setEditConfig] = useState("");
  const [enabledLime, setEnabledLime] = useState(true);
  const [enabledClaude, setEnabledClaude] = useState(true);
  const [enabledCodex, setEnabledCodex] = useState(true);
  const [enabledGemini, setEnabledGemini] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleImport = async (appType?: string) => {
    setShowImportMenu(false);
    try {
      const count = appType
        ? await importFromApp(appType)
        : await importFromAllApps();
      if (count > 0) {
        alert(`成功导入/更新 ${count} 个 MCP 服务器配置`);
      } else {
        alert("没有找到 MCP 配置可导入");
      }
    } catch (e) {
      alert("导入失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSyncToLive = async () => {
    try {
      await syncAllToLive();
      alert("同步完成");
    } catch (e) {
      alert("同步失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSelectServer = (server: McpServer) => {
    setSelectedServer(server);
    setIsCreating(false);
    setEditName(server.name);
    setEditDescription(server.description || "");
    setEditConfig(JSON.stringify(server.server_config, null, 2));
    setEnabledLime(server.enabled_lime);
    setEnabledClaude(server.enabled_claude);
    setEnabledCodex(server.enabled_codex);
    setEnabledGemini(server.enabled_gemini);
    setConfigError(null);
    setSelectedPreset(null);
  };

  const handleCreateNew = () => {
    setSelectedServer(null);
    setIsCreating(true);
    setEditName("");
    setEditDescription("");
    setEditConfig(defaultServerConfig);
    setEnabledLime(true);
    setEnabledClaude(true);
    setEnabledCodex(true);
    setEnabledGemini(true);
    setConfigError(null);
    setSelectedPreset("custom");
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = mcpPresets.find((p) => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);
      if (presetId !== "custom") {
        setEditName(preset.name);
        setEditDescription(preset.description);
      }
      setEditConfig(JSON.stringify(preset.server_config, null, 2));
      setConfigError(null);
    }
  };

  const handleConfigChange = (value: string) => {
    setEditConfig(value);
    try {
      JSON.parse(value);
      setConfigError(null);
    } catch {
      setConfigError("JSON 格式错误");
    }
  };

  const handleSave = async () => {
    if (!editName.trim()) {
      alert("请输入服务器名称");
      return;
    }

    let serverConfig;
    try {
      serverConfig = JSON.parse(editConfig);
    } catch {
      setConfigError("JSON 格式错误，无法保存");
      return;
    }

    setSaving(true);
    try {
      if (isCreating) {
        await addServer({
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          server_config: serverConfig,
          enabled_lime: enabledLime,
          enabled_claude: enabledClaude,
          enabled_codex: enabledCodex,
          enabled_gemini: enabledGemini,
        });
        setIsCreating(false);
        setSelectedServer(null);
      } else if (selectedServer) {
        await updateServer({
          ...selectedServer,
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          server_config: serverConfig,
          enabled_lime: enabledLime,
          enabled_claude: enabledClaude,
          enabled_codex: enabledCodex,
          enabled_gemini: enabledGemini,
        });
      }
    } catch (e) {
      alert("保存失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteConfirm(id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    await deleteServer(deleteConfirm);
    if (selectedServer?.id === deleteConfirm) {
      setSelectedServer(null);
    }
    setDeleteConfirm(null);
  };

  // 获取启用的应用标签
  const getEnabledApps = (server: McpServer) => {
    const apps: string[] = [];
    if (server.enabled_lime) apps.push("Lime");
    if (server.enabled_claude) apps.push("Claude");
    if (server.enabled_codex) apps.push("Codex");
    if (server.enabled_gemini) apps.push("Gemini");
    return apps;
  };

  return (
    <div className="h-full flex flex-col">
      {!hideHeader && (
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">MCP 服务器</h2>
            <p className="text-muted-foreground">
              管理 Model Context Protocol 服务器配置，同步到外部应用
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 从外部导入按钮 */}
            <div className="relative">
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                disabled={importing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-muted text-sm"
                title="从外部应用导入 MCP 配置"
              >
                <Download
                  className={cn("h-4 w-4", importing && "animate-pulse")}
                />
                {importing ? "导入中..." : "导入"}
              </button>
              {showImportMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 py-1 bg-popover border rounded-lg shadow-lg z-10">
                  <button
                    onClick={() => handleImport()}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    全部导入
                  </button>
                  <button
                    onClick={() => handleImport("claude")}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    从 Claude
                  </button>
                  <button
                    onClick={() => handleImport("codex")}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    从 Codex
                  </button>
                  <button
                    onClick={() => handleImport("gemini")}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    从 Gemini CLI
                  </button>
                </div>
              )}
            </div>
            {/* 同步到外部按钮 */}
            <button
              onClick={handleSyncToLive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm"
              title="同步配置到所有外部应用"
            >
              <Upload className="h-4 w-4" />
              同步
            </button>
          </div>
        </div>
      )}

      {hideHeader && (
        <div className="mb-4 flex items-center justify-end gap-2">
          {/* 从外部导入按钮 */}
          <div className="relative">
            <button
              onClick={() => setShowImportMenu(!showImportMenu)}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-muted text-sm"
              title="从外部应用导入 MCP 配置"
            >
              <Download
                className={cn("h-4 w-4", importing && "animate-pulse")}
              />
              {importing ? "导入中..." : "导入"}
            </button>
            {showImportMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 py-1 bg-popover border rounded-lg shadow-lg z-10">
                <button
                  onClick={() => handleImport()}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  全部导入
                </button>
                <button
                  onClick={() => handleImport("claude")}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  从 Claude
                </button>
                <button
                  onClick={() => handleImport("codex")}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  从 Codex
                </button>
                <button
                  onClick={() => handleImport("gemini")}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  从 Gemini CLI
                </button>
              </div>
            )}
          </div>
          {/* 同步到外部按钮 */}
          <button
            onClick={handleSyncToLive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm"
            title="同步配置到所有外部应用"
          >
            <Upload className="h-4 w-4" />
            同步
          </button>
        </div>
      )}

      <HelpTip title="什么是 MCP？" variant="blue">
        <ul className="list-disc list-inside space-y-1 text-sm text-blue-700 dark:text-blue-400">
          <li>
            MCP (Model Context Protocol) 是 AI 工具扩展协议，让 AI
            能访问文件系统、数据库等外部资源
          </li>
          <li>
            在此添加 MCP 服务器后，可同步到 Claude、Codex、Gemini CLI
          </li>
          <li>也可从这些工具导入已有的 MCP 配置，统一管理</li>
        </ul>
      </HelpTip>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 mb-4">
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* 主内容区域 - 左右分栏 */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* 左侧列表 */}
        <div className="w-64 flex flex-col border rounded-lg">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium">服务器列表</span>
            <div className="flex gap-1">
              <button
                onClick={refresh}
                className="p-1.5 rounded hover:bg-muted"
                title="刷新"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
              </button>
              <button
                onClick={handleCreateNew}
                className="p-1.5 rounded hover:bg-muted text-primary"
                title="新建"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : servers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p>暂无 MCP 服务器</p>
                <button
                  onClick={handleCreateNew}
                  className="text-primary hover:underline mt-1"
                >
                  添加第一个
                </button>
              </div>
            ) : (
              servers.map((server) => (
                <div
                  key={server.id}
                  onClick={() => handleSelectServer(server)}
                  className={cn(
                    "p-2.5 rounded-lg cursor-pointer transition-colors",
                    selectedServer?.id === server.id
                      ? "bg-primary/10 border border-primary"
                      : "hover:bg-muted border border-transparent",
                  )}
                >
                  <span className="font-medium text-sm truncate block">
                    {server.name}
                  </span>
                  {server.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {server.description}
                    </p>
                  )}
                  {/* 启用的应用标签 */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {getEnabledApps(server).map((app) => (
                      <span
                        key={app}
                        className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground"
                      >
                        {app}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧编辑面板 */}
        <div className="flex-1 border rounded-lg flex flex-col min-w-0">
          {!selectedServer && !isCreating ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <p>选择一个 MCP 服务器进行编辑</p>
                <p className="text-sm mt-1">或点击 + 添加新的服务器</p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    {isCreating ? "添加 MCP 服务器" : "编辑 MCP 服务器"}
                  </h3>
                  {selectedServer && (
                    <button
                      onClick={() => handleDeleteClick(selectedServer.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* 预设选择器（仅新建时显示） */}
                {isCreating && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      预设:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {mcpPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handlePresetSelect(preset.id)}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs transition-colors",
                            selectedPreset === preset.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-muted/80 text-muted-foreground",
                          )}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 名称和描述 - 横排 */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">
                      名称 <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                      placeholder="服务器名称"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">
                      描述
                    </label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
                      placeholder="可选描述"
                    />
                  </div>
                </div>

                {/* 同步到哪些应用 - 横排 */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    同步到:
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledLime}
                      onChange={(e) => setEnabledLime(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="text-xs">Lime</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledClaude}
                      onChange={(e) => setEnabledClaude(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="text-xs">Claude</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledCodex}
                      onChange={(e) => setEnabledCodex(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="text-xs">Codex</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledGemini}
                      onChange={(e) => setEnabledGemini(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="text-xs">Gemini CLI</span>
                  </label>
                </div>
              </div>

              {/* JSON 配置编辑器 */}
              <div className="flex-1 p-4 flex flex-col min-h-0">
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                  服务器配置 (JSON)
                </label>
                <textarea
                  value={editConfig}
                  onChange={(e) => handleConfigChange(e.target.value)}
                  className={cn(
                    "flex-1 w-full px-3 py-2 rounded-lg border bg-muted/50 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none font-mono text-sm resize-none",
                    configError && "border-destructive",
                  )}
                  placeholder='{"command": "npx", "args": [...], "env": {...}}'
                />
                {configError && (
                  <p className="text-xs text-destructive mt-1">{configError}</p>
                )}
              </div>

              <div className="p-3 border-t flex justify-end gap-2">
                <button
                  onClick={() => {
                    setSelectedServer(null);
                    setIsCreating(false);
                  }}
                  className="px-3 py-1.5 rounded border hover:bg-muted text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editName.trim() || !!configError}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="删除确认"
        message="确定要删除这个 MCP 服务器吗？"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
