/**
 * 快捷键设置页面
 *
 * 显示应用中已实现的快捷键
 */

import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { Loader2 } from "lucide-react";
import { getExperimentalConfig } from "@/lib/api/experimentalFeatures";
import {
  getVoiceInputConfig,
  type VoiceInputConfig,
} from "@/lib/api/asrProvider";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const HeaderHint = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid hsl(var(--border));
`;

const HotkeyItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
`;

const HotkeyInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const HotkeyLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
`;

const HotkeyDescription = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const HotkeyMeta = styled.div`
  margin-top: 2px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const HotkeyValue = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const StatusBadge = styled.span<{ $enabled: boolean }>`
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid
    ${({ $enabled }) =>
      $enabled ? "hsl(var(--primary) / 0.3)" : "hsl(var(--border))"};
  color: ${({ $enabled }) =>
    $enabled ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  background: ${({ $enabled }) =>
    $enabled ? "hsl(var(--primary) / 0.08)" : "hsl(var(--muted) / 0.35)"};
`;

const KeyBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  color: hsl(var(--foreground));
`;

interface HotkeyConfig {
  id: string;
  label: string;
  description: string;
  keys: string[];
  enabled: boolean;
  source: string;
}

function formatShortcutKeys(shortcut: string): string[] {
  const map: Record<string, string> = {
    CommandOrControl: "⌘/Ctrl",
    Command: "⌘",
    Control: "Ctrl",
    Ctrl: "Ctrl",
    Alt: "Alt",
    Option: "⌥",
    Shift: "⇧",
    Super: "Super",
  };

  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => map[part] ?? part);
}

interface HotkeyState {
  globalHotkeys: HotkeyConfig[];
  localHotkeys: HotkeyConfig[];
}

function buildHotkeys(
  screenshotEnabled: boolean,
  screenshotShortcut: string,
  voiceConfig: VoiceInputConfig,
): HotkeyState {
  const globalHotkeys: HotkeyConfig[] = [
    {
      id: "screenshot-chat",
      label: "截图对话",
      description: "触发全局截图并打开截图对话窗口",
      keys: formatShortcutKeys(screenshotShortcut),
      enabled: screenshotEnabled,
      source: "实验功能 → 截图对话",
    },
    {
      id: "voice-input",
      label: "语音输入",
      description: "按下开始录音，松开后识别并输出",
      keys: formatShortcutKeys(voiceConfig.shortcut),
      enabled: voiceConfig.enabled,
      source: "语音服务",
    },
    {
      id: "voice-translate",
      label: "语音翻译模式",
      description: "独立快捷键触发语音识别并执行翻译指令",
      keys: voiceConfig.translate_shortcut
        ? formatShortcutKeys(voiceConfig.translate_shortcut)
        : ["未设置"],
      enabled: voiceConfig.enabled && !!voiceConfig.translate_shortcut,
      source: `语音服务 → 指令 ${voiceConfig.translate_instruction_id}`,
    },
  ];

  const localHotkeys: HotkeyConfig[] = [
    {
      id: "terminal-search",
      label: "终端搜索",
      description: "在终端页面打开搜索框",
      keys: ["⌘/Ctrl", "F"],
      enabled: true,
      source: "终端页面",
    },
    {
      id: "terminal-font-plus",
      label: "终端字体放大",
      description: "在终端页面增大字体",
      keys: ["⌘/Ctrl", "+"],
      enabled: true,
      source: "终端页面",
    },
    {
      id: "terminal-font-minus",
      label: "终端字体缩小",
      description: "在终端页面减小字体",
      keys: ["⌘/Ctrl", "-"],
      enabled: true,
      source: "终端页面",
    },
    {
      id: "terminal-font-reset",
      label: "终端字体重置",
      description: "在终端页面重置字体大小",
      keys: ["⌘/Ctrl", "0"],
      enabled: true,
      source: "终端页面",
    },
  ];

  return { globalHotkeys, localHotkeys };
}

function HotkeySection({
  title,
  hotkeys,
}: {
  title: string;
  hotkeys: HotkeyConfig[];
}) {
  return (
    <Section>
      <SectionTitle>{title}</SectionTitle>
      {hotkeys.map((hotkey) => (
        <HotkeyItem key={hotkey.id}>
          <HotkeyInfo>
            <HotkeyLabel>{hotkey.label}</HotkeyLabel>
            <HotkeyDescription>{hotkey.description}</HotkeyDescription>
            <HotkeyMeta>{hotkey.source}</HotkeyMeta>
          </HotkeyInfo>
          <HotkeyValue>
            <StatusBadge $enabled={hotkey.enabled}>
              {hotkey.enabled ? "已启用" : "未启用"}
            </StatusBadge>
            {hotkey.keys.map((key, index) => (
              <KeyBadge key={index}>{key}</KeyBadge>
            ))}
          </HotkeyValue>
        </HotkeyItem>
      ))}
    </Section>
  );
}

export function HotkeysSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalHotkeys, setGlobalHotkeys] = useState<HotkeyConfig[]>([]);
  const [localHotkeys, setLocalHotkeys] = useState<HotkeyConfig[]>([]);

  const loadHotkeys = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [experimentalConfig, voiceConfig] = await Promise.all([
        getExperimentalConfig(),
        getVoiceInputConfig(),
      ]);

      const built = buildHotkeys(
        experimentalConfig.screenshot_chat.enabled,
        experimentalConfig.screenshot_chat.shortcut,
        voiceConfig,
      );

      setGlobalHotkeys(built.globalHotkeys);
      setLocalHotkeys(built.localHotkeys);
    } catch (loadError) {
      console.error("加载快捷键信息失败:", loadError);
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHotkeys();
  }, [loadHotkeys]);

  return (
    <Container>
      <HeaderHint>
        仅展示当前版本已实现的快捷键；全局快捷键会随配置实时更新。
      </HeaderHint>

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <Loader2 size={16} className="animate-spin" />
          正在加载快捷键信息...
        </div>
      ) : error ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
            fontSize: 13,
          }}
        >
          加载快捷键失败：{error}
        </div>
      ) : (
        <>
          <HotkeySection title="全局快捷键" hotkeys={globalHotkeys} />
          <HotkeySection title="页面内快捷键" hotkeys={localHotkeys} />
        </>
      )}
    </Container>
  );
}

export default HotkeysSettings;
