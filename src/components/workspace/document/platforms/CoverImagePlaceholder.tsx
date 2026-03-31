/**
 * @file 封面图占位符组件
 * @description 处理图片加载失败或已知占位符 URL，显示样式化的占位卡片
 * @module components/workspace/document/platforms/CoverImagePlaceholder
 */

import React, { useState, memo } from "react";

/** 从 img URL 中提取 multimodel 格式的提示词 */
function extractPendingPrompt(src: string): string | null {
  // 【img:model:prompt】 格式
  const match = src.match(/【img:[^:]+:(.+?)】/);
  if (match) {
    return match[1].trim();
  }
  // pending-cover://model/encoded_prompt 格式
  if (src.startsWith("pending-cover://")) {
    const rest = src.slice("pending-cover://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx !== -1) {
      try {
        return decodeURIComponent(rest.slice(slashIdx + 1));
      } catch {
        return rest.slice(slashIdx + 1);
      }
    }
  }
  return null;
}

/** 是否是已知的占位符 URL */
function isPlaceholderUrl(src: string): boolean {
  if (!src) return true;
  if (src === "cover-generation-failed") return true;
  if (src.startsWith("【img:")) return true;
  if (src.startsWith("pending-cover://")) return true;
  return false;
}

/** 自定义事件名：封面图重新生成成功 */
export const COVER_IMAGE_REPLACED_EVENT = "lime:cover-image-replaced";
export const COVER_IMAGE_WORKBENCH_REQUEST_EVENT =
  "lime:cover-image-workbench-request";

/** 自定义事件 detail 类型 */
export interface CoverImageReplacedDetail {
  /** 原始占位 src（pending-cover://... 格式） */
  placeholder: string;
  /** 新图片 URL */
  imageUrl: string;
}

export interface CoverImageWorkbenchRequestDetail {
  placeholder: string;
  prompt: string;
  alt?: string;
}

interface CoverImagePlaceholderProps {
  alt?: string;
  src?: string;
  className?: string;
}

export const CoverImagePlaceholder: React.FC<CoverImagePlaceholderProps> = memo(
  ({ alt, src, className }) => {
    const [failed, setFailed] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const [retryError, setRetryError] = useState<string | null>(null);

    const isPlaceholder = isPlaceholderUrl(src || "");
    const pendingPrompt = src ? extractPendingPrompt(src) : null;
    const showPlaceholder = isPlaceholder || failed;
    const isFailed = src === "cover-generation-failed" || failed;

    const handleRetry = () => {
      if (!pendingPrompt || retrying) return;
      setRetrying(true);
      setRetryError(null);
      try {
        window.dispatchEvent(
          new CustomEvent<CoverImageWorkbenchRequestDetail>(
            COVER_IMAGE_WORKBENCH_REQUEST_EVENT,
            {
              detail: {
                placeholder: src || "",
                prompt: pendingPrompt,
                alt,
              },
            },
          ),
        );
        window.setTimeout(() => {
          setRetrying(false);
        }, 1200);
      } catch (err) {
        setRetryError(String(err));
        setRetrying(false);
      }
    };

    if (!showPlaceholder && src) {
      return (
        <img
          src={src}
          alt={alt || "封面图"}
          className={className}
          onError={() => setFailed(true)}
          style={{ display: "block", maxWidth: "100%", margin: "1.5em auto", borderRadius: 8 }}
        />
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          margin: "1.5em auto",
          padding: "28px 20px",
          background: "hsl(210 40% 98%)",
          border: "1.5px dashed hsl(214.3 31.8% 82%)",
          borderRadius: 10,
          maxWidth: 520,
          textAlign: "center",
        }}
      >
        {/* 图标 */}
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="hsl(214.3 31.8% 70%)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>

        {/* 主标签 */}
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "hsl(222.2 47.4% 45%)",
            marginTop: 2,
          }}
        >
          {isFailed ? "封面图生成失败" : "封面图待生成"}
        </span>

        {/* 提示词 */}
        {pendingPrompt && (
          <span
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "hsl(222.2 47.4% 60%)",
              lineHeight: 1.6,
              maxWidth: 420,
            }}
          >
            {pendingPrompt}
          </span>
        )}

        {/* 错误提示 */}
        {retryError && (
          <span
            style={{
              marginTop: 4,
              fontSize: 11,
              color: "hsl(0 70% 50%)",
              maxWidth: 420,
            }}
          >
            {retryError}
          </span>
        )}

        {/* 重新生成按钮 */}
        {pendingPrompt && (
          <button
            type="button"
            disabled={retrying}
            onClick={handleRetry}
            style={{
              marginTop: 8,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: retrying ? "hsl(222.2 47.4% 60%)" : "hsl(222.2 47.4% 45%)",
              background: "hsl(210 40% 94%)",
              border: "1px solid hsl(214.3 31.8% 78%)",
              borderRadius: 6,
              cursor: retrying ? "not-allowed" : "pointer",
            }}
          >
            {retrying ? "正在打开配图画布…" : "重新生成封面"}
          </button>
        )}
      </div>
    );
  },
);

CoverImagePlaceholder.displayName = "CoverImagePlaceholder";

/**
 * 预处理 Markdown 内容：将 【img:model:prompt with spaces】 形式的图片 URL
 * 转换为合法的 pending-cover://model/encoded_prompt 格式，避免 Markdown 解析器
 * 因 URL 中含空格而无法识别图片语法。
 */
/* eslint-disable react-refresh/only-export-components */
export function preprocessCoverImageUrls(content: string): string {
  return content.replace(
    /!\[([^\]]*)\]\(【img:([^:]+):([^】]*)】\)/g,
    (_, imgAlt: string, model: string, prompt: string) => {
      const encoded = encodeURIComponent(prompt.trim());
      return `![${imgAlt}](pending-cover://${model}/${encoded})`;
    },
  );
}
