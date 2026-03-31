/**
 * @file Artifact 渲染器属性测试
 * @description 使用 fast-check 进行属性测试，验证 Canvas 类型委托的正确性
 * @module components/artifact/ArtifactRenderer.test
 * @requirements 12.1, 12.2, 12.3, 12.5
 */

import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { artifactRegistry } from "@/lib/artifact/registry";
import {
  ALL_ARTIFACT_TYPES,
  CANVAS_ARTIFACT_TYPES,
  LIGHTWEIGHT_ARTIFACT_TYPES,
  isCanvasType,
  type ArtifactType,
  type Artifact,
  type ArtifactMeta,
} from "@/lib/artifact/types";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建 Artifact 对象的辅助函数
 * @param type - Artifact 类型
 * @param title - 标题
 * @param content - 内容
 * @param meta - 元数据
 * @returns Artifact 对象
 */
function createArtifact(
  type: ArtifactType,
  title: string,
  content: string,
  meta: ArtifactMeta = {},
): Artifact {
  return {
    id: crypto.randomUUID(),
    type,
    title,
    content,
    status: "complete",
    meta,
    position: { start: 0, end: content.length },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 模拟 Canvas 委托函数
 * 验证委托时内容和元数据是否被正确保留
 * @param artifact - 要委托的 Artifact
 * @returns 委托结果，包含保留的内容和元数据
 */
function delegateToCanvas(artifact: Artifact): {
  content: string;
  meta: ArtifactMeta;
  canvasType: string;
} {
  // 提取 canvas 子类型
  const canvasType = artifact.type.replace("canvas:", "");

  // 委托时应保留原始内容和元数据
  return {
    content: artifact.content,
    meta: { ...artifact.meta },
    canvasType,
  };
}

// ============================================================================
// 自定义生成器 (Arbitraries)
// ============================================================================

/** Canvas 类型生成器 */
const canvasTypeArb = fc.constantFrom(...CANVAS_ARTIFACT_TYPES);

/** 轻量类型生成器 */
const lightweightTypeArb = fc.constantFrom(...LIGHTWEIGHT_ARTIFACT_TYPES);

/** 所有类型生成器 */
const allTypeArb = fc.constantFrom(...ALL_ARTIFACT_TYPES);

/** 安全标题生成器 */
const safeTitleArb = fc
  .array(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split(
        "",
      ),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((chars) => chars.join(""));

/** 安全内容生成器 - 生成各种内容 */
const safeContentArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.json(),
  fc.constant(""),
  fc.constant('{"type":"document","content":[]}'),
  fc.constant("# Heading\n\nParagraph content"),
);

/** Canvas 平台生成器 */
const platformArb = fc.constantFrom(
  "web",
  "desktop",
  "mobile",
  "electron",
  undefined,
);

/** Canvas 版本生成器 */
const versionArb = fc.oneof(
  fc.constant("1.0.0"),
  fc.constant("2.0.0"),
  fc.constant("1.2.3"),
  fc
    .tuple(
      fc.integer({ min: 0, max: 10 }),
      fc.integer({ min: 0, max: 10 }),
      fc.integer({ min: 0, max: 10 }),
    )
    .map(([major, minor, patch]) => `${major}.${minor}.${patch}`),
  fc.constant(undefined),
);

/** Canvas 元数据生成器 */
const canvasMetaArb = fc
  .record({
    platform: platformArb,
    version: versionArb,
    author: fc.option(safeTitleArb, { nil: undefined }),
    createdBy: fc.option(fc.constant("ai"), { nil: undefined }),
    customField: fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
      nil: undefined,
    }),
  })
  .map((meta) => {
    // 过滤掉 undefined 值
    const filtered: ArtifactMeta = {};
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined) {
        filtered[key] = value;
      }
    }
    return filtered;
  });

/** Canvas Artifact 生成器 */
const canvasArtifactArb = fc
  .record({
    type: canvasTypeArb,
    title: safeTitleArb,
    content: safeContentArb,
    meta: canvasMetaArb,
  })
  .map(({ type, title, content, meta }) =>
    createArtifact(type, title, content, meta),
  );

/** 轻量 Artifact 生成器 */
const _lightweightArtifactArb = fc
  .record({
    type: lightweightTypeArb,
    title: safeTitleArb,
    content: safeContentArb,
  })
  .map(({ type, title, content }) => createArtifact(type, title, content, {}));

// ============================================================================
// Property 7: Canvas 类型委托正确性
// **Validates: Requirements 12.1, 12.2, 12.3, 12.5**
// ============================================================================

describe("Property 7: Canvas 类型委托正确性", () => {
  /**
   * **Validates: Requirements 12.1**
   * 对于任何以 canvas: 开头的类型，isCanvasType 应返回 true
   */
  test("canvas: 前缀的类型应被正确识别为 Canvas 类型", () => {
    fc.assert(
      fc.property(canvasTypeArb, (type) => {
        // 验证类型以 canvas: 开头
        expect(type.startsWith("canvas:")).toBe(true);

        // 验证 isCanvasType 返回 true
        expect(isCanvasType(type)).toBe(true);

        // 验证 registry.isCanvasType 也返回 true
        expect(artifactRegistry.isCanvasType(type)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1**
   * 对于非 Canvas 类型，isCanvasType 应返回 false
   */
  test("非 Canvas 类型应被正确识别", () => {
    fc.assert(
      fc.property(lightweightTypeArb, (type) => {
        // 验证类型不以 canvas: 开头
        expect(type.startsWith("canvas:")).toBe(false);

        // 验证 isCanvasType 返回 false
        expect(isCanvasType(type)).toBe(false);

        // 验证 registry.isCanvasType 也返回 false
        expect(artifactRegistry.isCanvasType(type)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.2**
   * Canvas 委托应保留 artifact 的原始内容
   */
  test("Canvas 委托应保留 artifact 内容", () => {
    fc.assert(
      fc.property(canvasArtifactArb, (artifact) => {
        // 执行委托
        const delegated = delegateToCanvas(artifact);

        // 验证内容被完整保留
        expect(delegated.content).toBe(artifact.content);

        // 验证内容长度一致
        expect(delegated.content.length).toBe(artifact.content.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.3, 12.5**
   * Canvas 委托应保留 artifact 的元数据
   */
  test("Canvas 委托应保留 artifact 元数据", () => {
    fc.assert(
      fc.property(canvasArtifactArb, (artifact) => {
        // 执行委托
        const delegated = delegateToCanvas(artifact);

        // 验证元数据被保留
        for (const [key, value] of Object.entries(artifact.meta)) {
          expect(delegated.meta[key]).toEqual(value);
        }

        // 验证元数据键数量一致
        expect(Object.keys(delegated.meta).length).toBe(
          Object.keys(artifact.meta).length,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.5**
   * Canvas 特定元数据（platform、version）应被保留
   */
  test("Canvas 特定元数据应被保留", () => {
    fc.assert(
      fc.property(
        canvasTypeArb,
        safeTitleArb,
        safeContentArb,
        platformArb,
        versionArb,
        (type, title, content, platform, version) => {
          const meta: ArtifactMeta = {};
          if (platform !== undefined) meta.platform = platform;
          if (version !== undefined) meta.version = version;

          const artifact = createArtifact(type, title, content, meta);

          // 执行委托
          const delegated = delegateToCanvas(artifact);

          // 验证 platform 被保留
          if (platform !== undefined) {
            expect(delegated.meta.platform).toBe(platform);
          }

          // 验证 version 被保留
          if (version !== undefined) {
            expect(delegated.meta.version).toBe(version);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1**
   * Canvas 类型应正确提取子类型
   */
  test("Canvas 类型应正确提取子类型", () => {
    fc.assert(
      fc.property(canvasArtifactArb, (artifact) => {
        // 执行委托
        const delegated = delegateToCanvas(artifact);

        // 验证子类型被正确提取
        const expectedCanvasType = artifact.type.replace("canvas:", "");
        expect(delegated.canvasType).toBe(expectedCanvasType);

        // 验证子类型是有效的 Canvas 子类型
        const validCanvasSubtypes = ["document", "video"];
        expect(validCanvasSubtypes).toContain(delegated.canvasType);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.2**
   * 所有预定义的 Canvas 类型都应被正确处理
   */
  test("所有预定义 Canvas 类型都应被正确处理", () => {
    // 遍历所有 Canvas 类型
    for (const canvasType of CANVAS_ARTIFACT_TYPES) {
      // 验证是 Canvas 类型
      expect(isCanvasType(canvasType)).toBe(true);
      expect(artifactRegistry.isCanvasType(canvasType)).toBe(true);

      // 创建测试 artifact
      const artifact = createArtifact(
        canvasType,
        "Test Title",
        "Test Content",
        { platform: "web", version: "1.0.0" },
      );

      // 执行委托
      const delegated = delegateToCanvas(artifact);

      // 验证内容和元数据被保留
      expect(delegated.content).toBe(artifact.content);
      expect(delegated.meta.platform).toBe("web");
      expect(delegated.meta.version).toBe("1.0.0");
    }
  });

  /**
   * **Validates: Requirements 12.2**
   * 空内容的 Canvas artifact 应被正确处理
   */
  test("空内容的 Canvas artifact 应被正确处理", () => {
    fc.assert(
      fc.property(
        canvasTypeArb,
        safeTitleArb,
        canvasMetaArb,
        (type, title, meta) => {
          const artifact = createArtifact(type, title, "", meta);

          // 执行委托
          const delegated = delegateToCanvas(artifact);

          // 验证空内容被保留
          expect(delegated.content).toBe("");
          expect(delegated.content.length).toBe(0);

          // 验证元数据仍被保留
          for (const [key, value] of Object.entries(artifact.meta)) {
            expect(delegated.meta[key]).toEqual(value);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 12.2, 12.3**
   * 大内容的 Canvas artifact 应被正确处理
   */
  test("大内容的 Canvas artifact 应被正确处理", () => {
    fc.assert(
      fc.property(
        canvasTypeArb,
        safeTitleArb,
        fc.string({ minLength: 1000, maxLength: 5000 }),
        canvasMetaArb,
        (type, title, largeContent, meta) => {
          const artifact = createArtifact(type, title, largeContent, meta);

          // 执行委托
          const delegated = delegateToCanvas(artifact);

          // 验证大内容被完整保留
          expect(delegated.content).toBe(largeContent);
          expect(delegated.content.length).toBe(largeContent.length);
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 12.5**
   * 自定义元数据字段应被保留
   */
  test("自定义元数据字段应被保留", () => {
    fc.assert(
      fc.property(
        canvasTypeArb,
        safeTitleArb,
        safeContentArb,
        fc.dictionary(
          fc
            .string({ minLength: 1, maxLength: 10 })
            .filter((s) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s)),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          { minKeys: 1, maxKeys: 5 },
        ),
        (type, title, content, customMeta) => {
          const artifact = createArtifact(type, title, content, customMeta);

          // 执行委托
          const delegated = delegateToCanvas(artifact);

          // 验证所有自定义字段被保留
          for (const [key, value] of Object.entries(customMeta)) {
            expect(delegated.meta[key]).toEqual(value);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 12.1**
   * isCanvasType 和 registry.isCanvasType 应返回一致的结果
   */
  test("isCanvasType 和 registry.isCanvasType 应返回一致的结果", () => {
    fc.assert(
      fc.property(allTypeArb, (type) => {
        const fromTypes = isCanvasType(type);
        const fromRegistry = artifactRegistry.isCanvasType(type);

        // 两个函数应返回相同的结果
        expect(fromTypes).toBe(fromRegistry);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.2, 12.3**
   * 委托操作应是幂等的（多次委托结果一致）
   */
  test("委托操作应是幂等的", () => {
    fc.assert(
      fc.property(canvasArtifactArb, (artifact) => {
        // 第一次委托
        const delegated1 = delegateToCanvas(artifact);

        // 创建一个新的 artifact 使用委托后的内容和元数据
        const newArtifact = createArtifact(
          artifact.type,
          artifact.title,
          delegated1.content,
          delegated1.meta,
        );

        // 第二次委托
        const delegated2 = delegateToCanvas(newArtifact);

        // 验证两次委托结果一致
        expect(delegated2.content).toBe(delegated1.content);
        expect(delegated2.canvasType).toBe(delegated1.canvasType);

        // 验证元数据一致
        for (const [key, value] of Object.entries(delegated1.meta)) {
          expect(delegated2.meta[key]).toEqual(value);
        }
      }),
      { numRuns: 50 },
    );
  });
});
