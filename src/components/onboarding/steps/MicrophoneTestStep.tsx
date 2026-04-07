/**
 * 麦克风测试步骤
 */

import { useState, useEffect, useCallback, useRef } from "react";
import styled from "styled-components";
import { Mic, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VolumeWaveform } from "@/components/voice/VolumeWaveform";

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

const TestArea = styled.div`
  padding: 24px;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.5);
  margin-bottom: 24px;
`;

const WaveformContainer = styled.div`
  height: 60px;
  margin-bottom: 16px;
`;

const StatusText = styled.p<{ $success?: boolean; $error?: boolean }>`
  font-size: 14px;
  color: ${({ $success, $error }) =>
    $success
      ? "hsl(var(--primary))"
      : $error
        ? "hsl(var(--destructive))"
        : "hsl(var(--muted-foreground))"};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
`;

const PermissionWarning = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  background: hsl(var(--destructive) / 0.1);
  border: 1px solid hsl(var(--destructive) / 0.3);
  text-align: left;
  margin-bottom: 24px;
`;

const WarningText = styled.div`
  flex: 1;
  font-size: 13px;
  color: hsl(var(--destructive));
`;

interface MicrophoneTestStepProps {
  onSuccess: () => void;
  onSkip: () => void;
}

type TestState = "idle" | "testing" | "success" | "error";

export function MicrophoneTestStep({
  onSuccess,
  onSkip,
}: MicrophoneTestStepProps) {
  const [testState, setTestState] = useState<TestState>("idle");
  const [volume, setVolume] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maxVolume, setMaxVolume] = useState(0);
  const pollingRef = useRef<number | null>(null);

  // 开始测试
  const startTest = useCallback(async () => {
    setTestState("testing");
    setErrorMessage(null);
    setMaxVolume(0);

    try {
      const { startRecording, getRecordingStatus } =
        await import("@/lib/api/asrProvider");

      await startRecording();

      // 轮询获取音量
      pollingRef.current = window.setInterval(async () => {
        try {
          const status = await getRecordingStatus();
          setVolume(status.volume);
          setMaxVolume((prev) => Math.max(prev, status.volume));
        } catch (err) {
          console.error("获取录音状态失败:", err);
        }
      }, 100);
    } catch (err: any) {
      console.error("开始录音失败:", err);
      setTestState("error");
      const errMsg = typeof err === "string" ? err : err?.message || "未知错误";
      if (
        errMsg.toLowerCase().includes("permission") ||
        errMsg.toLowerCase().includes("device")
      ) {
        setErrorMessage("无法访问麦克风，请检查系统隐私设置");
      } else {
        setErrorMessage(`麦克风测试失败: ${errMsg}`);
      }
    }
  }, []);

  // 停止测试
  const stopTest = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    try {
      const { cancelRecording } = await import("@/lib/api/asrProvider");
      await cancelRecording();
    } catch (err) {
      console.error("取消录音失败:", err);
    }

    // 判断测试结果
    if (maxVolume > 10) {
      setTestState("success");
    } else {
      setTestState("error");
      setErrorMessage("未检测到声音，请检查麦克风是否正常工作");
    }
  }, [maxVolume]);

  // 清理
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      // 确保停止录音
      import("@/lib/api/asrProvider")
        .then(({ cancelRecording }) => cancelRecording())
        .catch(() => {});
    };
  }, []);

  // 测试成功后自动进入下一步
  useEffect(() => {
    if (testState === "success") {
      const timer = setTimeout(() => {
        onSuccess();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [testState, onSuccess]);

  // 打开系统设置
  const openSystemSettings = async () => {
    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.create("open", [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      ]);
      await cmd.execute();
    } catch (err) {
      console.error("打开系统设置失败:", err);
    }
  };

  return (
    <Container>
      <IconWrapper>
        <Mic size={40} className="text-primary" />
      </IconWrapper>

      <Title>测试麦克风</Title>
      <Description>
        点击开始测试，然后对着麦克风说话，检查麦克风是否正常工作。
      </Description>

      {testState === "error" && errorMessage && (
        <PermissionWarning>
          <AlertCircle size={20} />
          <WarningText>
            <p style={{ fontWeight: 500, marginBottom: 4 }}>{errorMessage}</p>
            {navigator.platform.includes("Mac") && (
              <Button
                variant="ghost"
                size="sm"
                className="p-0 h-auto text-destructive"
                onClick={openSystemSettings}
              >
                打开系统设置
              </Button>
            )}
          </WarningText>
        </PermissionWarning>
      )}

      <TestArea>
        <WaveformContainer>
          <VolumeWaveform
            volume={volume}
            isRecording={testState === "testing"}
          />
        </WaveformContainer>

        <StatusText
          $success={testState === "success"}
          $error={testState === "error"}
        >
          {testState === "idle" && "点击下方按钮开始测试"}
          {testState === "testing" && `正在录音... 音量: ${volume}%`}
          {testState === "success" && (
            <>
              <CheckCircle2 size={16} />
              麦克风工作正常！
            </>
          )}
          {testState === "error" && "测试失败"}
        </StatusText>
      </TestArea>

      <ButtonGroup>
        <Button variant="outline" onClick={onSkip}>
          跳过测试
        </Button>

        {testState === "idle" && <Button onClick={startTest}>开始测试</Button>}

        {testState === "testing" && (
          <Button onClick={stopTest}>停止测试</Button>
        )}

        {testState === "error" && <Button onClick={startTest}>重新测试</Button>}

        {testState === "success" && <Button onClick={onSuccess}>继续</Button>}
      </ButtonGroup>
    </Container>
  );
}
