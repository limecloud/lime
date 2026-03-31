/**
 * @file A2UI 组件渲染器
 * @description 渲染 A2UI JSON 为 React 组件，支持表单数据持久化
 * @module components/workspace/a2ui/components
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { A2UIResponse, A2UIEvent, A2UIFormData } from "../types";
import { getComponentById, resolveDynamicValue } from "../parser";
import { A2UI_RENDERER_TOKENS } from "../rendererTokens";
import { cn } from "@/lib/utils";
import { ComponentRenderer } from "./ComponentRenderer";

// ============================================================
// 渲染器 Props
// ============================================================

interface A2UIRendererProps {
  response: A2UIResponse;
  onEvent?: (event: A2UIEvent) => void;
  onSubmit?: (formData: A2UIFormData) => void;
  onFormStateChange?: (formData: A2UIFormData) => void;
  className?: string;
  /** 表单 ID（用于持久化） */
  formId?: string;
  /** 初始表单数据（从数据库加载） */
  initialFormData?: A2UIFormData;
  /** 表单数据变化回调（用于持久化） */
  onFormChange?: (formId: string, formData: A2UIFormData) => void;
  submitDisabled?: boolean;
  submitButtonClassName?: string;
}

// ============================================================
// 主渲染器
// ============================================================

export function A2UIRenderer({
  response,
  onEvent,
  onSubmit,
  onFormStateChange,
  className,
  formId,
  initialFormData,
  onFormChange,
  submitDisabled = false,
  submitButtonClassName,
}: A2UIRendererProps) {
  // 防抖定时器引用
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formData, setFormData] = useState<A2UIFormData>(() => {
    // 优先使用从数据库加载的初始数据
    if (initialFormData && Object.keys(initialFormData).length > 0) {
      return initialFormData;
    }
    // 否则从组件定义中初始化
    const initial: A2UIFormData = {};
    for (const comp of response.components) {
      if ("value" in comp) {
        const value = resolveDynamicValue(
          (comp as { value?: unknown }).value,
          response.data || {},
          undefined,
        );
        if (value !== undefined) {
          initial[comp.id] = value;
        }
      }
    }
    return initial;
  });

  // 当 initialFormData 变化时更新表单数据
  useEffect(() => {
    if (initialFormData && Object.keys(initialFormData).length > 0) {
      setFormData(initialFormData);
    }
  }, [initialFormData]);

  useEffect(() => {
    onFormStateChange?.(formData);
  }, [formData, onFormStateChange]);

  const handleFormChange = useCallback(
    (id: string, value: unknown) => {
      let nextFormData: A2UIFormData | null = null;
      setFormData((prev) => {
        const newData = { ...prev, [id]: value };
        nextFormData = newData;

        // 防抖保存到数据库
        if (formId && onFormChange) {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          debounceTimerRef.current = setTimeout(() => {
            onFormChange(formId, newData);
          }, 500);
        }

        return newData;
      });
      onEvent?.({
        type: "change",
        componentId: id,
        value,
        formData: nextFormData || formData,
      });
    },
    [formData, formId, onFormChange, onEvent],
  );

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleAction = useCallback(
    (event: A2UIEvent) => {
      if (event.action?.name === "submit") {
        onSubmit?.(formData);
        onEvent?.({ ...event, formData });
      } else {
        onEvent?.(event);
      }
    },
    [formData, onEvent, onSubmit],
  );

  const handleSubmit = useCallback(() => {
    if (submitDisabled) {
      return;
    }
    onSubmit?.(formData);
    onEvent?.({
      type: "submit",
      componentId: "form",
      formData,
    });
  }, [formData, onEvent, onSubmit, submitDisabled]);

  const rootComponent = useMemo(
    () => getComponentById(response.components, response.root),
    [response.components, response.root],
  );
  const renderData = useMemo(
    () => ({
      ...(response.data || {}),
      formData,
    }),
    [formData, response.data],
  );

  if (!rootComponent) {
    return (
      <div className={A2UI_RENDERER_TOKENS.errorText}>
        错误：找不到根组件 {response.root}
      </div>
    );
  }

  return (
    <div className={cn(A2UI_RENDERER_TOKENS.container, className)}>
      {/* 思考过程 */}
      {response.thinking && (
        <div className={A2UI_RENDERER_TOKENS.thinkingText}>
          {response.thinking}
        </div>
      )}

      {/* 组件树 */}
      <ComponentRenderer
        component={rootComponent}
        components={response.components}
        data={renderData}
        formData={formData}
        onFormChange={handleFormChange}
        onAction={handleAction}
      />

      {/* 提交按钮 */}
      {response.submitAction && (
        <div className={A2UI_RENDERER_TOKENS.submitRow}>
          <button
            onClick={handleSubmit}
            disabled={submitDisabled}
            className={cn(
              A2UI_RENDERER_TOKENS.submitButton,
              submitButtonClassName,
            )}
          >
            {response.submitAction.label}
          </button>
        </div>
      )}
    </div>
  );
}

// 导出组件渲染器供外部使用
export { ComponentRenderer } from "./ComponentRenderer";

// 导出布局组件
export { RowRenderer } from "../catalog/basic/components/Row";
export { ColumnRenderer } from "../catalog/basic/components/Column";
export { ListRenderer } from "../catalog/basic/components/List";
export { TabsRenderer } from "../catalog/basic/components/Tabs";
export { ModalRenderer } from "../catalog/basic/components/Modal";
export { CardRenderer } from "../catalog/basic/components/Card";
export { DividerRenderer } from "../catalog/basic/components/Divider";

// 导出展示组件
export { TextRenderer } from "../catalog/basic/components/Text";
export { ImageRenderer } from "../catalog/basic/components/Image";
export { IconRenderer } from "../catalog/basic/components/Icon";
export { VideoRenderer } from "../catalog/basic/components/Video";
export { AudioPlayerRenderer } from "../catalog/basic/components/AudioPlayer";
export { ButtonRenderer } from "../catalog/basic/components/Button";

// 导出表单组件
export { TextFieldRenderer } from "../catalog/basic/components/TextField";
export { CheckBoxRenderer } from "../catalog/basic/components/CheckBox";
export { ChoicePickerRenderer } from "../catalog/basic/components/ChoicePicker";
export { SliderRenderer } from "../catalog/basic/components/Slider";
export { DateTimeInputRenderer } from "../catalog/basic/components/DateTimeInput";

export default A2UIRenderer;
