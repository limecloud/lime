/**
 * @file TerminalAIInput.tsx
 * @description Terminal AI 输入框组件
 * @module components/terminal/ai/TerminalAIInput
 *
 * 参考 Waveterm 的 AIPanelInput 设计
 */

import React, { useRef } from "react";
import { Send, Square, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { BaseComposer } from "@/components/input-kit";
import { CharacterMention } from "@/components/agent/chat/skill-selection/CharacterMention";
import { SkillBadge } from "@/components/agent/chat/skill-selection/SkillBadge";
import { useActiveSkill } from "@/components/agent/chat/skill-selection/useActiveSkill";
import type { Skill } from "@/lib/api/skills";

interface TerminalAIInputProps {
  /** 输入值 */
  value: string;
  /** 输入变化回调 */
  onChange: (value: string) => void;
  /** 提交回调（可接受 textOverride） */
  onSubmit: (textOverride?: string) => void;
  /** 停止回调 */
  onStop?: () => void;
  /** 是否正在发送 */
  isSending: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 占位符 */
  placeholder?: string;
  /** 技能列表 */
  skills?: Skill[];
}

export const TerminalAIInput: React.FC<TerminalAIInputProps> = ({
  value,
  onChange,
  onSubmit,
  onStop,
  isSending,
  disabled = false,
  placeholder = "Continue...",
  skills = [],
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeSkill, setActiveSkill, wrapTextWithSkill, clearActiveSkill } =
    useActiveSkill();

  const handleSend = () => {
    const text = activeSkill ? wrapTextWithSkill(value) : undefined;
    onSubmit(text);
    clearActiveSkill();
  };

  return (
    <BaseComposer
      text={value}
      setText={onChange}
      onSend={handleSend}
      onStop={onStop}
      isLoading={isSending}
      disabled={disabled}
      placeholder={placeholder}
      textareaRef={textareaRef}
      maxAutoHeight={7 * 24}
      rows={2}
    >
      {({ textareaProps, onPrimaryAction, isPrimaryDisabled }) => (
        <div className="border-t border-zinc-700">
          {/* CharacterMention */}
          {skills.length > 0 && (
            <CharacterMention
              characters={[]}
              skills={skills}
              inputRef={textareaRef}
              value={value}
              onChange={onChange}
              onSelectSkill={setActiveSkill}
            />
          )}
          <div className="relative">
            {/* Skill Badge */}
            {activeSkill && (
              <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
            )}
            <textarea
              ref={textareaRef}
              {...textareaProps}
              className={cn(
                "w-full text-white px-3 py-2 pr-16 focus:outline-none resize-none overflow-auto",
                "bg-zinc-800/50 text-sm",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            />

            {/* 附件按钮 */}
            <button
              type="button"
              className={cn(
                "absolute bottom-6 right-8 w-6 h-6 flex items-center justify-center",
                "text-zinc-400 hover:text-zinc-200 transition-colors",
              )}
              title="附加文件"
            >
              <Paperclip size={14} />
            </button>

            {/* 发送/停止按钮 */}
            <button
              type="button"
              onClick={onPrimaryAction}
              disabled={isPrimaryDisabled}
              className={cn(
                "absolute bottom-1.5 right-2 w-6 h-6 flex items-center justify-center",
                "transition-colors",
                isPrimaryDisabled
                  ? "text-zinc-500 cursor-not-allowed"
                  : isSending
                    ? "text-green-500 hover:text-green-400"
                    : "text-blue-400 hover:text-blue-300",
              )}
              title={isSending ? "停止响应" : "发送消息 (Enter)"}
            >
              {isSending ? <Square size={14} /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}
    </BaseComposer>
  );
};
