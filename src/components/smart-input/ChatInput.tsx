/**
 * @file ChatInput.tsx
 * @description 聊天输入框组件，支持文本输入和发送
 * @module components/smart-input/ChatInput
 */

import React, { useRef } from "react";
import { BaseComposer } from "@/components/input-kit";
import { CharacterMention } from "@/components/agent/chat/skill-selection/CharacterMention";
import { SkillBadge } from "@/components/agent/chat/skill-selection/SkillBadge";
import { useActiveSkill } from "@/components/agent/chat/skill-selection/useActiveSkill";
import type { ChatInputProps } from "./types";

/**
 * 聊天输入框组件
 *
 * 提供文本输入框和发送按钮，支持 Enter 键发送
 *
 * 需求:
 * - 4.3: 悬浮窗口应提供文本输入框供用户输入问题
 * - 4.4: 当用户按下 Enter 或点击发送时，悬浮窗口应将图片和文本发送给 AI
 */
export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  disabled = false,
  isLoading = false,
  placeholder = "输入问题...",
  skills = [],
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeSkill, setActiveSkill, wrapTextWithSkill, clearActiveSkill } =
    useActiveSkill();

  const handleSend = () => {
    const text = activeSkill ? wrapTextWithSkill(value) : undefined;
    onSend(text);
    clearActiveSkill();
  };

  return (
    <BaseComposer
      text={value}
      setText={onChange}
      onSend={handleSend}
      disabled={disabled || isLoading}
      placeholder={placeholder}
      textareaRef={textareaRef}
      autoFocus
      maxAutoHeight={80}
      rows={1}
    >
      {({ textareaProps, onPrimaryAction, isPrimaryDisabled }) => (
        <div className="smart-input-input-area">
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
          {/* Skill Badge */}
          {activeSkill && (
            <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
          )}
          <textarea
            ref={textareaRef}
            {...textareaProps}
            className="smart-input-input resize-none"
          />
          <button
            className="smart-input-send-btn"
            onClick={onPrimaryAction}
            disabled={isPrimaryDisabled}
            title="发送 (Enter)"
          >
            {isLoading ? (
              <span
                className="smart-input-loading-spinner"
                style={{ width: 16, height: 16 }}
              />
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      )}
    </BaseComposer>
  );
};

export default ChatInput;
