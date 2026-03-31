/**
 * @file 组件渲染器
 * @description 根据组件类型分发到对应的渲染器
 */

import type { A2UIComponent, A2UIFormData, A2UIEvent } from "../types";
import { resolveDynamicValue } from "../parser";

import { AudioPlayerRenderer } from "../catalog/basic/components/AudioPlayer";
import { ButtonRenderer } from "../catalog/basic/components/Button";
import { CardRenderer } from "../catalog/basic/components/Card";
import { CheckBoxRenderer } from "../catalog/basic/components/CheckBox";
import { ChoicePickerRenderer } from "../catalog/basic/components/ChoicePicker";
import { ColumnRenderer } from "../catalog/basic/components/Column";
import { DateTimeInputRenderer } from "../catalog/basic/components/DateTimeInput";
import { DividerRenderer } from "../catalog/basic/components/Divider";
import { IconRenderer } from "../catalog/basic/components/Icon";
import { ImageRenderer } from "../catalog/basic/components/Image";
import { ListRenderer } from "../catalog/basic/components/List";
import { ModalRenderer } from "../catalog/basic/components/Modal";
import { RowRenderer } from "../catalog/basic/components/Row";
import { SliderRenderer } from "../catalog/basic/components/Slider";
import { TabsRenderer } from "../catalog/basic/components/Tabs";
import { TextRenderer } from "../catalog/basic/components/Text";
import { TextFieldRenderer } from "../catalog/basic/components/TextField";
import { VideoRenderer } from "../catalog/basic/components/Video";

export interface ComponentRendererProps {
  component: A2UIComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function ComponentRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: ComponentRendererProps) {
  const isVisible =
    component.visible === undefined
      ? true
      : Boolean(
          resolveDynamicValue(
            component.visible as boolean | { path: string } | undefined,
            data,
            false,
            scopePath,
          ),
        );

  if (!isVisible) {
    return null;
  }

  switch (component.component) {
    case "Row":
      return (
        <RowRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "Column":
      return (
        <ColumnRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "List":
      return (
        <ListRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "Card":
      return (
        <CardRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "Tabs":
      return (
        <TabsRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "Modal":
      return (
        <ModalRenderer
          component={component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "Divider":
      return <DividerRenderer component={component} />;
    case "Text":
      return (
        <TextRenderer component={component} data={data} scopePath={scopePath} />
      );
    case "Image":
      return (
        <ImageRenderer
          component={component}
          data={data}
          scopePath={scopePath}
        />
      );
    case "Icon":
      return (
        <IconRenderer component={component} data={data} scopePath={scopePath} />
      );
    case "Video":
      return (
        <VideoRenderer
          component={component}
          data={data}
          scopePath={scopePath}
        />
      );
    case "AudioPlayer":
      return (
        <AudioPlayerRenderer
          component={component}
          data={data}
          scopePath={scopePath}
        />
      );
    case "Button":
      return (
        <ButtonRenderer
          component={component}
          components={components}
          data={data}
          onAction={onAction}
          scopePath={scopePath}
        />
      );
    case "TextField":
      return (
        <TextFieldRenderer
          component={component}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          scopePath={scopePath}
        />
      );
    case "CheckBox":
      return (
        <CheckBoxRenderer
          component={component}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          scopePath={scopePath}
        />
      );
    case "ChoicePicker":
      return (
        <ChoicePickerRenderer
          component={component}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          scopePath={scopePath}
        />
      );
    case "Slider":
      return (
        <SliderRenderer
          component={component}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          scopePath={scopePath}
        />
      );
    case "DateTimeInput":
      return (
        <DateTimeInputRenderer
          component={component}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          scopePath={scopePath}
        />
      );
    default:
      return (
        <div className="text-yellow-500">
          未知组件: {(component as A2UIComponent).component}
        </div>
      );
  }
}
