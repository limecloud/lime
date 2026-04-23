import { describe, expect, it } from "vitest";
import {
  buildPersistedServiceModelPreference,
  hasServiceModelPreferenceOverride,
  normalizeServiceModelPreference,
} from "./serviceModels";

describe("serviceModels", () => {
  it("应归一 service model 偏好", () => {
    expect(
      normalizeServiceModelPreference({
        preferredProviderId: " openai ",
        preferredModelId: " gpt-5.4-mini ",
        enabled: undefined,
        customPrompt: "  请保留资料上下文 ",
      }),
    ).toEqual({
      preferredProviderId: "openai",
      preferredModelId: "gpt-5.4-mini",
      enabled: true,
      customPrompt: "请保留资料上下文",
    });
  });

  it("只有默认值时不应保留覆盖", () => {
    expect(
      hasServiceModelPreferenceOverride({
        enabled: true,
      }),
    ).toBe(false);
    expect(
      buildPersistedServiceModelPreference({
        enabled: true,
      }),
    ).toBeUndefined();
  });

  it("禁用开关或自定义提示词应视为有效覆盖", () => {
    expect(
      buildPersistedServiceModelPreference({
        enabled: false,
      }),
    ).toEqual({
      enabled: false,
      preferredProviderId: undefined,
      preferredModelId: undefined,
      customPrompt: undefined,
    });

    expect(
      buildPersistedServiceModelPreference({
        customPrompt: "请优先复用资料库上下文",
      }),
    ).toEqual({
      enabled: true,
      preferredProviderId: undefined,
      preferredModelId: undefined,
      customPrompt: "请优先复用资料库上下文",
    });
  });

  it("未指定 provider 时应清空 model", () => {
    expect(
      buildPersistedServiceModelPreference({
        preferredModelId: "gpt-5.4-mini",
        enabled: false,
      }),
    ).toEqual({
      enabled: false,
      preferredProviderId: undefined,
      preferredModelId: undefined,
      customPrompt: undefined,
    });
  });
});
