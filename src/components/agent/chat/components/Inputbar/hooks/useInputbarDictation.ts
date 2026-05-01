import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";
import {
  cancelRecording,
  getRecordingSegment,
  getRecordingStatus,
  getVoiceInputConfig,
  polishVoiceText,
  startRecording,
  stopRecording,
  transcribeAudio,
  type RecordingStatus,
  type VoiceInputConfig,
} from "@/lib/api/asrProvider";
import { getDefaultLocalVoiceModelReadiness } from "@/lib/api/voiceModels";
import { requestOpenVoiceModelSettings } from "@/lib/voiceModelSettingsNavigation";
import {
  isAudiblePcm16LeSegment,
  LIVE_TRANSCRIBE_INTERVAL_MS,
  LIVE_TRANSCRIBE_MAX_DURATION_SECONDS,
  LIVE_TRANSCRIBE_MIN_DURATION_SECONDS,
  mergeLiveTranscript,
} from "@/lib/voiceLivePreview";
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

interface TranscriptSelection {
  start: number;
  end: number;
}

function buildTranscriptInsertion(
  currentText: string,
  transcript: string,
  selection: TranscriptSelection,
) {
  const selectionStart = selection.start;
  const selectionEnd = selection.end;
  const before = currentText.slice(0, selectionStart);
  const after = currentText.slice(selectionEnd);
  const prefix = before.length > 0 && !/[\s\n]$/.test(before) ? "\n" : "";
  const suffix = after.length > 0 && !/^[\s\n]/.test(after) ? "\n" : "";
  const inserted = `${prefix}${transcript}${suffix}`;
  const nextText = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;

  return { nextText, cursor };
}

function insertTranscriptAtCursor(
  currentText: string,
  transcript: string,
  textarea: HTMLTextAreaElement | null,
) {
  if (!textarea) {
    return {
      nextText: currentText ? `${currentText}\n${transcript}` : transcript,
      cursor: currentText
        ? currentText.length + transcript.length + 1
        : transcript.length,
    };
  }

  return buildTranscriptInsertion(currentText, transcript, {
    start: textarea.selectionStart ?? currentText.length,
    end: textarea.selectionEnd ?? currentText.length,
  });
}

export function useInputbarDictation({
  text,
  setText,
  textareaRef,
  disabled,
}: UseInputbarDictationArgs) {
  const [dictationState, setDictationState] =
    useState<InputbarDictationState>("idle");
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus | null>(null);
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [voiceConfigLoaded, setVoiceConfigLoaded] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const textRef = useRef(text);
  const dictationStateRef = useRef<InputbarDictationState>("idle");
  const voiceConfigRef = useRef<VoiceInputConfig | null>(null);
  const dictationBaseTextRef = useRef("");
  const dictationSelectionRef = useRef<TranscriptSelection | null>(null);
  const lastLiveTranscriptRef = useRef("");
  const lastLiveTranscribedSampleRef = useRef(0);
  const { playStartSound, playStopSound } = useVoiceSound(soundEnabled);

  const focusTextarea = useCallback(
    (cursor: number) => {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(cursor, cursor);
      });
    },
    [textareaRef],
  );

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

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    dictationStateRef.current = dictationState;
    if (dictationState !== "listening") {
      setRecordingStatus(null);
      if (dictationState === "idle") {
        setLiveTranscript("");
      }
    }
  }, [dictationState]);

  const applyTranscriptToDictationBase = useCallback(
    (transcript: string, shouldFocus = false) => {
      const selection = dictationSelectionRef.current;
      if (!selection) {
        insertTranscript(transcript);
        return;
      }

      const { nextText, cursor } = buildTranscriptInsertion(
        dictationBaseTextRef.current,
        transcript,
        selection,
      );
      setText(nextText);
      if (shouldFocus) {
        focusTextarea(cursor);
      }
    },
    [focusTextarea, insertTranscript, setText],
  );

  useEffect(() => {
    if (dictationState !== "listening") {
      return;
    }

    let disposed = false;
    const refreshStatus = async () => {
      try {
        const status = await getRecordingStatus();
        if (!disposed) {
          setRecordingStatus(status);
        }
      } catch (error) {
        console.error("[输入栏] 获取录音状态失败:", error);
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [dictationState]);

  useEffect(() => {
    if (dictationState !== "listening") {
      return;
    }

    let disposed = false;
    let transcribing = false;

    const transcribeSnapshot = async () => {
      if (disposed || transcribing) {
        return;
      }

      transcribing = true;
      try {
        const segment = await getRecordingSegment(
          lastLiveTranscribedSampleRef.current,
          LIVE_TRANSCRIBE_MAX_DURATION_SECONDS,
        );
        if (
          disposed ||
          segment.duration < LIVE_TRANSCRIBE_MIN_DURATION_SECONDS ||
          segment.end_sample <= lastLiveTranscribedSampleRef.current
        ) {
          return;
        }

        if (!isAudiblePcm16LeSegment(segment.audio_data)) {
          lastLiveTranscribedSampleRef.current = segment.end_sample;
          return;
        }

        const audioBytes = new Uint8Array(segment.audio_data);
        const transcription = await transcribeAudio(
          audioBytes,
          segment.sample_rate,
        );
        const nextTranscript = transcription.text.trim();
        lastLiveTranscribedSampleRef.current = segment.end_sample;
        if (!disposed && nextTranscript) {
          const mergedTranscript = mergeLiveTranscript(
            lastLiveTranscriptRef.current,
            nextTranscript,
          );
          if (mergedTranscript !== lastLiveTranscriptRef.current) {
            lastLiveTranscriptRef.current = mergedTranscript;
            setLiveTranscript(mergedTranscript);
            applyTranscriptToDictationBase(mergedTranscript);
          }
        }
      } catch (error) {
        if (!disposed) {
          console.debug("[输入栏] 实时语音识别跳过:", error);
        }
      } finally {
        transcribing = false;
      }
    };

    const timer = window.setInterval(() => {
      void transcribeSnapshot();
    }, LIVE_TRANSCRIBE_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [applyTranscriptToDictationBase, dictationState]);

  useEffect(() => {
    return () => {
      if (dictationStateRef.current === "listening") {
        void cancelRecording().catch((error) => {
          console.error("[输入栏] 卸载时取消录音失败:", error);
        });
      }
    };
  }, []);

  const refreshVoiceConfig = useCallback(async () => {
    const config = await getVoiceInputConfig();
    voiceConfigRef.current = config;
    setDictationEnabled(config.enabled);
    setSoundEnabled(config.sound_enabled);
    setVoiceConfigLoaded(true);
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

    try {
      const readiness = await getDefaultLocalVoiceModelReadiness();
      if (!readiness.ready) {
        toast.info(readiness.message || "先下载语音模型");
        requestOpenVoiceModelSettings({
          source: "inputbar",
          reason: "missing-model",
          modelId: readiness.model_id ?? null,
        });
        return;
      }
    } catch (error) {
      console.error("[输入栏] 检查本地语音模型失败:", error);
    }

    setDictationState("listening");
    setLiveTranscript("");
    lastLiveTranscriptRef.current = "";
    lastLiveTranscribedSampleRef.current = 0;
    dictationBaseTextRef.current = textRef.current;
    const textarea = textareaRef.current;
    dictationSelectionRef.current = {
      start: textarea?.selectionStart ?? textRef.current.length,
      end: textarea?.selectionEnd ?? textRef.current.length,
    };
    setRecordingStatus({
      is_recording: true,
      volume: 0,
      duration: 0,
    });
    playStartSound();

    try {
      await cancelRecording().catch(() => undefined);
      await startRecording(config.selected_device_id);
      setRecordingStatus({
        is_recording: true,
        volume: 0,
        duration: 0,
      });
    } catch (error: any) {
      console.error("[输入栏] 开始录音失败:", error);
      const message =
        typeof error === "string" ? error : error?.message || "无法开始录音";
      toast.error(message);
      setRecordingStatus(null);
      setDictationState("idle");
    }
  }, [disabled, playStartSound, refreshVoiceConfig, textareaRef]);

  const finishDictation = useCallback(async () => {
    if (dictationStateRef.current !== "listening") {
      return;
    }

    playStopSound();
    setRecordingStatus(null);
    setDictationState("transcribing");

    try {
      const result = await stopRecording();
      if (result.duration < 0.5) {
        toast.info("录音时间太短，请再试一次");
        setRecordingStatus(null);
        setDictationState("idle");
        return;
      }

      const transcription = await transcribeAudio(
        new Uint8Array(result.audio_data),
        result.sample_rate,
      );

      if (!transcription.text.trim()) {
        if (!lastLiveTranscriptRef.current) {
          toast.info("未识别到语音内容");
          setRecordingStatus(null);
          setDictationState("idle");
          return;
        }
      }

      let finalText =
        transcription.text.trim() || lastLiveTranscriptRef.current;
      const config = voiceConfigRef.current ?? (await refreshVoiceConfig());

      if (config.processor.polish_enabled) {
        setDictationState("polishing");
        try {
          const polished = await polishVoiceText(finalText);
          finalText = polished.text;
        } catch (error) {
          console.warn("[输入栏] 语音润色失败，保留原始识别内容:", error);
        }
      }

      applyTranscriptToDictationBase(finalText, true);
      setRecordingStatus(null);
      setDictationState("idle");
    } catch (error: any) {
      console.error("[输入栏] 完成语音输入失败:", error);
      const message =
        typeof error === "string" ? error : error?.message || "语音识别失败";
      toast.error(message);
      setRecordingStatus(null);
      setDictationState("idle");
    }
  }, [applyTranscriptToDictationBase, playStopSound, refreshVoiceConfig]);

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
    voiceConfigLoaded,
    dictationState,
    recordingStatus,
    liveTranscript,
    isDictating: dictationState === "listening",
    isDictationBusy: dictationState !== "idle",
    isDictationProcessing:
      dictationState === "transcribing" || dictationState === "polishing",
    handleDictationToggle,
  };
}
