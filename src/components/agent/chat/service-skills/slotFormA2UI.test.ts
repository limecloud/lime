import { describe, expect, it } from "vitest";
import {
  buildServiceSkillSlotFieldA2UI,
  buildServiceSkillSlotFormData,
  readServiceSkillSlotValueFromA2UIFormData,
} from "./slotFormA2UI";

describe("slotFormA2UI", () => {
  it("应把平台槽位转换成 ChoicePicker，并保留默认值", () => {
    const component = buildServiceSkillSlotFieldA2UI({
      key: "platform",
      label: "发布平台",
      type: "platform",
      required: true,
      defaultValue: "douyin",
      options: [
        { value: "douyin", label: "抖音" },
        { value: "xiaohongshu", label: "小红书" },
      ],
    });

    expect(component).toMatchObject({
      id: "platform",
      component: "ChoicePicker",
      label: "发布平台",
      value: ["douyin"],
    });
  });

  it("应支持按字段映射构建和读回 A2UI 表单值", () => {
    const formData = buildServiceSkillSlotFormData(
      [
        {
          key: "reference_video",
          label: "参考视频",
          type: "url",
          required: true,
        },
        {
          key: "platform",
          label: "发布平台",
          type: "platform",
          required: true,
          defaultValue: "douyin",
          options: [{ value: "douyin", label: "抖音" }],
        },
      ],
      {
        reference_video: "https://example.com/video",
      },
      {
        fieldIdForKey: (key) => `field:${key}`,
      },
    );

    expect(formData).toEqual({
      "field:reference_video": "https://example.com/video",
      "field:platform": ["douyin"],
    });
    expect(
      readServiceSkillSlotValueFromA2UIFormData(formData, "field:reference_video"),
    ).toBe("https://example.com/video");
    expect(
      readServiceSkillSlotValueFromA2UIFormData(formData, "field:platform"),
    ).toBe("douyin");
  });
});
