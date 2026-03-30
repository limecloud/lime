import styled from "styled-components";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import { CHAT_FLOATING_A2UI_TASK_CARD_PRESET } from "@/lib/workspace/a2ui";
import { A2UITaskCard } from "../../A2UITaskCard";

interface A2UIFloatingFormProps {
  response: A2UIResponse;
  onSubmit: (formData: A2UIFormData) => void;
  submitDisabled?: boolean;
  isStale?: boolean;
}

const STALE_STATUS_LABEL = "同步中";
const STALE_FOOTER_TEXT = "正在同步最新上下文，表单暂时不可提交。";

const Card = styled.div`
  position: relative;
  margin-bottom: 10px;
  max-width: 100%;
  max-height: min(44vh, 420px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--border)) transparent;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 999px;
  }
`;

export function A2UIFloatingForm({
  response,
  onSubmit,
  submitDisabled = false,
  isStale = false,
}: A2UIFloatingFormProps) {
  return (
    <Card>
      <A2UITaskCard
        response={response}
        onSubmit={onSubmit}
        submitDisabled={submitDisabled}
        compact={true}
        preset={CHAT_FLOATING_A2UI_TASK_CARD_PRESET}
        statusLabel={isStale ? STALE_STATUS_LABEL : undefined}
        footerText={isStale ? STALE_FOOTER_TEXT : undefined}
        className="m-0"
      />
    </Card>
  );
}
