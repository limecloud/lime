import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import {
  cancelRecording,
  getVoiceInputConfig,
  polishVoiceText,
  startRecording,
  stopRecording,
  transcribeAudio,
  type VoiceInputConfig,
} from "@/lib/api/asrProvider";
import { useVoiceSound } from "@/hooks/useVoiceSound";

type InputbarDictationState =
  | "idle"
  | "listening"
  | "transcribing"
  | "polishing";

interface UseInputbarDictationArgs {
  text: string;
  setText: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
}

function insertTranscriptAtCursor(
  currentText: string,
  transcript: string,
  textarea: HTMLTextAreaElement | null,
) {
  if (!textarea) {
    return {
      nextText: currentText ? `${currentText}\n${transcript}` : transcript,
      cursor: currentText ? currentText.length + transcript.length + 1 : transcript.length,
    };
  }

  const selectionStart = textarea.selectionStart ?? currentText.length;
  const selectionEnd = textarea.selectionEnd ?? currentText.length;
  const before = currentText.slice(0, selectionStart);
  const after = currentText.slice(selectionEnd);
  const prefix =
    before.length > 0 && !/[\s\n]$/.test(before) ? "\n" : "";
  const suffix =
    after.length > 0 && !/^[\s\n]/.test(after) ? "\n" : "";
  const inserted = `${prefix}${transcript}${suffix}`;
  const nextText = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;

  return { nextText, cursor };
}

export function useInputbarDictation({
  text,
  setText,
  textareaRef,
  disabled,
}: UseInputbarDictationArgs) {
  const [dictationState, setDictationState] =
    useState<InputbarDictationState>("idle");
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const textRef = useRef(text);
  const dictationStateRef = useRef<InputbarDictationState>("idle");
  const voiceConfigRef = useRef<VoiceInputConfig | null>(null);
  const { playStartSound, playStopSound } = useVoiceSound(soundEnabled);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    dictationStateRef.current = dictationState;
  }, [dictationState]);

  useEffect(() => {
    let cancelled = false;

    getVoiceInputConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }
        voiceConfigRef.current = config;
        setDictationEnabled(config.enabled);
        setSoundEnabled(config.sound_enabled);
      })
      .catch((error) => {
        console.error("[输入栏] 加载语音输入配置失败:", error);
      });

    return () => {
      cancelled = true;
      if (dictationStateRef.current === "listening") {
        void cancelRecording().catch((error) => {
          console.error("[输入栏] 卸载时取消录音失败:", error);
        });
      }
    };
  }, []);

  const focusTextarea = useCallback((cursor: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  }, [textareaRef]);

  const insertTranscript = useCallback(
    (transcript: string) => {
      const { nextText, cursor } = insertTranscriptAtCursor(
        textRef.current,
        transcript,
        textareaRef.current,
      );
      setText(nextText);
      focusTextarea(cursor);
    },
    [focusTextarea, setText, textareaRef],
  );

  const refreshVoiceConfig = useCallback(async () => {
    const config = await getVoiceInputConfig();
    voiceConfigRef.current = config;
    setDictationEnabled(config.enabled);
    setSoundEnabled(config.sound_enabled);
    return config;
  }, []);

  const startDictation = useCallback(async () => {
    if (disabled || dictationStateRef.current !== "idle") {
      return;
    }

    let config: VoiceInputConfig;
    try {
      config = await refreshVoiceConfig();
    } catch (error) {
      console.error("[输入栏] 读取语音配置失败:", error);
      toast.error("语音输入暂不可用");
      return;
    }

    if (!config.enabled) {
      toast.info("请先在设置里启用语音输入");
      return;
    }

    setDictationState("listening");
    playStartSound();

    try {
      await cancelRecording().catch(() => undefined);
      await startRecording(config.selected_device_id);
    } catch (error: any) {
      console.error("[输入栏] 开始录音失败:", error);
      const message =
        typeof error === "string" ? error : error?.message || "无法开始录音";
      toast.error(message);
      setDictationState("idle");
    }
  }, [disabled, playStartSound, refreshVoiceConfig]);

  const finishDictation = useCallback(async () => {
    if (dictationStateRef.current !== "listening") {
      return;
    }

    playStopSound();
    setDictationState("transcribing");

    try {
      const result = await stopRecording();
      if (result.duration < 0.5) {
        toast.info("录音时间太短，请再试一次");
        setDictationState("idle");
        return;
      }

      const transcription = await transcribeAudio(
        new Uint8Array(result.audio_data),
        result.sample_rate,
      );

      if (!transcription.text.trim()) {
        toast.info("未识别到语音内容");
        setDictationState("idle");
        return;
      }

      let finalText = transcription.text;
      const config = voiceConfigRef.current ?? (await refreshVoiceConfig());

      if (config.processor.polish_enabled) {
        setDictationState("polishing");
        try {
          const polished = await polishVoiceText(transcription.text);
          finalText = polished.text;
        } catch (error) {
          console.error("[输入栏] 语音润色失败:", error);
          toast.error("语音润色失败，已插入原始识别内容");
        }
      }

      insertTranscript(finalText);
      setDictationState("idle");
    } catch (error: any) {
      console.error("[输入栏] 完成语音输入失败:", error);
      const message =
        typeof error === "string" ? error : error?.message || "语音识别失败";
      toast.error(message);
      setDictationState("idle");
    }
  }, [insertTranscript, playStopSound, refreshVoiceConfig]);

  const handleDictationToggle = useCallback(async () => {
    if (dictationStateRef.current === "listening") {
      await finishDictation();
      return;
    }

    if (dictationStateRef.current !== "idle") {
      return;
    }

    await startDictation();
  }, [finishDictation, startDictation]);

  return {
    dictationEnabled,
    dictationState,
    isDictating: dictationState === "listening",
    isDictationBusy: dictationState !== "idle",
    isDictationProcessing:
      dictationState === "transcribing" || dictationState === "polishing",
    handleDictationToggle,
  };
}
