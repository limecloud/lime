/**
 * 角色与技能引用组件
 *
 * 在输入框中检测 @ 或 / 符号，显示角色、技能与命令列表供选择
 */

import React, {
  Suspense,
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import {
  getSkillCatalog,
  subscribeSkillCatalogChanged,
} from "@/lib/api/skillCatalog";
import {
  listServiceSkills,
  type ServiceSkillItem,
} from "@/lib/api/serviceSkills";
import { filterMentionableServiceSkills } from "@/components/agent/chat/service-skills/entryAdapter";
import {
  getServiceSkillActionLabel,
  getServiceSkillRunnerDescription,
  getServiceSkillRunnerLabel,
  getServiceSkillRunnerTone,
} from "@/components/agent/chat/service-skills/skillPresentation";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import { toast } from "sonner";
import {
  filterCodexSlashCommands,
  type CodexSlashCommandDefinition,
} from "../commands";
import {
  INPUTBAR_BUILTIN_COMMANDS,
  filterBuiltinCommands,
  filterRuntimeSceneSlashCommands,
  listBuiltinCommandsFromSkillCatalog,
  listRuntimeSceneSlashCommandsFromSkillCatalog,
  type BuiltinInputCommand,
  type RuntimeSceneSlashCommand,
} from "./builtinCommands";
import {
  LazyCharacterMentionPanel,
  preloadCharacterMentionPanel,
} from "./characterMentionPanelLoader";
import { recordSlashEntryUsage } from "./slashEntryUsage";
import { partitionMentionableSkills } from "./skillQuery";
import { useIdleModulePreload } from "./useIdleModulePreload";

interface CharacterMentionProps {
  /** 角色列表 */
  characters: Character[];
  /** 技能列表 */
  skills?: Skill[];
  /** 技能目录项列表 */
  serviceSkills?: ServiceSkillHomeItem[];
  /** 输入框 ref */
  inputRef: React.RefObject<HTMLTextAreaElement>;
  /** 当前输入值 */
  value: string;
  /** 输入值变更回调 */
  onChange: (value: string) => void;
  /** 选择角色回调 */
  onSelectCharacter?: (character: Character) => void;
  /** 选择已安装技能回调 */
  onSelectSkill?: (skill: Skill) => void;
  /** 选择技能目录项回调 */
  onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
  /** 选择内建命令回调 */
  onSelectBuiltinCommand?: (
    command: BuiltinInputCommand,
    options?: BuiltinCommandSelectionOptions,
  ) => void;
  /** 跳转到设置页安装技能 */
  onNavigateToSettings?: () => void;
}

type TriggerMode = "mention" | "slash";

interface ActiveTrigger {
  mode: TriggerMode;
  triggerIndex: number;
  query: string;
}

interface BuiltinCommandSelectionOptions {
  replayText?: string;
}

function resolveMentionTrigger(textBeforeCursor: string): ActiveTrigger | null {
  const lastAtIndex = textBeforeCursor.lastIndexOf("@");
  if (lastAtIndex === -1) {
    return null;
  }

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
  if (textAfterAt.includes(" ") || textAfterAt.includes("\n")) {
    return null;
  }

  return {
    mode: "mention",
    triggerIndex: lastAtIndex,
    query: textAfterAt,
  };
}

function resolveSlashTrigger(textBeforeCursor: string): ActiveTrigger | null {
  const slashMatch = textBeforeCursor.match(/(?:^|[\s\n])(\/[^\s\n/]*)$/);
  if (!slashMatch) {
    return null;
  }

  const slashToken = slashMatch[1];
  const triggerIndex = textBeforeCursor.length - slashToken.length;
  return {
    mode: "slash",
    triggerIndex,
    query: slashToken.slice(1),
  };
}

function resolveActiveTrigger(
  value: string,
  cursorPos: number,
): ActiveTrigger | null {
  const textBeforeCursor = value.slice(0, cursorPos);
  const mentionTrigger = resolveMentionTrigger(textBeforeCursor);
  const slashTrigger = resolveSlashTrigger(textBeforeCursor);

  if (!mentionTrigger) {
    return slashTrigger;
  }
  if (!slashTrigger) {
    return mentionTrigger;
  }

  return mentionTrigger.triggerIndex > slashTrigger.triggerIndex
    ? mentionTrigger
    : slashTrigger;
}

function normalizeReplayText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mergeTriggerSelectionText(params: {
  leadingText: string;
  insertedText: string;
  trailingText: string;
}): { value: string; cursorPos: number } {
  const normalizedInsertedText = params.insertedText.trim();
  if (!normalizedInsertedText) {
    return {
      value: `${params.leadingText}${params.trailingText}`,
      cursorPos: params.leadingText.length,
    };
  }

  const needsLeadingSpace =
    params.leadingText.length > 0 && !/[\s\n]$/.test(params.leadingText);
  const needsTrailingSpace =
    params.trailingText.length > 0 && !/^[\s\n]/.test(params.trailingText);
  const mergedInsertedText = `${needsLeadingSpace ? " " : ""}${normalizedInsertedText}${
    needsTrailingSpace ? " " : ""
  }`;

  return {
    value: `${params.leadingText}${mergedInsertedText}${params.trailingText}`,
    cursorPos: params.leadingText.length + mergedInsertedText.length,
  };
}

function normalizeSceneToken(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function toServiceSkillHomeItem(skill: ServiceSkillItem): ServiceSkillHomeItem {
  return {
    ...skill,
    badge: skill.source === "cloud_catalog" ? "云目录" : "本地技能",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: getServiceSkillRunnerLabel(skill),
    runnerTone: getServiceSkillRunnerTone(skill),
    runnerDescription: getServiceSkillRunnerDescription(skill),
    actionLabel: getServiceSkillActionLabel(skill),
    automationStatus: null,
    cloudStatus:
      skill.executionLocation === "cloud_required" ? null : undefined,
  };
}

function matchesSceneBoundServiceSkill(
  skill: ServiceSkillItem,
  command: RuntimeSceneSlashCommand,
): boolean {
  const binding = skill.sceneBinding;
  if (!binding) {
    return false;
  }

  const commandTokens = new Set(
    [command.key, command.commandPrefix, ...(command.aliases ?? [])]
      .map((value) => normalizeSceneToken(value))
      .filter(Boolean),
  );
  if (commandTokens.size === 0) {
    return false;
  }

  if (commandTokens.has(normalizeSceneToken(binding.sceneKey))) {
    return true;
  }
  if (commandTokens.has(normalizeSceneToken(binding.commandPrefix))) {
    return true;
  }

  return (binding.aliases ?? []).some((alias) =>
    commandTokens.has(normalizeSceneToken(alias)),
  );
}

export function CharacterMention({
  characters,
  skills = [],
  serviceSkills = [],
  inputRef,
  value,
  onChange,
  onSelectCharacter,
  onSelectSkill,
  onSelectServiceSkill,
  onSelectBuiltinCommand,
  onNavigateToSettings,
}: CharacterMentionProps) {
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("mention");
  const [runtimeBuiltinCommands, setRuntimeBuiltinCommands] = useState<
    BuiltinInputCommand[]
  >(INPUTBAR_BUILTIN_COMMANDS);
  const [runtimeSceneCommands, setRuntimeSceneCommands] = useState<
    RuntimeSceneSlashCommand[]
  >([]);
  const [panelAnchor, setPanelAnchor] = useState({
    top: 0,
    left: 0,
    width: 320,
    bottom: 0,
    maxHeight: 320,
  });
  const commandRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useIdleModulePreload(() => {
    void preloadCharacterMentionPanel();
  });

  const filteredBuiltinCommands = useMemo(
    () => filterBuiltinCommands(mentionQuery, runtimeBuiltinCommands),
    [mentionQuery, runtimeBuiltinCommands],
  );
  const filteredServiceSkills = useMemo(
    () => filterMentionableServiceSkills(serviceSkills, mentionQuery),
    [mentionQuery, serviceSkills],
  );
  const filteredSlashCommands = useMemo(
    () => filterCodexSlashCommands(mentionQuery),
    [mentionQuery],
  );
  const filteredRuntimeSceneCommands = useMemo(
    () => filterRuntimeSceneSlashCommands(mentionQuery, runtimeSceneCommands),
    [mentionQuery, runtimeSceneCommands],
  );

  const filteredCharacters = useMemo(() => {
    if (!mentionQuery) return characters;
    const query = mentionQuery.toLowerCase();
    return characters.filter(
      (char) =>
        char.name.toLowerCase().includes(query) ||
        char.description?.toLowerCase().includes(query),
    );
  }, [characters, mentionQuery]);

  const { installedSkills, availableSkills } = useMemo(
    () => partitionMentionableSkills(skills, mentionQuery),
    [skills, mentionQuery],
  );

  const updateMentionState = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      setShowMentions(false);
      return;
    }

    const cursorPos = textarea.selectionStart ?? textarea.value.length;
    const activeTrigger = resolveActiveTrigger(textarea.value, cursorPos);
    if (!activeTrigger) {
      setShowMentions(false);
      return;
    }

    setMentionQuery(activeTrigger.query);
    setTriggerMode(activeTrigger.mode);
    setShowMentions(true);

    const rect = textarea.getBoundingClientRect();
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 800;
    const screenPadding = viewportWidth < 640 ? 12 : 16;
    const panelGap = viewportWidth < 640 ? 6 : 8;
    const panelWidth = Math.min(
      rect.width,
      Math.max(viewportWidth - screenPadding * 2, 240),
    );
    const left = Math.min(
      Math.max(rect.left, screenPadding),
      viewportWidth - panelWidth - screenPadding,
    );
    setPanelAnchor({
      top: rect.top,
      left,
      width: panelWidth,
      bottom: Math.max(viewportHeight - rect.top + panelGap, panelGap),
      maxHeight: Math.max(
        Math.min(rect.top - panelGap - screenPadding, 420),
        120,
      ),
    });
  }, [inputRef]);

  useEffect(() => {
    let cancelled = false;

    const syncCatalog = async () => {
      try {
        const catalog = await getSkillCatalog();
        if (cancelled) {
          return;
        }
        const nextBuiltinCommands =
          listBuiltinCommandsFromSkillCatalog(catalog);
        const nextRuntimeScenes =
          listRuntimeSceneSlashCommandsFromSkillCatalog(catalog);
        setRuntimeBuiltinCommands(
          nextBuiltinCommands.length > 0
            ? nextBuiltinCommands
            : INPUTBAR_BUILTIN_COMMANDS,
        );
        setRuntimeSceneCommands(nextRuntimeScenes);
      } catch {
        if (cancelled) {
          return;
        }
        setRuntimeBuiltinCommands(INPUTBAR_BUILTIN_COMMANDS);
        setRuntimeSceneCommands([]);
      }
    };

    void syncCatalog();
    const unsubscribe = subscribeSkillCatalogChanged(() => {
      void syncCatalog();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.addEventListener("input", updateMentionState);
    textarea.addEventListener("click", updateMentionState);
    textarea.addEventListener("keyup", updateMentionState);

    return () => {
      textarea.removeEventListener("input", updateMentionState);
      textarea.removeEventListener("click", updateMentionState);
      textarea.removeEventListener("keyup", updateMentionState);
    };
  }, [inputRef, updateMentionState]);

  useEffect(() => {
    updateMentionState();
  }, [updateMentionState, value]);

  useEffect(() => {
    if (!showMentions) {
      return;
    }

    const handleReposition = () => {
      updateMentionState();
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [showMentions, updateMentionState]);

  useEffect(() => {
    if (!showMentions) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        panelRef.current?.contains(target) ||
        inputRef.current?.contains(target)
      ) {
        return;
      }
      setShowMentions(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [inputRef, showMentions]);

  const handleSelectCharacter = (character: Character) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger || activeTrigger.mode !== "mention") {
      return;
    }

    const newValue =
      currentValue.slice(0, activeTrigger.triggerIndex) +
      `@${character.name} ` +
      textAfterCursor;

    onChange(newValue);
    setShowMentions(false);
    onSelectCharacter?.(character);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos =
        activeTrigger.triggerIndex + character.name.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSelectInstalledSkill = (
    skill: Skill,
    options?: { replayText?: string },
  ) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger) {
      return;
    }

    if (activeTrigger.mode === "slash") {
      const replayText = normalizeReplayText(options?.replayText);
      const nextSelection = replayText
        ? mergeTriggerSelectionText({
            leadingText: currentValue.slice(0, activeTrigger.triggerIndex),
            insertedText: `/${skill.key} ${replayText}`,
            trailingText: textAfterCursor,
          })
        : {
            value:
              currentValue.slice(0, activeTrigger.triggerIndex) +
              `/${skill.key} ` +
              textAfterCursor,
            cursorPos: activeTrigger.triggerIndex + skill.key.length + 2,
          };
      onChange(nextSelection.value);
      setShowMentions(false);
      recordSlashEntryUsage({
        kind: "skill",
        entryId: skill.key,
        replayText: replayText || undefined,
      });

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = nextSelection.cursorPos;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      return;
    }

    if (onSelectSkill) {
      const newValue =
        currentValue.slice(0, activeTrigger.triggerIndex) + textAfterCursor;
      onChange(newValue.trimEnd() === "" ? "" : newValue);
      setShowMentions(false);
      onSelectSkill(skill);

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = Math.max(0, activeTrigger.triggerIndex);
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      return;
    }

    const newValue =
      currentValue.slice(0, activeTrigger.triggerIndex) +
      `/${skill.key} ` +
      textAfterCursor;
    onChange(newValue);
    setShowMentions(false);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = activeTrigger.triggerIndex + skill.key.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSelectAvailableSkill = (skill: Skill) => {
    setShowMentions(false);

    toast.info(`技能「${skill.name}」尚未安装`, {
      action: onNavigateToSettings
        ? {
            label: "去技能中心",
            onClick: onNavigateToSettings,
          }
        : undefined,
    });
  };

  const handleSelectBuiltinCommand = (
    command: BuiltinInputCommand,
    options?: BuiltinCommandSelectionOptions,
  ) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger || activeTrigger.mode !== "mention") {
      return;
    }

    const leadingText = currentValue.slice(0, activeTrigger.triggerIndex);
    const replayText = normalizeReplayText(options?.replayText);

    if (onSelectBuiltinCommand) {
      const nextSelection = replayText
        ? mergeTriggerSelectionText({
            leadingText,
            insertedText: replayText,
            trailingText: textAfterCursor,
          })
        : {
            value: `${leadingText}${textAfterCursor}`,
            cursorPos: Math.max(0, activeTrigger.triggerIndex),
          };
      const normalizedValue =
        nextSelection.value.trimEnd() === "" ? "" : nextSelection.value;

      onChange(normalizedValue);
      setShowMentions(false);
      if (options?.replayText) {
        onSelectBuiltinCommand(command, options);
      } else {
        onSelectBuiltinCommand(command);
      }

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = Math.min(
          nextSelection.cursorPos,
          normalizedValue.length,
        );
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      return;
    }

    const nextSelection = replayText
      ? mergeTriggerSelectionText({
          leadingText,
          insertedText: `${command.commandPrefix} ${replayText}`,
          trailingText: textAfterCursor,
        })
      : {
          value: `${leadingText}${command.commandPrefix} ${textAfterCursor}`,
          cursorPos:
            activeTrigger.triggerIndex + command.commandPrefix.length + 1,
        };

    onChange(nextSelection.value);
    setShowMentions(false);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = nextSelection.cursorPos;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSelectServiceSkill = (skill: ServiceSkillHomeItem) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger || activeTrigger.mode !== "mention") {
      return;
    }

    if (onSelectServiceSkill) {
      const newValue =
        currentValue.slice(0, activeTrigger.triggerIndex) + textAfterCursor;
      onChange(newValue.trimEnd() === "" ? "" : newValue);
      setShowMentions(false);
      onSelectServiceSkill(skill);

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = Math.max(0, activeTrigger.triggerIndex);
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
      return;
    }

    const newValue =
      currentValue.slice(0, activeTrigger.triggerIndex) +
      `@${skill.title} ` +
      textAfterCursor;
    onChange(newValue);
    setShowMentions(false);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = activeTrigger.triggerIndex + skill.title.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSelectSlashCommand = (
    command: CodexSlashCommandDefinition,
    options?: { replayText?: string },
  ) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger || activeTrigger.mode !== "slash") {
      return;
    }

    const replayText = normalizeReplayText(options?.replayText);
    const nextSelection = replayText
      ? mergeTriggerSelectionText({
          leadingText: currentValue.slice(0, activeTrigger.triggerIndex),
          insertedText: `${command.commandPrefix} ${replayText}`,
          trailingText: textAfterCursor,
        })
      : {
          value:
            currentValue.slice(0, activeTrigger.triggerIndex) +
            `${command.commandPrefix} ` +
            textAfterCursor,
          cursorPos:
            activeTrigger.triggerIndex + command.commandPrefix.length + 1,
        };

    onChange(nextSelection.value);
    setShowMentions(false);
    if (command.support === "supported") {
      recordSlashEntryUsage({
        kind: "command",
        entryId: command.key,
        replayText: replayText || undefined,
      });
    }

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = nextSelection.cursorPos;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleSelectRuntimeSceneCommand = async (
    command: RuntimeSceneSlashCommand,
    options?: { replayText?: string },
  ) => {
    const replayText = normalizeReplayText(options?.replayText);

    if (!replayText && onSelectServiceSkill) {
      const matchedVisibleSkill = serviceSkills.find((skill) =>
        matchesSceneBoundServiceSkill(skill, command),
      );
      const matchedSkill =
        matchedVisibleSkill ||
        (await (async () => {
          try {
            const runtimeSkills = await listServiceSkills();
            const runtimeMatchedSkill = runtimeSkills.find((skill) =>
              matchesSceneBoundServiceSkill(skill, command),
            );
            return runtimeMatchedSkill
              ? toServiceSkillHomeItem(runtimeMatchedSkill)
              : null;
          } catch {
            return null;
          }
        })());

      if (
        matchedSkill &&
        matchedSkill.slotSchema.some((slot) => slot.required)
      ) {
        onSelectServiceSkill(matchedSkill);
        setShowMentions(false);
        recordSlashEntryUsage({
          kind: "scene",
          entryId: command.key,
        });
        return;
      }
    }

    const textarea = inputRef.current;
    if (!textarea) return;

    const currentValue = textarea.value || value;
    const cursorPos = textarea.selectionStart ?? currentValue.length;
    const textAfterCursor = currentValue.slice(cursorPos);
    const activeTrigger = resolveActiveTrigger(currentValue, cursorPos);
    if (!activeTrigger || activeTrigger.mode !== "slash") {
      return;
    }

    const nextSelection = replayText
      ? mergeTriggerSelectionText({
          leadingText: currentValue.slice(0, activeTrigger.triggerIndex),
          insertedText: `${command.commandPrefix} ${replayText}`,
          trailingText: textAfterCursor,
        })
      : {
          value:
            currentValue.slice(0, activeTrigger.triggerIndex) +
            `${command.commandPrefix} ` +
            textAfterCursor,
          cursorPos:
            activeTrigger.triggerIndex + command.commandPrefix.length + 1,
        };

    onChange(nextSelection.value);
    setShowMentions(false);
    recordSlashEntryUsage({
      kind: "scene",
      entryId: command.key,
      replayText: replayText || undefined,
    });

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = nextSelection.cursorPos;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea || !showMentions) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const composing =
        (e as KeyboardEvent & { isComposing?: boolean }).isComposing ||
        e.key === "Process" ||
        e.keyCode === 229;
      if (composing) {
        return;
      }

      if (e.key === "Escape") {
        setShowMentions(false);
        e.preventDefault();
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const cmdkRoot = commandRef.current;
        if (cmdkRoot) {
          cmdkRoot.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: e.key,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }
    };

    textarea.addEventListener("keydown", handleKeyDown);
    return () => textarea.removeEventListener("keydown", handleKeyDown);
  }, [showMentions, inputRef]);

  if (!showMentions) return null;

  return createPortal(
    <>
      <div
        data-testid="mention-anchor"
        style={{
          position: "fixed",
          top: panelAnchor.top,
          left: panelAnchor.left,
          width: panelAnchor.width,
          height: 1,
          pointerEvents: "none",
          zIndex: 79,
        }}
      />
      <div
        ref={panelRef}
        data-testid="mention-popover-content"
        data-side="top"
        data-align="start"
        data-avoid-collisions="false"
        className="border bg-background p-0 shadow-md"
        style={{
          position: "fixed",
          left: panelAnchor.left,
          bottom: panelAnchor.bottom,
          width: `${panelAnchor.width}px`,
          maxWidth: "calc(100vw - 24px)",
          maxHeight: `${panelAnchor.maxHeight}px`,
          overflow: "auto",
          zIndex: 80,
        }}
      >
        <Suspense
          fallback={
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              加载中...
            </div>
          }
        >
          <LazyCharacterMentionPanel
            mode={triggerMode}
            mentionQuery={mentionQuery}
            builtinCommands={filteredBuiltinCommands}
            slashCommands={filteredSlashCommands}
            sceneCommands={filteredRuntimeSceneCommands}
            mentionServiceSkills={filteredServiceSkills}
            filteredCharacters={filteredCharacters}
            installedSkills={installedSkills}
            availableSkills={availableSkills}
            commandRef={commandRef}
            onQueryChange={setMentionQuery}
            onSelectBuiltinCommand={handleSelectBuiltinCommand}
            onSelectServiceSkill={handleSelectServiceSkill}
            onSelectSlashCommand={handleSelectSlashCommand}
            onSelectSceneCommand={handleSelectRuntimeSceneCommand}
            onSelectCharacter={handleSelectCharacter}
            onSelectInstalledSkill={handleSelectInstalledSkill}
            onSelectAvailableSkill={handleSelectAvailableSkill}
            onNavigateToSettings={
              onNavigateToSettings
                ? () => {
                    setShowMentions(false);
                    onNavigateToSettings();
                  }
                : undefined
            }
          />
        </Suspense>
      </div>
    </>,
    document.body,
  );
}
