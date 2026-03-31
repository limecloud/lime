import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckBoxRenderer } from "./CheckBox";
import { ChoicePickerRenderer } from "./ChoicePicker";
import { DateTimeInputRenderer } from "./DateTimeInput";
import { SliderRenderer } from "./Slider";
import { TextFieldRenderer } from "./TextField";
import {
  cleanupMountedRoots,
  clickButtonByText,
  fillTextInput,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import { A2UI_FORM_TOKENS } from "../../../taskFormTokens";

setupReactActEnvironment();

describe("A2UI 表单控件", () => {
  const mountedRoots: MountedRoot[] = [];
  const data: Record<string, unknown> = {};

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("ChoicePicker 应使用统一样式并回传选项", () => {
    const onFormChange = vi.fn();
    const { container } = mountHarness(
      ChoicePickerRenderer,
      {
        component: {
          id: "start_mode",
          component: "ChoicePicker",
          label: "开始方式",
          options: [
            { value: "new_post", label: "新写一篇内容" },
            { value: "continue_history", label: "继续已有内容" },
          ],
          value: [],
          variant: "mutuallyExclusive",
          layout: "vertical",
        },
        data,
        formData: {},
        onFormChange,
      },
      mountedRoots,
    );

    const optionButton = clickButtonByText(container, "新写一篇内容");
    expect(optionButton?.className).toContain("rounded-[20px]");
    expect(optionButton?.className).toContain("border-slate-200");
    expect(onFormChange).toHaveBeenCalledWith("start_mode", ["new_post"]);
  });

  it("TextField 应使用统一输入样式并同步文本", () => {
    const onFormChange = vi.fn();
    const { container } = mountHarness(
      TextFieldRenderer,
      {
        component: {
          id: "note",
          component: "TextField",
          label: "补充说明",
          value: "",
          placeholder: "请输入补充说明",
        },
        data,
        formData: {},
        onFormChange,
      },
      mountedRoots,
    );

    const input = container.querySelector("input") as HTMLInputElement | null;
    expect(input?.className).toBe(A2UI_FORM_TOKENS.textInput);
    fillTextInput(input, "继续扩写");
    expect(onFormChange).toHaveBeenCalledWith("note", "继续扩写");
  });

  it("CheckBox 应使用统一样式并回传布尔值", () => {
    const onFormChange = vi.fn();
    const { container } = mountHarness(
      CheckBoxRenderer,
      {
        component: {
          id: "agreed",
          component: "CheckBox",
          label: "我已确认",
          value: false,
        },
        data,
        formData: {},
        onFormChange,
      },
      mountedRoots,
    );

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement | null;
    expect(checkbox?.className).toBe(A2UI_FORM_TOKENS.checkboxInput);
    act(() => {
      checkbox?.click();
    });
    expect(onFormChange).toHaveBeenCalledWith("agreed", true);
  });

  it("Slider 应使用统一样式并回传数值", () => {
    const onFormChange = vi.fn();
    const { container } = mountHarness(
      SliderRenderer,
      {
        component: {
          id: "score",
          component: "Slider",
          label: "评分",
          min: 0,
          max: 10,
          value: 3,
          step: 1,
        },
        data,
        formData: {},
        onFormChange,
      },
      mountedRoots,
    );

    const slider = container.querySelector(
      "input[type='range']",
    ) as HTMLInputElement | null;
    expect(slider?.className).toBe(A2UI_FORM_TOKENS.sliderInput);
    act(() => {
      if (!slider) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(slider, "8");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onFormChange).toHaveBeenCalledWith("score", 8);
  });

  it("DateTimeInput 应使用原生日期输入并回传日期值", () => {
    const onFormChange = vi.fn();
    const { container } = mountHarness(
      DateTimeInputRenderer,
      {
        component: {
          id: "due_date",
          component: "DateTimeInput",
          label: "截止日期",
          value: "",
          enableDate: true,
        },
        data,
        formData: {},
        onFormChange,
      },
      mountedRoots,
    );

    const input = container.querySelector(
      "input[type='date']",
    ) as HTMLInputElement | null;
    expect(input?.className).toBe(A2UI_FORM_TOKENS.textInput);
    act(() => {
      if (!input) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "2025-12-20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onFormChange).toHaveBeenCalledWith("due_date", "2025-12-20");
  });
});
