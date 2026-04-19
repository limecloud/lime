/**
 * OAuth 授权 URL 显示组件
 * 用于显示授权 URL 和等待回调状态
 */

import { useState } from "react";
import { Copy, Check, Loader2 } from "lucide-react";

interface OAuthUrlDisplayProps {
  authUrl: string | null;
  waitingForCallback: boolean;
  colorScheme?: "blue" | "green" | "purple" | "amber";
}

export function OAuthUrlDisplay({
  authUrl,
  waitingForCallback,
  colorScheme: _colorScheme = "blue",
}: OAuthUrlDisplayProps) {
  const [urlCopied, setUrlCopied] = useState(false);

  const handleCopyUrl = () => {
    if (authUrl) {
      navigator.clipboard.writeText(authUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    }
  };

  if (!authUrl) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">授权 URL</span>
          <button
            type="button"
            onClick={handleCopyUrl}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
          >
            {urlCopied ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span className="text-green-500">已复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>复制</span>
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground break-all font-mono">
          {authUrl.slice(0, 100)}...
        </p>
      </div>

      {waitingForCallback && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            <p className="text-sm text-yellow-700">
              请复制上方 URL 到浏览器完成登录，正在等待授权回调...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
