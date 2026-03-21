/**
 * @file update-notification.tsx
 * @description 更新提醒独立窗口页面
 *
 * 独立于主应用的更新提醒悬浮窗口，采用轻量 toast 形态展示更新操作。
 *
 * input: URL 参数（current, latest, download_url）
 * output: 更新提醒 UI
 * pos: pages 层，独立 Tauri 窗口
 */

import { useEffect, useState, useCallback, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  closeUpdateWindow,
  dismissUpdateNotification,
  downloadUpdate,
  recordUpdateNotificationAction,
  remindUpdateLater,
  skipUpdateVersion,
} from "@/lib/api/appUpdate";
import { Bell, Download, ExternalLink, SkipForward, X } from "lucide-react";
import "./update-notification.css";

interface UpdateParams {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

function getUpdateParamsFromUrl(): UpdateParams {
  const params = new URLSearchParams(window.location.search);
  return {
    currentVersion: params.get("current") || "",
    latestVersion: params.get("latest") || "",
    downloadUrl: params.get("download_url") || "",
  };
}

export function UpdateNotificationPage() {
  const [params, setParams] = useState<UpdateParams>({
    currentVersion: "",
    latestVersion: "",
    downloadUrl: "",
  });
  const [downloading, setDownloading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setParams(getUpdateParamsFromUrl());
    const timer = window.setTimeout(() => setVisible(true), 10);
    return () => window.clearTimeout(timer);
  }, []);

  // 直接关闭窗口（无动画）
  const closeWindow = useCallback(async () => {
    try {
      await closeUpdateWindow();
    } catch (err) {
      console.error("关闭窗口失败:", err);
      // 备用方案：直接关闭
      await getCurrentWindow().close();
    }
  }, []);

  // 带动画关闭
  const closeWithAnimation = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    await closeWindow();
  }, [closing, closeWindow]);

  // 关闭并应用退避策略
  const handleDismiss = useCallback(async () => {
    try {
      await dismissUpdateNotification(params.latestVersion || null);
    } catch (error) {
      console.error("记录关闭提醒失败:", error);
    }
    await closeWithAnimation();
  }, [params.latestVersion, closeWithAnimation]);

  // ESC 关闭窗口
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await handleDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDismiss]);

  // 开始拖动窗口
  const handleStartDrag = useCallback(async (e: MouseEvent) => {
    if (e.button !== 0) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("拖动窗口失败:", err);
    }
  }, []);

  // 立即更新
  const handleDownload = async () => {
    setDownloading(true);
    try {
      await recordUpdateNotificationAction("update_now");
    } catch (error) {
      console.error("记录立即更新行为失败:", error);
    }

    try {
      await downloadUpdate();
      // download_update 成功后会自动重启应用完成升级
    } catch (error) {
      console.error("下载更新失败:", error);
      // 如果下载失败，尝试打开浏览器
      if (params.downloadUrl) {
        try {
          await shellOpen(params.downloadUrl);
          await closeWithAnimation();
        } catch {
          window.open(params.downloadUrl, "_blank");
        }
      }
    } finally {
      setDownloading(false);
    }
  };

  // 稍后提醒
  const handleLater = async (hours: number) => {
    try {
      await remindUpdateLater(hours);
    } catch (error) {
      console.error("设置稍后提醒失败:", error);
    }
    await closeWithAnimation();
  };

  // 跳过此版本
  const handleSkipVersion = async () => {
    if (params.latestVersion) {
      try {
        await skipUpdateVersion(params.latestVersion);
        await closeWithAnimation();
      } catch (error) {
        console.error("跳过版本失败:", error);
      }
    }
  };

  // 在浏览器中打开
  const handleOpenInBrowser = async () => {
    if (params.downloadUrl) {
      try {
        await shellOpen(params.downloadUrl);
      } catch (error) {
        console.error("打开浏览器失败:", error);
        // 备用方案
        window.open(params.downloadUrl, "_blank");
      }
    }
  };

  return (
    <div className="update-container">
      <div
        className={`update-toast ${visible ? "is-visible" : ""} ${
          closing ? "is-closing" : ""
        }`}
        onMouseDown={handleStartDrag}
      >
        <div className="update-toast-icon" aria-hidden>
          <Bell size={14} />
        </div>

        <div className="update-toast-main">
          <div className="update-toast-message">
            发现新版本 {params.latestVersion || ""}
            {params.currentVersion ? (
              <span className="update-toast-sub">
                （当前 {params.currentVersion}）
              </span>
            ) : null}
          </div>

          <div
            className="update-toast-actions"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleLater(24)}
              className="update-btn update-btn-ghost"
            >
              1天后
            </button>
            <button
              onClick={() => handleLater(72)}
              className="update-btn update-btn-ghost"
            >
              3天后
            </button>
            <button
              onClick={() => handleLater(168)}
              className="update-btn update-btn-ghost"
            >
              下周
            </button>
            <button
              onClick={handleDismiss}
              className="update-btn update-btn-icon"
              title="关闭提醒"
            >
              <X size={13} />
            </button>
            <button
              onClick={handleSkipVersion}
              className="update-btn update-btn-ghost"
              title="跳过此版本"
            >
              <SkipForward size={13} />
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="update-btn update-btn-primary"
            >
              <Download
                size={14}
                className={downloading ? "animate-spin" : ""}
              />
              {downloading ? "下载中" : "立即更新"}
            </button>
            {params.downloadUrl ? (
              <button
                onClick={handleOpenInBrowser}
                className="update-btn update-btn-icon"
                title="在浏览器中查看发布页"
              >
                <ExternalLink size={13} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpdateNotificationPage;
