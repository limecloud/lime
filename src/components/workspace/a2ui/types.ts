/**
 * @file A2UI 类型定义
 * @description Agent-to-User Interface 组件类型，基于 Google A2UI v0.10 规范
 * @module components/workspace/a2ui/types
 * @see https://a2ui.org/specification/v0_10/
 */

// ============================================================
// 基础类型
// ============================================================

/** 数据绑定 - 引用数据模型中的值 */
export interface DataBinding {
  path: string;
}

/** 函数调用 */
export interface FunctionCall {
  call: string;
  args?: Record<string, unknown>;
  returnType?: "string" | "number" | "boolean" | "array" | "object" | "void";
}

/** 动态值 - 可以是字面量、数据绑定或函数调用 */
export type DynamicValue<T> = T | DataBinding | FunctionCall;

/** 动态字符串 */
export type DynamicString = DynamicValue<string>;

/** 动态布尔值 */
export type DynamicBoolean = DynamicValue<boolean>;

/** 动态数字 */
export type DynamicNumber = DynamicValue<number>;

/** 动态字符串数组 */
export type DynamicStringList = DynamicValue<string[]>;

/** 检查是否为数据绑定 */
export function isDataBinding(value: unknown): value is DataBinding {
  return typeof value === "object" && value !== null && "path" in value;
}

/** 检查是否为函数调用 */
export function isFunctionCall(value: unknown): value is FunctionCall {
  return typeof value === "object" && value !== null && "call" in value;
}

// ============================================================
// 组件基础
// ============================================================

/** 无障碍属性 */
export interface AccessibilityAttributes {
  /** 无障碍标签 */
  label?: DynamicString;
  /** 无障碍描述 */
  description?: DynamicString;
}

/** 组件通用属性 */
export interface ComponentCommon {
  /** 组件唯一 ID */
  id: string;
  /** 无障碍属性 */
  accessibility?: AccessibilityAttributes;
  /** 布局权重（仅在 Row/Column 子组件中有效） */
  weight?: number;
  /** 是否可见（扩展属性） */
  visible?: DynamicBoolean;
  /** 是否禁用（扩展属性） */
  disabled?: DynamicBoolean;
}

/** 验证规则 */
export interface CheckRule {
  /** 验证条件（必须返回布尔值） */
  condition: DynamicBoolean;
  /** 验证失败时的错误消息 */
  message: string;
}

/** 可检查组件（表单组件） */
export interface Checkable {
  /** 验证规则列表 */
  checks?: CheckRule[];
}

/** 子组件模板（用于动态列表） */
export interface ChildTemplate {
  componentId: string;
  path: string;
}

/** 子组件列表 - 静态数组或动态模板 */
export type ChildList = string[] | ChildTemplate;

// ============================================================
// 布局组件
// ============================================================

/** 行布局 */
export interface RowComponent extends ComponentCommon {
  component: "Row";
  children: ChildList;
  wrap?: boolean;
  minChildWidth?: number;
  justify?:
    | "start"
    | "center"
    | "end"
    | "spaceBetween"
    | "spaceAround"
    | "spaceEvenly"
    | "stretch";
  align?: "start" | "center" | "end" | "stretch";
  gap?: number;
}

/** 列布局 */
export interface ColumnComponent extends ComponentCommon {
  component: "Column";
  children: ChildList;
  justify?:
    | "start"
    | "center"
    | "end"
    | "spaceBetween"
    | "spaceAround"
    | "spaceEvenly"
    | "stretch";
  align?: "start" | "center" | "end" | "stretch";
  gap?: number;
}

/** 列表组件 */
export interface ListComponent extends ComponentCommon {
  component: "List";
  children: ChildList;
  direction?: "vertical" | "horizontal";
  align?: "start" | "center" | "end" | "stretch";
}

/** 卡片 */
export interface CardComponent extends ComponentCommon {
  component: "Card";
  child: string;
  variant?: "elevated" | "outlined" | "filled";
}

/** 标签页项 */
export interface TabItem {
  title: DynamicString;
  child: string;
}

/** 标签页组件 */
export interface TabsComponent extends ComponentCommon {
  component: "Tabs";
  tabs: TabItem[];
}

/** 模态框组件 */
export interface ModalComponent extends ComponentCommon {
  component: "Modal";
  trigger: string;
  content: string;
}

/** 分隔线 */
export interface DividerComponent extends ComponentCommon {
  component: "Divider";
  axis?: "horizontal" | "vertical";
}

// ============================================================
// 展示组件
// ============================================================

/** 文本 */
export interface TextComponent extends ComponentCommon {
  component: "Text";
  text: DynamicString;
  variant?: "h1" | "h2" | "h3" | "h4" | "h5" | "body" | "caption";
}

/** 预定义图标名称 */
export type PresetIconName =
  | "accountCircle"
  | "add"
  | "arrowBack"
  | "arrowForward"
  | "attachFile"
  | "calendarToday"
  | "call"
  | "camera"
  | "check"
  | "close"
  | "delete"
  | "download"
  | "edit"
  | "event"
  | "error"
  | "fastForward"
  | "favorite"
  | "favoriteOff"
  | "folder"
  | "help"
  | "home"
  | "info"
  | "locationOn"
  | "lock"
  | "lockOpen"
  | "mail"
  | "menu"
  | "moreVert"
  | "moreHoriz"
  | "notificationsOff"
  | "notifications"
  | "pause"
  | "payment"
  | "person"
  | "phone"
  | "photo"
  | "play"
  | "print"
  | "refresh"
  | "rewind"
  | "search"
  | "send"
  | "settings"
  | "share"
  | "shoppingCart"
  | "skipNext"
  | "skipPrevious"
  | "star"
  | "starHalf"
  | "starOff"
  | "stop"
  | "upload"
  | "visibility"
  | "visibilityOff"
  | "volumeDown"
  | "volumeMute"
  | "volumeOff"
  | "volumeUp"
  | "warning";

/** 图标名称 - 预定义或自定义 SVG 路径 */
export type IconName = PresetIconName | { path: string };

/** 图标 */
export interface IconComponent extends ComponentCommon {
  component: "Icon";
  name: DynamicString | IconName;
}

/** 图片 */
export interface ImageComponent extends ComponentCommon {
  component: "Image";
  url: DynamicString;
  fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  variant?:
    | "icon"
    | "avatar"
    | "smallFeature"
    | "mediumFeature"
    | "largeFeature"
    | "header";
}

/** 视频 */
export interface VideoComponent extends ComponentCommon {
  component: "Video";
  url: DynamicString;
}

/** 音频播放器 */
export interface AudioPlayerComponent extends ComponentCommon {
  component: "AudioPlayer";
  url: DynamicString;
  description?: DynamicString;
}

// ============================================================
// 交互组件
// ============================================================

/** 事件定义 */
export interface EventDefinition {
  name: string;
  context?: Record<string, DynamicValue<unknown>>;
}

/** 事件动作 */
export interface EventAction {
  event: EventDefinition;
}

/** 函数动作 */
export interface FunctionAction {
  functionCall: FunctionCall;
}

/** 动作 - 服务端事件或客户端函数 */
export type Action = EventAction | FunctionAction;

/** 按钮动作（兼容旧格式） */
export interface ButtonAction {
  name: string;
  context?: Record<string, DynamicValue<unknown>>;
}

/** 按钮 */
export interface ButtonComponent extends ComponentCommon, Checkable {
  component: "Button";
  child: string;
  action: Action | ButtonAction;
  variant?: "primary" | "borderless";
}

/** 文本输入框 */
export interface TextFieldComponent extends ComponentCommon, Checkable {
  component: "TextField";
  label: DynamicString;
  value?: DynamicString;
  variant?: "shortText" | "longText" | "number" | "obscured";
  /** 扩展：占位符文本 */
  placeholder?: string;
  /** 扩展：帮助文本 */
  helperText?: string;
}

/** 复选框 */
export interface CheckBoxComponent extends ComponentCommon, Checkable {
  component: "CheckBox";
  label: DynamicString;
  value: DynamicBoolean;
}

/** 选项 */
export interface ChoiceOption {
  label: DynamicString;
  value: string;
  /** 扩展：选项描述 */
  description?: string;
  /** 扩展：选项图标 */
  icon?: string;
}

/** 选择器 */
export interface ChoicePickerComponent extends ComponentCommon, Checkable {
  component: "ChoicePicker";
  label?: DynamicString;
  options: ChoiceOption[];
  value: DynamicStringList;
  variant?: "mutuallyExclusive" | "multipleSelection";
  /** 扩展：布局方式 */
  layout?: "vertical" | "horizontal" | "wrap";
}

/** 滑块 */
export interface SliderComponent extends ComponentCommon, Checkable {
  component: "Slider";
  label?: DynamicString;
  min: number;
  max: number;
  value: DynamicNumber;
  /** 扩展：步长 */
  step?: number;
  /** 扩展：是否显示当前值 */
  showValue?: boolean;
  /** 扩展：刻度标记 */
  marks?: { value: number; label: string }[];
}

/** 日期时间输入 */
export interface DateTimeInputComponent extends ComponentCommon, Checkable {
  component: "DateTimeInput";
  label?: DynamicString;
  value: DynamicString;
  enableDate?: boolean;
  enableTime?: boolean;
  min?: DynamicString;
  max?: DynamicString;
}

// ============================================================
// 组件联合类型
// ============================================================

/** 所有组件类型 */
export type A2UIComponent =
  // 布局组件
  | RowComponent
  | ColumnComponent
  | ListComponent
  | CardComponent
  | TabsComponent
  | ModalComponent
  | DividerComponent
  // 展示组件
  | TextComponent
  | IconComponent
  | ImageComponent
  | VideoComponent
  | AudioPlayerComponent
  // 交互组件
  | ButtonComponent
  | TextFieldComponent
  | CheckBoxComponent
  | ChoicePickerComponent
  | SliderComponent
  | DateTimeInputComponent;

/** 组件类型名称 */
export type A2UIComponentType = A2UIComponent["component"];

// ============================================================
// A2UI 协议消息
// ============================================================

/** 标准组件目录 ID */
export const STANDARD_CATALOG_ID =
  "https://a2ui.org/specification/v0_10/standard_catalog.json";

/** 主题配置 */
export interface Theme {
  primaryColor?: string;
  iconUrl?: string;
  agentDisplayName?: string;
}

/** 创建 Surface 消息 */
export interface CreateSurface {
  surfaceId: string;
  catalogId: string;
  theme?: Theme;
  sendDataModel?: boolean;
}

/** 更新组件消息 */
export interface UpdateComponents {
  surfaceId: string;
  components: A2UIComponent[];
}

/** 更新数据模型消息 */
export interface UpdateDataModel {
  surfaceId: string;
  path?: string;
  value?: unknown;
}

/** 删除 Surface 消息 */
export interface DeleteSurface {
  surfaceId: string;
}

/** 服务端消息类型 */
export type ServerMessageContent =
  | { createSurface: CreateSurface }
  | { updateComponents: UpdateComponents }
  | { updateDataModel: UpdateDataModel }
  | { deleteSurface: DeleteSurface };

/** 兼容 v0.8 的 beginRendering */
export interface BeginRendering {
  surfaceId: string;
  root: string;
  catalogId?: string;
}

/** 兼容 v0.8 的 surfaceUpdate */
export interface SurfaceUpdate {
  surfaceId: string;
  components: unknown[];
}

/** 兼容 v0.8 的 dataModelUpdate */
export interface DataModelUpdate {
  surfaceId: string;
  path?: string;
  contents: unknown[];
}

/** 当前消息信封（与 aster-rust flatten 对齐） */
export type ServerMessage =
  | ({ version: string } & { createSurface: CreateSurface })
  | ({ version: string } & { updateComponents: UpdateComponents })
  | ({ version: string } & { updateDataModel: UpdateDataModel })
  | ({ version: string } & { deleteSurface: DeleteSurface })
  | { beginRendering: BeginRendering }
  | { surfaceUpdate: SurfaceUpdate }
  | { dataModelUpdate: DataModelUpdate }
  | { deleteSurface: DeleteSurface };

// ============================================================
// A2UI 响应格式（简化版，兼容现有实现）
// ============================================================

/** A2UI 响应 */
export interface A2UIResponse {
  /** 响应 ID */
  id: string;
  /** 组件列表（扁平结构，通过 ID 引用） */
  components: A2UIComponent[];
  /** 数据模型 */
  data?: Record<string, unknown>;
  /** 根组件 ID */
  root: string;
  /** 思考过程（可选，用于显示 AI 的推理） */
  thinking?: string;
  /** 提交动作配置 */
  submitAction?: {
    label: string;
    action: ButtonAction;
  };
}

/** A2UI 表单数据 */
export interface A2UIFormData {
  [key: string]: unknown;
}

/** A2UI 事件 */
export interface A2UIEvent {
  type: "action" | "change" | "submit";
  componentId: string;
  action?: ButtonAction;
  value?: unknown;
  formData?: A2UIFormData;
}

// ============================================================
// 解析结果
// ============================================================

/** 消息内容类型 */
export type MessageContentType =
  | "text"
  | "a2ui"
  | "document"
  | "write_file"
  | "pending_a2ui"
  | "pending_write_file";

/** 解析后的消息内容 */
export interface ParsedMessageContent {
  type: MessageContentType;
  content: string | A2UIResponse;
  /** 文件路径（仅 write_file 和 pending_write_file 类型） */
  filePath?: string;
}

/** 解析结果 */
export interface ParseResult {
  parts: ParsedMessageContent[];
  hasA2UI: boolean;
  hasWriteFile?: boolean;
  hasPending?: boolean;
}

// ============================================================
// 客户端到服务端消息
// ============================================================

/** 动作消息 */
export interface ActionMessage {
  /** 事件名称 */
  name: string;
  /** Surface ID */
  surfaceId: string;
  /** 触发事件的组件 ID */
  sourceComponentId: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 事件上下文 */
  context: Record<string, unknown>;
}

/** 错误代码 */
export type ErrorCode = "VALIDATION_FAILED" | string;

/** 错误消息 */
export interface ErrorMessage {
  /** 错误代码 */
  code: ErrorCode;
  /** Surface ID */
  surfaceId: string;
  /** 错误消息 */
  message: string;
  /** JSON Pointer 路径（仅 VALIDATION_FAILED） */
  path?: string;
}

/** 客户端消息类型 */
export type ClientMessageContent =
  | { action: ActionMessage }
  | { error: ErrorMessage };

/** 客户端消息 */
export interface ClientMessage {
  version: string;
  content: ClientMessageContent;
}

// ============================================================
// 客户端能力和数据模型（Transport metadata）
// ============================================================

/** 函数定义 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  returnType:
    | "string"
    | "number"
    | "boolean"
    | "array"
    | "object"
    | "any"
    | "void";
}

/** 目录定义 */
export interface Catalog {
  catalogId: string;
  components?: Record<string, unknown>;
  functions?: FunctionDefinition[];
  theme?: Record<string, unknown>;
}

/** 客户端能力声明 */
export interface ClientCapabilities {
  "v0.10": {
    supportedCatalogIds: string[];
    inlineCatalogs?: Catalog[];
  };
}

/** 客户端数据模型 */
export interface ClientDataModel {
  version: string;
  surfaces: Record<string, unknown>;
}

// ============================================================
// 工具函数
// ============================================================

/** 创建动作消息 */
export function createActionMessage(
  surfaceId: string,
  name: string,
  sourceComponentId: string,
  context: Record<string, unknown> = {},
): ClientMessage {
  return {
    version: "v0.10",
    content: {
      action: {
        name,
        surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      },
    },
  };
}

/** 创建验证错误消息 */
export function createValidationError(
  surfaceId: string,
  path: string,
  message: string,
): ClientMessage {
  return {
    version: "v0.10",
    content: {
      error: {
        code: "VALIDATION_FAILED",
        surfaceId,
        path,
        message,
      },
    },
  };
}

/** 解析动态值 */
export function resolveDynamicValue<T>(
  value: DynamicValue<T>,
  dataModel: Record<string, unknown>,
): T | undefined {
  if (isDataBinding(value)) {
    return getValueByPath(dataModel, value.path) as T | undefined;
  }
  if (isFunctionCall(value)) {
    // 函数调用需要客户端实现
    return undefined;
  }
  return value as T;
}

/** 根据 JSON Pointer 路径获取值 */
export function getValueByPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (!path || path === "/") return obj;

  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const parts = normalizedPath.split("/");

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 根据 JSON Pointer 路径设置值 */
export function setValueByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  if (!path || path === "/") {
    Object.assign(obj, value);
    return;
  }

  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const parts = normalizedPath.split("/");

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
