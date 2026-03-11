/**
 * @file smart-input.tsx
 * @description 截图对话悬浮窗口 - 参考 Google Gemini 浮动栏设计
 *              半透明药丸形状，简洁的输入界面
 *              支持语音输入模式
 * @module pages/smart-input
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Image as ImageIcon,
  ArrowUp,
  X,
  GripVertical,
  Mic,
  Loader2,
  Square,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { sendScreenshotChat } from "@/lib/api/screenshotChat";
import { useVoiceSound } from "@/hooks/useVoiceSound";
import "./smart-input.css";

// ProxyCast Logo组件
function Logo() {
  return (
    <svg
      viewBox="0 0 128 128"
      width="20"
      height="20"
      className="screenshot-logo"
    >
      <defs>
        <linearGradient id="leftP" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#4fc3f7" }} />
          <stop offset="100%" style={{ stopColor: "#1a237e" }} />
        </linearGradient>
        <linearGradient id="rightP" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#7c4dff" }} />
          <stop offset="100%" style={{ stopColor: "#e91e63" }} />
        </linearGradient>
      </defs>
      <g>
        <rect x="36" y="32" width="10" height="64" rx="3" fill="url(#leftP)" />
        <rect x="46" y="32" width="28" height="9" rx="3" fill="url(#rightP)" />
        <rect x="46" y="60" width="24" height="8" rx="2" fill="url(#rightP)" />
        <rect x="70" y="41" width="8" height="27" rx="3" fill="url(#rightP)" />
      </g>
    </svg>
  );
}

function getImagePathFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const imagePath = params.get("image");
  return imagePath ? decodeURIComponent(imagePath) : null;
}

function getPrefilledTextFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text");
  return text ? decodeURIComponent(text) : "";
}

function getVoiceModeFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("voice") === "true";
}

function getTranslateModeFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("translate") === "true";
}

function getInstructionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const instruction = params.get("instruction");
  return instruction ? decodeURIComponent(instruction) : null;
}

/** 语音状态 */
type VoiceState = "idle" | "recording" | "transcribing" | "polishing";

export function SmartInputPage() {
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMode, setVoiceMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [translateMode, setTranslateMode] = useState(false);
  const [translateInstructionId, setTranslateInstructionId] = useState<
    string | null
  >(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 追踪是否已经从 URL 初始化过语音模式
  const voiceModeInitializedRef = useRef(false);

  // 语音音效
  const { playStartSound, playStopSound } = useVoiceSound(soundEnabled);

  // 加载音效配置
  useEffect(() => {
    (async () => {
      try {
        const { getVoiceInputConfig } = await import("@/lib/api/asrProvider");
        const config = await getVoiceInputConfig();
        setSoundEnabled(config.sound_enabled);
      } catch (err) {
        console.error("[语音输入] 加载音效配置失败:", err);
      }
    })();
  }, []);

  // 显示错误提示
  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  }, []);

  // 开始语音模式
  const startVoiceMode = useCallback(async () => {
    console.log("[语音输入] startVoiceMode 被调用，当前状态:", voiceState);
    if (voiceState !== "idle") {
      console.log("[语音输入] 已在录音状态，跳过");
      return;
    }
    setVoiceMode(true);
    setVoiceState("recording");
    setInputValue(""); // 清空之前的输入

    // 播放开始录音音效
    playStartSound();

    try {
      const { startRecording, getVoiceInputConfig, cancelRecording } =
        await import("@/lib/api/asrProvider");

      // 先尝试取消任何正在进行的录音（可能是设置页面的测试没有停止）
      try {
        await cancelRecording();
        console.log("[语音输入] 已取消之前的录音");
      } catch {
        // 忽略取消错误
      }

      // 获取配置中的设备 ID
      const config = await getVoiceInputConfig();
      console.log("[语音输入] 使用设备ID:", config.selected_device_id);
      await startRecording(config.selected_device_id);
      console.log("[语音输入] 开始录音成功");
    } catch (err: any) {
      console.error("[语音输入] 开始录音失败:", err);
      // 检查错误信息是否与权限有关，或者直接给通用提示
      const errMsg =
        typeof err === "string" ? err : err?.message || JSON.stringify(err);
      if (
        errMsg.toLowerCase().includes("permission") ||
        errMsg.toLowerCase().includes("device")
      ) {
        showError("无法访问麦克风，请检查系统隐私设置");
      } else {
        showError(`无法开始录音: ${errMsg}`);
      }

      setVoiceState("idle");
      setVoiceMode(false);
    }
  }, [voiceState, showError, playStartSound]);

  // 从 URL 获取图片路径、预填文本和语音模式
  useEffect(() => {
    const path = getImagePathFromUrl();
    if (path) {
      setImagePath(path);
    }
    const prefilledText = getPrefilledTextFromUrl();
    if (prefilledText) {
      setInputValue(prefilledText);
    }
    const isVoiceMode = getVoiceModeFromUrl();
    const isTranslateMode = getTranslateModeFromUrl();
    const instructionId = getInstructionIdFromUrl();

    console.log(
      "[语音输入] URL 参数 voice=",
      isVoiceMode,
      "translate=",
      isTranslateMode,
      "instruction=",
      instructionId,
    );

    if (isTranslateMode && instructionId) {
      setTranslateMode(true);
      setTranslateInstructionId(instructionId);
    }

    // 只在首次初始化时启动语音模式，避免重复触发
    if (isVoiceMode && !voiceModeInitializedRef.current) {
      voiceModeInitializedRef.current = true;
      startVoiceMode();
    }
  }, [startVoiceMode]);

  // 监听后端发送的开始录音事件（窗口已存在时使用）
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("voice-start-recording", () => {
          console.log("[语音输入] 收到开始录音事件");
          startVoiceMode();
        });
      } catch (err) {
        console.error("[语音输入] 监听开始录音事件失败:", err);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [startVoiceMode]);

  // 自动聚焦（非语音模式时）
  useEffect(() => {
    if (!voiceMode) {
      inputRef.current?.focus();
    }
  }, [voiceMode]);

  // 使用 Ref 追踪状态，避免闭包陷阱
  const voiceStateRef = useRef<VoiceState>("idle");
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // 组件卸载时清理录音
  useEffect(() => {
    return () => {
      console.log("[语音输入] 组件卸载，当前状态:", voiceStateRef.current);
      if (voiceStateRef.current === "recording") {
        console.log("[语音输入] 组件卸载时正在录音，取消录音");
        import("@/lib/api/asrProvider").then(({ cancelRecording }) => {
          cancelRecording().catch((err) => {
            console.error("[语音输入] 卸载时取消录音失败:", err);
          });
        });
      }
    };
  }, []); // 空依赖，只在卸载时执行

  // 使用 Ref 追踪音效函数，避免闭包陷阱
  const playStopSoundRef = useRef(playStopSound);
  useEffect(() => {
    playStopSoundRef.current = playStopSound;
  }, [playStopSound]);

  // 使用 Ref 追踪翻译模式状态，避免闭包陷阱
  const translateModeRef = useRef(translateMode);
  const translateInstructionIdRef = useRef(translateInstructionId);
  useEffect(() => {
    translateModeRef.current = translateMode;
    translateInstructionIdRef.current = translateInstructionId;
  }, [translateMode, translateInstructionId]);

  // 手动停止语音录音（点击按钮）
  const stopVoiceRecording = useCallback(
    async (e?: React.MouseEvent) => {
      // 阻止事件冒泡，防止触发其他点击逻辑
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      // 使用 Ref 获取最新状态，避免闭包陷阱
      const currentState = voiceStateRef.current;
      console.log(
        "[语音输入] stopVoiceRecording 被调用，Ref状态:",
        currentState,
      );

      // 如果不在录音状态，直接返回
      if (currentState !== "recording") {
        console.log("[语音输入] 不在录音状态，跳过");
        return;
      }

      // 播放停止录音音效
      playStopSoundRef.current();

      setVoiceState("transcribing");
      try {
        const {
          stopRecording,
          transcribeAudio,
          polishVoiceText,
          getVoiceInputConfig,
        } = await import("@/lib/api/asrProvider");

        let result;
        try {
          result = await stopRecording();
        } catch (recordingErr: any) {
          // 如果停止录音本身失败（例如后端没在录音，或者设备断开），强制重置
          console.error("停止录音异常:", recordingErr);
          const errMsg =
            typeof recordingErr === "string"
              ? recordingErr
              : recordingErr?.message || "";
          showError(`录音停止失败: ${errMsg}`);
          setVoiceState("idle");
          setVoiceMode(false);
          return;
        }

        console.log(
          "[语音输入] 录音完成，时长:",
          result.duration.toFixed(2),
          "秒",
        );

        if (result.duration < 0.5) {
          console.log("[语音输入] 录音时间过短");
          // 这里不要 alert，因为用户可能只是误触，直接静默取消即可
          setVoiceState("idle");
          setVoiceMode(false);
          return;
        }

        const audioData = new Uint8Array(result.audio_data);
        const transcribeResult = await transcribeAudio(
          audioData,
          result.sample_rate,
        );
        console.log("[语音识别] 结果:", transcribeResult.text);

        if (!transcribeResult.text.trim()) {
          setVoiceState("idle");
          setVoiceMode(false);
          return;
        }

        // 检查是否启用润色或翻译模式
        let finalText = transcribeResult.text;
        try {
          const config = await getVoiceInputConfig();
          console.log("[语音输入] 润色配置:", {
            polish_enabled: config.processor.polish_enabled,
            polish_model: config.processor.polish_model,
            default_instruction_id: config.processor.default_instruction_id,
            translateMode: translateModeRef.current,
            translateInstructionId: translateInstructionIdRef.current,
          });

          // 翻译模式：使用指定的翻译指令
          if (translateModeRef.current && translateInstructionIdRef.current) {
            console.log("[语音输入] 进入翻译模式分支");
            setVoiceState("polishing");
            console.log(
              "[语音输入] 翻译模式，使用指令:",
              translateInstructionIdRef.current,
            );
            const polished = await polishVoiceText(
              transcribeResult.text,
              translateInstructionIdRef.current,
            );
            console.log("[语音输入] 翻译完成:", polished.text);
            finalText = polished.text;
          } else if (config.processor.polish_enabled) {
            // 普通模式：使用默认润色
            console.log("[语音输入] 进入润色模式分支");
            setVoiceState("polishing");
            const polished = await polishVoiceText(transcribeResult.text);
            console.log("[语音输入] 润色完成:", polished.text);
            finalText = polished.text;
          } else {
            console.log("[语音输入] 润色未启用，直接使用原始文本");
          }
        } catch (e) {
          console.error("[语音润色] 失败:", e);
        }

        setInputValue(finalText);
        setVoiceState("idle");
        setVoiceMode(false);
        inputRef.current?.focus();
      } catch (err) {
        console.error("[语音识别] 失败:", err);
        showError("语音识别过程中发生错误");
        setVoiceState("idle");
        setVoiceMode(false);
      }
    },
    [showError],
  ); // 只依赖 showError，其他通过 Ref 获取

  // 监听快捷键释放事件
  useEffect(() => {
    if (!voiceMode) return;

    const setupStopListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("voice-stop-recording", async () => {
          console.log("[语音输入] 收到停止录音事件");

          // 播放停止录音音效
          playStopSoundRef.current();

          // 直接在这里执行停止录音逻辑，避免闭包问题
          setVoiceState("transcribing");
          try {
            const {
              stopRecording,
              transcribeAudio,
              polishVoiceText,
              getVoiceInputConfig,
            } = await import("@/lib/api/asrProvider");

            const result = await stopRecording();
            console.log(
              "[语音输入] 录音完成，时长:",
              result.duration.toFixed(2),
              "秒",
            );

            if (result.duration < 0.5) {
              console.log("[语音输入] 录音时间过短");
              setVoiceState("idle");
              setVoiceMode(false);
              return;
            }

            const audioData = new Uint8Array(result.audio_data);
            const transcribeResult = await transcribeAudio(
              audioData,
              result.sample_rate,
            );
            console.log("[语音识别] 结果:", transcribeResult.text);

            if (!transcribeResult.text.trim()) {
              setVoiceState("idle");
              setVoiceMode(false);
              return;
            }

            // 检查是否启用润色或翻译模式
            let finalText = transcribeResult.text;
            try {
              const config = await getVoiceInputConfig();
              console.log("[语音输入] 润色配置:", {
                polish_enabled: config.processor.polish_enabled,
                polish_model: config.processor.polish_model,
                default_instruction_id: config.processor.default_instruction_id,
                translateMode: translateModeRef.current,
                translateInstructionId: translateInstructionIdRef.current,
              });

              // 翻译模式：使用指定的翻译指令
              if (
                translateModeRef.current &&
                translateInstructionIdRef.current
              ) {
                console.log("[语音输入] 进入翻译模式分支");
                setVoiceState("polishing");
                console.log(
                  "[语音输入] 翻译模式，使用指令:",
                  translateInstructionIdRef.current,
                );
                const polished = await polishVoiceText(
                  transcribeResult.text,
                  translateInstructionIdRef.current,
                );
                console.log("[语音输入] 翻译完成:", polished.text);
                finalText = polished.text;
              } else if (config.processor.polish_enabled) {
                // 普通模式：使用默认润色
                console.log("[语音输入] 进入润色模式分支");
                setVoiceState("polishing");
                const polished = await polishVoiceText(transcribeResult.text);
                console.log("[语音输入] 润色完成:", polished.text);
                finalText = polished.text;
              } else {
                console.log("[语音输入] 润色未启用，直接使用原始文本");
              }
            } catch (e) {
              console.error("[语音润色] 失败:", e);
            }

            setInputValue(finalText);
            setVoiceState("idle");
            setVoiceMode(false);
            inputRef.current?.focus();
          } catch (err) {
            console.error("[语音识别] 失败:", err);
            showError("语音识别过程中发生错误");
            setVoiceState("idle");
            setVoiceMode(false);
          }
        });
        return unlisten;
      } catch (err) {
        console.error("[语音输入] 监听停止录音事件失败:", err);
        return () => {};
      }
    };

    const unlistenPromise = setupStopListener();
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [voiceMode, showError]);

  // 关闭窗口
  const handleClose = useCallback(async () => {
    // 如果正在录音，先取消
    if (voiceState === "recording") {
      try {
        const { cancelRecording } = await import("@/lib/api/asrProvider");
        await cancelRecording();
      } catch (err) {
        console.error("[语音输入] 取消录音失败:", err);
      }
    }
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("关闭窗口失败:", err);
    }
  }, [voiceState]);

  // ESC 关闭窗口
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // 开始拖动窗口
  const handleStartDrag = useCallback(async (e: React.MouseEvent) => {
    // 只响应左键
    if (e.button !== 0) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("拖动窗口失败:", err);
    }
  }, []);

  // 移除图片附件
  const handleRemoveImage = () => {
    setImagePath(null);
  };

  // 发送到主应用
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    setIsLoading(true);

    try {
      console.log("[SmartInput] 发送消息:", inputValue);
      await sendScreenshotChat({
        message: inputValue,
        imagePath: imagePath,
      });
      console.log("[SmartInput] 发送成功，关闭窗口");
      // 确保窗口关闭
      const win = getCurrentWindow();
      await win.close();
    } catch (err) {
      console.error("[SmartInput] 发送失败:", err);
      showError("发送失败，请重试");
      setIsLoading(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="screenshot-container">
      {errorMsg && <div className="screenshot-error-toast">{errorMsg}</div>}
      <div className="screenshot-input-bar">
        {/* 拖动手柄 */}
        <div
          className="screenshot-drag-handle"
          onMouseDown={handleStartDrag}
          title="拖动移动窗口"
        >
          <GripVertical size={14} />
        </div>

        {/* Logo */}
        <Logo />

        {/* 语音识别/润色状态 */}
        {(voiceState === "transcribing" || voiceState === "polishing") && (
          <div className="screenshot-attachment processing">
            <Loader2 size={12} className="animate-spin" />
            <span>
              {voiceState === "transcribing" ? "识别中..." : "润色中..."}
            </span>
          </div>
        )}

        {/* 图片附件标签 */}
        {imagePath && (
          <div className="screenshot-attachment">
            <ImageIcon size={12} />
            <span>Image</span>
            <button
              className="screenshot-attachment-remove"
              onClick={handleRemoveImage}
              title="移除图片"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* 录音模式显示波形，非录音模式显示输入框 */}
        {voiceState === "recording" ? (
          <div className="screenshot-recording-container">
            <div className="recording-dot" />
            <span className="screenshot-recording-text">正在聆听...</span>
          </div>
        ) : (
          <textarea
            ref={inputRef}
            className="screenshot-input"
            placeholder="Ask anything..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              // 自动调整高度
              e.target.style.height = "auto";
              e.target.style.height =
                Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleInputKeyDown}
            disabled={isLoading || voiceState !== "idle"}
            rows={1}
          />
        )}

        {/* 右侧按钮组 */}
        <div className="screenshot-actions">
          {/* 麦克风按钮 - 点击开始录音 */}
          {voiceState === "idle" && (
            <button
              className="screenshot-mic-btn"
              onClick={startVoiceMode}
              title="语音输入"
            >
              <Mic size={18} />
            </button>
          )}

          {/* 停止录音按钮 */}
          {voiceState === "recording" && (
            <button
              className="screenshot-stop-btn"
              onClick={(e) => {
                console.log("[语音输入] 停止按钮被点击！");
                e.preventDefault();
                e.stopPropagation();
                stopVoiceRecording();
              }}
              style={{
                pointerEvents: "auto",
                position: "relative",
                zIndex: 1000,
              }}
              title="完成录音"
            >
              <Square size={12} fill="#ffffff" color="#ffffff" />
            </button>
          )}

          {/* 关闭按钮 */}
          <button
            className="screenshot-close-btn"
            onClick={(e) => {
              console.log("[语音输入] 关闭按钮被点击！");
              e.preventDefault();
              e.stopPropagation();
              handleClose();
            }}
            style={{
              pointerEvents: "auto",
              position: "relative",
              zIndex: 1000,
            }}
            title="关闭 (ESC)"
          >
            <X size={14} />
          </button>

          {/* 发送按钮 */}
          <button
            className={`screenshot-send-btn ${inputValue.trim() ? "active" : ""}`}
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            title="发送 (Enter)"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default SmartInputPage;
