/**
 * @file SmartInputWindow.tsx
 * @description 截图对话悬浮窗主组件
 * @module components/smart-input/SmartInputWindow
 */

import React, { useState, useEffect, useCallback } from "react";
import { closeScreenshotChatWindow } from "@/lib/api/screenshotChat";
import { SmartInputPreview } from "./SmartInputPreview";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { useSmartInput } from "./useSmartInput";
import type { SmartInputWindowProps } from "./types";
import { skillsApi, type Skill } from "@/lib/api/skills";
import "./smart-input.css";

/**
 * 截图对话悬浮窗主组件
 *
 * 组合截图预览、消息列表和输入框，提供完整的对话界面
 *
 * 需求:
 * - 4.1: 当截图完成时，悬浮窗口应以无边框、置顶的方式打开
 * - 4.6: 当用户按下 ESC 或点击窗口外部时，悬浮窗口应关闭
 * - 4.7: 悬浮窗口应支持用户拖动
 */
export const SmartInputWindow: React.FC<SmartInputWindowProps> = ({
  imagePath,
  onClose,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const {
    messages,
    isLoading,
    error,
    imageBase64,
    sendMessage,
    setImagePath,
    clearError,
    retry,
  } = useSmartInput();

  // 加载图片
  useEffect(() => {
    if (imagePath) {
      setImagePath(imagePath);
    }
  }, [imagePath, setImagePath]);

  // 加载技能列表
  useEffect(() => {
    skillsApi
      .getAll("proxycast")
      .then(setSkills)
      .catch((err) => console.error("加载技能列表失败:", err));
  }, []);

  // 处理关闭窗口
  const handleClose = useCallback(async () => {
    try {
      await closeScreenshotChatWindow();
    } catch (err) {
      console.error("关闭窗口失败:", err);
    }
    onClose?.();
  }, [onClose]);

  // 处理 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // 处理发送消息
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const message = textOverride || inputValue;
      if (!message.trim()) return;
      setInputValue("");
      await sendMessage(message);
    },
    [inputValue, sendMessage],
  );

  // 构建图片 src
  const imageSrc = imageBase64
    ? `data:image/png;base64,${imageBase64}`
    : imagePath;

  return (
    <div className="smart-input-page">
      {/* 窗口头部 - 可拖动区域 */}
      <div className="smart-input-header">
        <span className="smart-input-title">截图对话</span>
        <button
          className="smart-input-close-btn"
          onClick={handleClose}
          title="关闭 (ESC)"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 截图预览区域 */}
      {imageSrc && (
        <div className="smart-input-preview">
          <SmartInputPreview src={imageSrc} maxHeight={200} />
        </div>
      )}

      {/* 对话区域 */}
      <div className="smart-input-conversation">
        {/* 错误提示 */}
        {error && (
          <div className="smart-input-error">
            <div className="smart-input-error-content">
              <p style={{ color: "#f43f5e", marginBottom: 8 }}>{error}</p>
              <button className="smart-input-retry-btn" onClick={retry}>
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                重试
              </button>
              <button
                className="smart-input-retry-btn"
                onClick={clearError}
                style={{ marginLeft: 8 }}
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* 消息列表 */}
        <ChatMessages messages={messages} />

        {/* 输入区域 */}
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          isLoading={isLoading}
          disabled={!imageBase64}
          placeholder={imageBase64 ? "输入问题..." : "正在加载图片..."}
          skills={skills}
        />
      </div>

      {/* 调试信息（开发模式） */}
      {import.meta.env.DEV && (
        <div className="smart-input-debug">
          路径: {imagePath} | Base64: {imageBase64 ? "已加载" : "未加载"} |
          消息数: {messages.length}
        </div>
      )}
    </div>
  );
};

export default SmartInputWindow;
