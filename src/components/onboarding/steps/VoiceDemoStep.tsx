/**
 * 语音输入演示步骤
 */

import { useState, useEffect, useCallback, useRef } from "react";
import styled from "styled-components";
import { Mic, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VolumeWaveform } from "@/components/voice/VolumeWaveform";
import { useVoiceSound } from "@/hooks/useVoiceSound";

const Container = styled.div`
  padding: 32px 24px;
  text-align: center;
`;

const IconWrapper = styled.div`
  width: 80px;
  height: 80px;
  margin: 0 auto 24px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Title = styled.h2`
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 12px;
  color: hsl(var(--foreground));
`;

const Description = styled.p`
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 32px;
  line-height: 1.6;
`;

const DemoArea = styled.div`
  padding: 24px;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.5);
  margin-bottom: 24px;
`;

const WaveformContainer = styled.div`
  height: 60px;
  margin-bottom: 16px;
`;

const ResultText = styled.div`
  min-height: 60px;
  padding: 16px;
  border-radius: 8px;
  background: hsl(var(--background));
  font-size: 16px;
  line-height: 1.6;
  text-align: left;
  color: hsl(var(--foreground));
`;

const StatusText = styled.p<{ $success?: boolean }>`
  font-size: 14px;
  color: ${({ $success }) =>
    $success ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
`;

const RecordButton = styled.button<{ $recording: boolean }>`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: ${({ $recording }) =>
    $recording ? "hsl(var(--destructive))" : "hsl(var(--primary))"};
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin: 0 auto 16px;

  &:hover {
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

interface VoiceDemoStepProps {
  onSuccess: () => void;
  onSkip: () => void;
}

type DemoState = "idle" | "recording" | "transcribing" | "polishing" | "done";

export function VoiceDemoStep({ onSuccess, onSkip }: VoiceDemoStepProps) {
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [volume, setVolume] = useState(0);
  const [resultText, setResultText] = useState("");
  const pollingRef = useRef<number | null>(null);

  const { playStartSound, playStopSound } = useVoiceSound(true);

  // 开始录音
  const startRecording = useCallback(async () => {
    setDemoState("recording");
    setResultText("");
    playStartSound();

    try {
      const { startRecording: start, getRecordingStatus } =
        await import("@/lib/api/asrProvider");

      await start();

      // 轮询获取音量
      pollingRef.current = window.setInterval(async () => {
        try {
          const status = await getRecordingStatus();
          setVolume(status.volume);
        } catch (err) {
          console.error("获取录音状态失败:", err);
        }
      }, 100);
    } catch (err) {
      console.error("开始录音失败:", err);
      setDemoState("idle");
    }
  }, [playStartSound]);

  // 停止录音并处理
  const stopRecording = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    playStopSound();
    setDemoState("transcribing");

    try {
      const {
        stopRecording: stop,
        transcribeAudio,
        polishVoiceText,
        getVoiceInputConfig,
      } = await import("@/lib/api/asrProvider");

      const result = await stop();

      if (result.duration < 0.5) {
        setResultText("录音时间太短，请再试一次");
        setDemoState("idle");
        return;
      }

      const audioData = new Uint8Array(result.audio_data);
      const transcribeResult = await transcribeAudio(
        audioData,
        result.sample_rate,
      );

      if (!transcribeResult.text.trim()) {
        setResultText("未识别到语音内容，请再试一次");
        setDemoState("idle");
        return;
      }

      // 检查是否启用润色
      const config = await getVoiceInputConfig();
      let finalText = transcribeResult.text;

      if (config.processor.polish_enabled) {
        setDemoState("polishing");
        try {
          const polished = await polishVoiceText(transcribeResult.text);
          finalText = polished.text;
        } catch (e) {
          console.error("润色失败:", e);
        }
      }

      setResultText(finalText);
      setDemoState("done");
    } catch (err) {
      console.error("语音识别失败:", err);
      setResultText("语音识别失败，请再试一次");
      setDemoState("idle");
    }
  }, [playStopSound]);

  // 清理
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      import("@/lib/api/asrProvider")
        .then(({ cancelRecording }) => cancelRecording())
        .catch(() => {});
    };
  }, []);

  const getStatusText = () => {
    switch (demoState) {
      case "idle":
        return "点击麦克风按钮开始录音";
      case "recording":
        return "正在录音，再次点击停止...";
      case "transcribing":
        return (
          <>
            <Loader2 size={16} className="animate-spin" />
            正在识别...
          </>
        );
      case "polishing":
        return (
          <>
            <Loader2 size={16} className="animate-spin" />
            正在润色...
          </>
        );
      case "done":
        return (
          <>
            <CheckCircle2 size={16} />
            识别完成！
          </>
        );
      default:
        return "";
    }
  };

  return (
    <Container>
      <IconWrapper>
        <Mic size={40} className="text-primary" />
      </IconWrapper>

      <Title>体验语音输入</Title>
      <Description>
        点击麦克风按钮，说一句话试试。
        <br />
        语音会被识别并自动润色。
      </Description>

      <DemoArea>
        <RecordButton
          $recording={demoState === "recording"}
          onClick={demoState === "recording" ? stopRecording : startRecording}
          disabled={demoState === "transcribing" || demoState === "polishing"}
        >
          {demoState === "transcribing" || demoState === "polishing" ? (
            <Loader2 size={28} className="animate-spin" />
          ) : (
            <Mic size={28} />
          )}
        </RecordButton>

        {demoState === "recording" && (
          <WaveformContainer>
            <VolumeWaveform volume={volume} isRecording={true} />
          </WaveformContainer>
        )}

        {resultText && <ResultText>{resultText}</ResultText>}

        <StatusText $success={demoState === "done"}>
          {getStatusText()}
        </StatusText>
      </DemoArea>

      <ButtonGroup>
        <Button variant="outline" onClick={onSkip}>
          跳过
        </Button>
        {demoState === "done" && <Button onClick={onSuccess}>完成设置</Button>}
      </ButtonGroup>
    </Container>
  );
}
