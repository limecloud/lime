/**
 * @file a2ui.ts
 * @description 工作台共享 A2UI 网关，供聊天与工作区外层主链复用
 * @module lib/workspace/a2ui
 */

export type {
  A2UIResponse,
  A2UIComponent,
  A2UIEvent,
  A2UIFormData,
  ParseResult,
  ParsedMessageContent,
  MessageContentType,
  ChildList,
  RowComponent,
  ColumnComponent,
  CardComponent,
  DividerComponent,
  TextComponent,
  IconComponent,
  ImageComponent,
  ButtonComponent,
  TextFieldComponent,
  CheckBoxComponent,
  ChoicePickerComponent,
  SliderComponent,
  DateTimeInputComponent,
  ChoiceOption,
  ButtonAction,
  CheckRule,
  DynamicValue,
  DynamicString,
  DynamicBoolean,
  DynamicNumber,
  DynamicStringList,
} from "@/components/workspace/a2ui/types";

export {
  parseAIResponse,
  parseA2UIJson,
  getComponentById,
  resolveDynamicValue,
  collectFormData,
} from "@/components/workspace/a2ui/parser";

export { A2UIRenderer } from "@/components/workspace/a2ui";

export {
  DEFAULT_A2UI_TASK_CARD_PRESET,
  CHAT_A2UI_TASK_CARD_PRESET,
  CHAT_FLOATING_A2UI_TASK_CARD_PRESET,
  REVIEW_A2UI_TASK_CARD_PRESET,
  TIMELINE_A2UI_TASK_CARD_PRESET,
  WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET,
  type A2UITaskCardPreset,
} from "@/components/workspace/a2ui/taskCardPresets";

export {
  A2UITaskCardShell,
  A2UITaskCardStatusBadge,
  A2UITaskCardHeader,
  A2UITaskCardBody,
  A2UITaskCardLoadingBody,
  type A2UITaskCardSurface,
  type A2UITaskCardShellProps,
  type A2UITaskCardHeaderProps,
  type A2UITaskCardBodyProps,
} from "@/components/workspace/a2ui/taskCardPrimitives";
