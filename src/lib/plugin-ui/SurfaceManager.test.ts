/**
 * @file SurfaceManager 属性测试
 * @description 测试插件 UI Surface 注册一致性
 * @module lib/plugin-ui/SurfaceManager.test
 *
 * **Feature: machine-id-plugin-migration, 属性 1: 插件 UI Surface 注册一致性**
 * **Validates: Requirements 1.2, 3.1**
 */

import { describe, expect } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { SurfaceManager } from "./SurfaceManager";
import type { ServerMessage } from "./types";

describe("SurfaceManager", () => {
  /**
   * 属性 1: 插件 UI Surface 注册一致性
   *
   * *对于任意*已安装的插件，如果其 manifest 包含 UI 配置，
   * 则该插件必须出现在其声明的所有 surfaces 中。
   *
   * **Validates: Requirements 1.2, 3.1**
   */
  describe("属性 1: 插件 UI Surface 注册一致性", () => {
    // 生成有效的标识符（字母数字）
    const identifierArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/);

    test.prop([identifierArb, identifierArb, identifierArb])(
      "注册的 Surface 应该可以通过 pluginId 查询到",
      (pluginId, surfaceId, rootId) => {
        // 每次迭代创建新的 manager
        const manager = new SurfaceManager();

        // 发送 surfaceUpdate 创建 surface
        const updateMessage: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: rootId,
                component: { Text: { text: { literalString: "test" } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId, updateMessage);

        // 发送 beginRendering 标记为就绪
        const beginMessage: ServerMessage = {
          beginRendering: {
            surfaceId,
            root: rootId,
          },
        };
        manager.processMessage(pluginId, beginMessage);

        // 验证 surface 可以通过 pluginId 查询到
        const surfaces = manager.getSurfacesByPlugin(pluginId);
        const found = surfaces.some((s) => s.surfaceId === surfaceId);
        expect(found).toBe(true);
      },
    );

    test.prop([identifierArb, identifierArb, identifierArb])(
      "注册的 Surface 应该可以通过 surfaceId 直接获取",
      (pluginId, surfaceId, rootId) => {
        // 每次迭代创建新的 manager
        const manager = new SurfaceManager();

        // 发送 surfaceUpdate 创建 surface
        const updateMessage: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: rootId,
                component: { Text: { text: { literalString: "test" } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId, updateMessage);

        // 验证 surface 可以直接获取
        const surface = manager.getSurface(surfaceId);
        expect(surface).toBeDefined();
        expect(surface?.pluginId).toBe(pluginId);
        expect(surface?.surfaceId).toBe(surfaceId);
      },
    );

    test.prop([
      identifierArb,
      identifierArb,
      fc.array(
        fc.record({
          id: identifierArb,
          text: fc.string({ minLength: 0, maxLength: 100 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ])("Surface 更新应该正确累积组件", (pluginId, surfaceId, components) => {
      // 每次迭代创建新的 manager
      const manager = new SurfaceManager();

      // 逐个添加组件
      for (const comp of components) {
        const message: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: comp.id,
                component: { Text: { text: { literalString: comp.text } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId, message);
      }

      // 验证所有组件都被注册
      const surface = manager.getSurface(surfaceId);
      expect(surface).toBeDefined();

      for (const comp of components) {
        expect(surface?.components.has(comp.id)).toBe(true);
      }
    });

    test.prop([identifierArb, identifierArb, identifierArb])(
      "删除 Surface 后应该无法查询到",
      (pluginId, surfaceId, rootId) => {
        // 每次迭代创建新的 manager
        const manager = new SurfaceManager();

        // 先注册 surface
        const updateMessage: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: rootId,
                component: { Text: { text: { literalString: "test" } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId, updateMessage);

        // 验证 surface 存在
        expect(manager.getSurface(surfaceId)).toBeDefined();

        // 删除 surface
        const deleteMessage: ServerMessage = {
          deleteSurface: {
            surfaceId,
          },
        };
        manager.processMessage(pluginId, deleteMessage);

        // 验证 surface 已被删除
        expect(manager.getSurface(surfaceId)).toBeUndefined();
      },
    );

    test.prop([identifierArb, fc.integer({ min: 1, max: 5 })])(
      "清理插件时应该删除该插件的所有 Surface",
      (pluginId, surfaceCount) => {
        // 每次迭代创建新的 manager
        const manager = new SurfaceManager();

        const surfaceIds = Array.from(
          { length: surfaceCount },
          (_, i) => `surface-${i}`,
        );

        // 为同一个插件注册多个 surfaces
        for (const surfaceId of surfaceIds) {
          const message: ServerMessage = {
            surfaceUpdate: {
              surfaceId,
              components: [
                {
                  id: "root",
                  component: { Text: { text: { literalString: "test" } } },
                },
              ],
            },
          };
          manager.processMessage(pluginId, message);
        }

        // 验证所有 surfaces 都存在
        for (const surfaceId of surfaceIds) {
          expect(manager.getSurface(surfaceId)).toBeDefined();
        }

        // 清理插件
        manager.clearPlugin(pluginId);

        // 验证所有 surfaces 都被删除
        for (const surfaceId of surfaceIds) {
          expect(manager.getSurface(surfaceId)).toBeUndefined();
        }
      },
    );

    test.prop([
      identifierArb,
      identifierArb,
      fc.uniqueArray(identifierArb, { minLength: 1, maxLength: 3 }),
    ])("多个插件可以注册不同的 Surface", (pluginId1, pluginId2, surfaceIds) => {
      // 假设两个不同的插件
      fc.pre(pluginId1 !== pluginId2);

      // 每次迭代创建新的 manager
      const manager = new SurfaceManager();

      // 为第一个插件注册 surfaces
      for (let i = 0; i < surfaceIds.length; i++) {
        const surfaceId = `${pluginId1}-${surfaceIds[i]}`;
        const message: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: "root",
                component: { Text: { text: { literalString: "test" } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId1, message);
      }

      // 为第二个插件注册 surfaces
      for (let i = 0; i < surfaceIds.length; i++) {
        const surfaceId = `${pluginId2}-${surfaceIds[i]}`;
        const message: ServerMessage = {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: "root",
                component: { Text: { text: { literalString: "test" } } },
              },
            ],
          },
        };
        manager.processMessage(pluginId2, message);
      }

      // 验证每个插件只能查询到自己的 surfaces
      const surfaces1 = manager.getSurfacesByPlugin(pluginId1);
      const surfaces2 = manager.getSurfacesByPlugin(pluginId2);

      expect(surfaces1.length).toBe(surfaceIds.length);
      expect(surfaces2.length).toBe(surfaceIds.length);

      // 验证 surfaces 属于正确的插件
      for (const surface of surfaces1) {
        expect(surface.pluginId).toBe(pluginId1);
      }
      for (const surface of surfaces2) {
        expect(surface.pluginId).toBe(pluginId2);
      }
    });
  });
});
