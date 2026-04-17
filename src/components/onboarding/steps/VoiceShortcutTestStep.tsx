/**
 * 语音快捷键测试步骤
 */

import { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { Keyboard, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  onVoiceStartRecording,
  onVoiceStopRecording,
} from "@/lib/api/voiceShortcutEvents";
import { getVoiceShortcutRuntimeStatus } from "@/lib/api/hotkeys";

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

const ShortcutDisplay = styled.div<{ $active: boolean; $success: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  border-radius: 12px;
  font-family: monospace;
  font-size: 18px;
  margin-bottom: 24px;
  transition: all 0.3s;
  background: ${({ $active, $success }) =>
    $success
      ? "hsl(var(--primary) / 0.1)"
      : $active
        ? "hsl(var(--primary) / 0.2)"
        : "hsl(var(--muted))"};
  border: 2px solid
    ${({ $active, $success }) =>
      $success
        ? "hsl(var(--primary))"
        : $active
          ? "hsl(var(--primary) / 0.5)"
          : "transparent"};
`;

const StatusIcon = styled.div<{ $success: boolean }>`
  color: ${({ $success }) =>
    $success ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
`;

const HintText = styled.p`
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  margin-top: 16px;
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
`;

const WarningBox = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  margin: 0 auto 20px;
  max-width: 380px;
  border-radius: 10px;
  background: hsl(var(--destructive) / 0.08);
  border: 1px solid hsl(var(--destructive) / 0.2);
  text-align: left;
  color: hsl(var(--destructive));
  font-size: 13px;
  line-height: 1.5;
`;

interface VoiceShortcutTestStepProps {
  shortcut: string;
  onSuccess: () => void;
  onSkip: () => void;
}

function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace(
      "CommandOrControl",
      navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
    )
    .replace("Shift", navigator.platform.includes("Mac") ? "⇧" : "Shift")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace(/\+/g, " + ");
}

export function VoiceShortcutTestStep({
  shortcut,
  onSuccess,
  onSkip,
}: VoiceShortcutTestStepProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [shortcutRegistered, setShortcutRegistered] = useState(true);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const hasSeenStartRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const status = await getVoiceShortcutRuntimeStatus();
        if (cancelled) {
          return;
        }
        setShortcutRegistered(status.shortcut_registered);
      } catch (err) {
        console.error("读取语音快捷键运行时状态失败:", err);
      } finally {
        if (!cancelled) {
          setRegistrationChecked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 监听快捷键事件
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        // 监听录音开始事件（快捷键按下）
        const unlistenStart = await onVoiceStartRecording(() => {
          hasSeenStartRef.current = true;
          setIsPressed(true);
        });

        // 监听录音停止事件（快捷键释放）
        const unlistenStop = await onVoiceStopRecording(() => {
          setIsPressed(false);
          if (!hasSeenStartRef.current) {
            return;
          }
          hasSeenStartRef.current = false;
          setTestSuccess(true);
          // 取消录音（因为这只是测试）
          import("@/lib/api/asrProvider").then(({ cancelRecording }) => {
            cancelRecording().catch(console.error);
          });
        });

        unlisten = () => {
          unlistenStart();
          unlistenStop();
        };
      } catch (err) {
        console.error("监听快捷键事件失败:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 测试成功后自动进入下一步
  useEffect(() => {
    if (testSuccess) {
      const timer = setTimeout(() => {
        onSuccess();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [testSuccess, onSuccess]);

  return (
    <Container>
      <IconWrapper>
        <Keyboard size={40} className="text-primary" />
      </IconWrapper>

      <Title>测试语音快捷键</Title>
      <Description>
        按下并松开语音输入快捷键，验证快捷键是否正常工作。
        <br />
        如果快捷键被其他应用占用，可以稍后在设置中修改。
      </Description>

      <ShortcutDisplay $active={isPressed} $success={testSuccess}>
        <StatusIcon $success={testSuccess}>
          {testSuccess ? <CheckCircle2 size={20} /> : <Keyboard size={20} />}
        </StatusIcon>
        {formatShortcutDisplay(shortcut)}
      </ShortcutDisplay>

      <HintText>
        {testSuccess
          ? "快捷键工作正常！"
          : isPressed
            ? "检测到按下，请松开..."
            : "请按下快捷键进行测试"}
      </HintText>

      {registrationChecked && !shortcutRegistered && (
        <WarningBox>
          <AlertCircle size={16} />
          <div>
            当前运行时没有把这组语音快捷键注册到系统，按键可能被其他应用占用，或语音输入尚未完成注册。
          </div>
        </WarningBox>
      )}

      <ButtonGroup>
        <Button variant="outline" onClick={onSkip}>
          跳过测试
        </Button>
        {testSuccess && <Button onClick={onSuccess}>继续</Button>}
      </ButtonGroup>
    </Container>
  );
}
