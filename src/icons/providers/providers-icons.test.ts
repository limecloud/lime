/**
 * @file Provider 图标完整性属性测试
 * @description 测试所有 System Provider 都有对应的图标
 * @module icons/providers/providers-icons.test
 *
 * **Feature: provider-ui-refactor, Property 19: Provider 图标完整性**
 * **Validates: Requirements 10.1**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getSystemProviderIds } from "@/lib/config/providers";
import type { SystemProviderId } from "@/lib/types/provider";
import {
  providerTypeToIcon,
  hasProviderIcon,
  getIconName,
  availableIcons,
} from "./utils";
import { iconComponents } from "./index";

describe("Provider 图标系统", () => {
  const resourceProviderIds = fs
    .readdirSync(path.join(process.cwd(), "src-tauri/resources/models/providers"))
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(/\.json$/, ""));

  /**
   * Property 19: Provider 图标完整性
   *
   * *对于任意* System Provider ID，应存在对应的图标资源
   *
   * **Validates: Requirements 10.1**
   */
  describe("Property 19: Provider 图标完整性", () => {
    // 获取所有 System Provider ID
    const systemProviderIds = getSystemProviderIds();

    test.prop([fc.constantFrom(...systemProviderIds)])(
      "每个 System Provider 应有对应的图标映射",
      (providerId: SystemProviderId) => {
        // 验证 Provider ID 在映射表中存在
        const iconName = providerTypeToIcon[providerId];
        expect(iconName).toBeDefined();
        expect(typeof iconName).toBe("string");
        expect(iconName.length).toBeGreaterThan(0);
      },
    );

    test.prop([fc.constantFrom(...systemProviderIds)])(
      "每个 System Provider 的图标名称应在可用图标列表中",
      (providerId: SystemProviderId) => {
        const iconName = getIconName(providerId);
        expect((availableIcons as readonly string[]).includes(iconName)).toBe(
          true,
        );
      },
    );

    test.prop([fc.constantFrom(...systemProviderIds)])(
      "每个 System Provider 应有对应的图标组件",
      (providerId: SystemProviderId) => {
        const iconName = getIconName(providerId);
        const IconComponent = iconComponents[iconName];

        expect(IconComponent).toBeDefined();
        expect(typeof IconComponent).toBe("function");
      },
    );

    test.prop([fc.constantFrom(...systemProviderIds)])(
      "hasProviderIcon 应对所有 System Provider 返回 true",
      (providerId: SystemProviderId) => {
        expect(hasProviderIcon(providerId)).toBe(true);
      },
    );
  });

  describe("模型资源 Provider 图标完整性", () => {
    test.prop([fc.constantFrom(...resourceProviderIds)])(
      "每个模型资源 Provider 应有图标映射",
      (providerId: string) => {
        const iconName = providerTypeToIcon[providerId];

        expect(iconName).toBeDefined();
        expect((availableIcons as readonly string[]).includes(iconName)).toBe(
          true,
        );
      },
    );

    test.prop([fc.constantFrom(...resourceProviderIds)])(
      "每个模型资源 Provider 应命中可渲染图标",
      (providerId: string) => {
        expect(hasProviderIcon(providerId)).toBe(true);
      },
    );
  });

  describe("图标映射一致性", () => {
    test("所有可用图标应有对应的组件", () => {
      for (const iconName of availableIcons) {
        const IconComponent = iconComponents[iconName];
        expect(IconComponent).toBeDefined();
        expect(typeof IconComponent).toBe("function");
      }
    });

    test("图标组件映射应包含所有可用图标", () => {
      const componentKeys = Object.keys(iconComponents);
      for (const iconName of availableIcons) {
        expect(componentKeys).toContain(iconName);
      }
    });

    test("Provider 类型映射的值应都在可用图标列表中", () => {
      const mappedIcons = Object.values(providerTypeToIcon);
      for (const iconName of mappedIcons) {
        expect((availableIcons as readonly string[]).includes(iconName)).toBe(
          true,
        );
      }
    });
  });

  describe("图标数量验证", () => {
    test("可用图标数量应至少为 60", () => {
      expect(availableIcons.length).toBeGreaterThanOrEqual(60);
    });

    test("图标组件数量应与可用图标数量一致", () => {
      const componentCount = Object.keys(iconComponents).length;
      expect(componentCount).toBe(availableIcons.length);
    });

    test("所有 System Provider 都应有图标映射", () => {
      const systemProviderIds = getSystemProviderIds();
      const mappedProviders = Object.keys(providerTypeToIcon);

      for (const providerId of systemProviderIds) {
        expect(mappedProviders).toContain(providerId);
      }
    });
  });
});
