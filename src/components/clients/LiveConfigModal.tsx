import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, FileText, Terminal } from "lucide-react";
import { switchApi, AppType } from "@/lib/api/switch";

interface LiveConfigModalProps {
  appType: AppType;
  onClose: () => void;
}

const configPaths: Record<AppType, string> = {
  claude: "~/.claude/settings.json",
  codex: "~/.codex/auth.json & config.toml",
  gemini: "~/.gemini/.env & settings.json",
  proxycast: "",
};

interface ClaudeConfig {
  configFile: Record<string, unknown>;
  shellEnv: Record<string, string>;
  shellConfigPath: string;
  [key: string]: unknown; // 添加索引签名
}

export function LiveConfigModal({ appType, onClose }: LiveConfigModalProps) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await switchApi.readLiveSettings(appType);
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [appType]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 判断是否为 Claude 配置（包含 configFile 和 shellEnv）
  const isClaudeConfig = (
    cfg: Record<string, unknown> | null,
  ): cfg is ClaudeConfig => {
    return cfg !== null && "configFile" in cfg && "shellEnv" in cfg;
  };

  const claudeConfig = isClaudeConfig(config) ? config : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl shadow-lg w-full max-w-3xl max-h-[85vh] overflow-hidden border border-border">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">当前生效的配置</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadConfig}
              disabled={loading}
              className="p-1.5 rounded hover:bg-muted"
              title="刷新"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-auto max-h-[calc(85vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <p className="text-destructive">{error}</p>
            </div>
          ) : claudeConfig ? (
            <div className="space-y-4">
              {/* 配置文件部分 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h4 className="font-semibold text-sm">配置文件</h4>
                  <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    ~/.claude/settings.json
                  </code>
                </div>
                <pre className="p-4 rounded-lg bg-muted/50 font-mono text-xs overflow-auto max-h-[300px] whitespace-pre-wrap border">
                  {JSON.stringify(claudeConfig.configFile, null, 2)}
                </pre>
              </div>

              {/* 环境变量部分 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <h4 className="font-semibold text-sm">Shell 环境变量</h4>
                  <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {claudeConfig.shellConfigPath}
                  </code>
                </div>
                {Object.keys(claudeConfig.shellEnv).length > 0 ? (
                  <pre className="p-4 rounded-lg bg-muted/50 font-mono text-xs overflow-auto max-h-[200px] whitespace-pre-wrap border">
                    {Object.entries(claudeConfig.shellEnv)
                      .map(([key, value]) => `export ${key}="${value}"`)
                      .join("\n")}
                  </pre>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/30 text-sm text-muted-foreground border border-dashed">
                    <p className="mb-2">暂无环境变量配置</p>
                    <p className="text-xs">
                      💡 提示：这里展示的是兼容外部客户端的 Shell 写入结果；运行时统一环境请以系统设置中的“环境变量”页为准。
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : config ? (
            <pre className="p-4 rounded-lg bg-muted/50 font-mono text-sm overflow-auto whitespace-pre-wrap">
              {JSON.stringify(config, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground text-center py-8">无配置数据</p>
          )}
        </div>

        <div className="p-4 border-t bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {appType === "claude" && claudeConfig ? (
              <>兼容输出：配置文件 + Shell 环境变量；运行时主入口已统一到系统设置的“环境变量”页</>
            ) : (
              <>
                配置文件路径:{" "}
                <code className="px-1 py-0.5 rounded bg-muted">
                  {configPaths[appType]}
                </code>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
