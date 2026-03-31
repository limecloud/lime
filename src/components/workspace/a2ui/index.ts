/**
 * @file A2UI 模块导出
 * @description Agent-to-User Interface 组件系统
 * @module components/workspace/a2ui
 */

// 类型导出
export type {
  A2UIResponse,
  A2UIComponent,
  A2UIEvent,
  A2UIFormData,
  ParseResult,
  ParsedMessageContent,
  MessageContentType,
  // 组件类型
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
  // 其他类型
  ChoiceOption,
  ButtonAction,
  CheckRule,
  DynamicValue,
  DynamicString,
  DynamicBoolean,
  DynamicNumber,
  DynamicStringList,
} from "./types";

// 解析器导出
export {
  parseAIResponse,
  parseA2UIJson,
  getComponentById,
  resolveDynamicValue,
  collectFormData,
} from "./parser";

// 组件导出
export { A2UIRenderer, default as A2UIRendererDefault } from "./components";
export * from "./catalog";
export { basicCatalog, basicCatalogId } from "./catalog/basic";
export { minimalCatalog, minimalCatalogId } from "./catalog/minimal";
