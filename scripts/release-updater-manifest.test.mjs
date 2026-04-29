import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { planR2ReleaseCleanup } from "./plan-r2-release-cleanup.mjs";
import { prepareGitHubReleaseAssets } from "./prepare-github-release-assets.mjs";
import {
  collectUpdaterManifest,
  writeOutputs,
} from "./release-updater-manifest.mjs";

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeFile(filePath, content = "asset") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("release updater manifest", () => {
  it("聚合平台 latest.json 并改写为 R2 自域名 URL", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lime-release-"));
    const assetsDir = path.join(root, "release-assets");

    writeFile(path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"));
    writeFile(
      path.join(assetsDir, "x86_64-apple-darwin", "Lime-x64.app.tar.gz"),
    );
    writeFile(path.join(assetsDir, "x86_64-pc-windows-msvc", "Lime.nsis.zip"));

    writeJson(path.join(assetsDir, "aarch64-apple-darwin", "latest.json"), {
      version: "1.20.0",
      notes: "notes",
      pub_date: "2026-04-28T00:00:00Z",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-arm",
          url: "https://github.com/limecloud/lime/releases/download/v1.20.0/Lime.app.tar.gz",
        },
      },
    });
    writeJson(path.join(assetsDir, "x86_64-apple-darwin", "latest.json"), {
      version: "1.20.0",
      platforms: {
        "darwin-x86_64": {
          signature: "sig-x64",
          url: "https://github.com/limecloud/lime/releases/download/v1.20.0/Lime-x64.app.tar.gz",
        },
      },
    });
    writeJson(path.join(assetsDir, "x86_64-pc-windows-msvc", "latest.json"), {
      version: "1.20.0",
      platforms: {
        "windows-x86_64": {
          signature: "sig-win",
          url: "https://github.com/limecloud/lime/releases/download/v1.20.0/Lime.nsis.zip",
        },
      },
    });

    const result = collectUpdaterManifest({
      assetsDir,
      baseUrl: "https://updates.limecloud.com/",
      channel: "stable",
      requiredPlatforms: ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"],
      version: "v1.20.0",
    });

    expect(result.manifest.version).toBe("1.20.0");
    expect(Object.keys(result.manifest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64",
    ]);
    expect(result.manifest.platforms["darwin-aarch64"].url).toBe(
      "https://updates.limecloud.com/lime/stable/v1.20.0/darwin-aarch64/Lime.app.tar.gz",
    );
    expect(result.r2UploadPlan).toHaveLength(3);

    const output = writeOutputs(result, path.join(root, "out"), "stable");
    expect(fs.existsSync(output.latestPath)).toBe(true);
    expect(fs.existsSync(output.versionedLatestPath)).toBe(true);
  });

  it("缺少必需平台时失败，避免发布半可用清单", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-release-missing-"),
    );
    const assetsDir = path.join(root, "release-assets");
    writeFile(path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"));
    writeJson(path.join(assetsDir, "aarch64-apple-darwin", "latest.json"), {
      version: "1.20.0",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-arm",
          url: "https://example.com/Lime.app.tar.gz",
        },
      },
    });

    expect(() =>
      collectUpdaterManifest({
        assetsDir,
        baseUrl: "https://updates.limecloud.com",
        requiredPlatforms: ["darwin-aarch64", "windows-x86_64"],
        version: "v1.20.0",
      }),
    ).toThrow(/missing required platforms/);
  });

  it("平台 latest.json 版本必须和发布 tag 一致", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-release-version-"),
    );
    const assetsDir = path.join(root, "release-assets");
    writeFile(path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"));
    writeJson(path.join(assetsDir, "aarch64-apple-darwin", "latest.json"), {
      version: "1.19.0",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-arm",
          url: "https://example.com/Lime.app.tar.gz",
        },
      },
    });

    expect(() =>
      collectUpdaterManifest({
        assetsDir,
        baseUrl: "https://updates.limecloud.com",
        requiredPlatforms: ["darwin-aarch64"],
        version: "v1.20.0",
      }),
    ).toThrow(/does not match release/);
  });

  it("同名跨平台 updater 包应写入独立 R2 路径", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-release-same-name-"),
    );
    const assetsDir = path.join(root, "release-assets");

    writeFile(
      path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"),
      "arm",
    );
    writeFile(
      path.join(assetsDir, "x86_64-apple-darwin", "Lime.app.tar.gz"),
      "x64",
    );

    writeJson(path.join(assetsDir, "aarch64-apple-darwin", "latest.json"), {
      version: "1.20.0",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-arm",
          url: "https://example.com/Lime.app.tar.gz",
        },
      },
    });
    writeJson(path.join(assetsDir, "x86_64-apple-darwin", "latest.json"), {
      version: "1.20.0",
      platforms: {
        "darwin-x86_64": {
          signature: "sig-x64",
          url: "https://example.com/Lime.app.tar.gz",
        },
      },
    });

    const result = collectUpdaterManifest({
      assetsDir,
      baseUrl: "https://updates.limecloud.com",
      channel: "stable",
      requiredPlatforms: ["darwin-aarch64", "darwin-x86_64"],
      version: "v1.20.0",
    });

    expect(result.manifest.platforms["darwin-aarch64"].url).toBe(
      "https://updates.limecloud.com/lime/stable/v1.20.0/darwin-aarch64/Lime.app.tar.gz",
    );
    expect(result.manifest.platforms["darwin-x86_64"].url).toBe(
      "https://updates.limecloud.com/lime/stable/v1.20.0/darwin-x86_64/Lime.app.tar.gz",
    );
    expect(result.r2UploadPlan.map((item) => item.key).sort()).toEqual([
      "lime/stable/v1.20.0/darwin-aarch64/Lime.app.tar.gz",
      "lime/stable/v1.20.0/darwin-x86_64/Lime.app.tar.gz",
    ]);
    expect(
      result.r2UploadPlan
        .map((item) => fs.readFileSync(item.file, "utf8"))
        .sort(),
    ).toEqual(["arm", "x64"]);
  });

  it("没有 latest.json 时应从 Tauri 签名产物生成清单", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-release-signed-assets-"),
    );
    const assetsDir = path.join(root, "release-assets");
    const rawSignature = [
      "untrusted comment: signature from tauri secret key",
      "RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=",
      "trusted comment: timestamp:1777371807\tfile:Lime.app.tar.gz",
      "MYL3b9yoLwH4W4MRmQQhvOOg9XdKEJkrScotKO5F4kdJ4OZTulm0GmFfp+vweCaiBahx5I+m3FCYP//z/l/gAA==",
    ].join("\n");
    const encodedSignature = Buffer.from(`${rawSignature}\n`, "utf8").toString(
      "base64",
    );

    writeFile(path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"));
    writeFile(
      path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz.sig"),
      encodedSignature,
    );
    writeFile(path.join(assetsDir, "x86_64-apple-darwin", "Lime.app.tar.gz"));
    writeFile(
      path.join(assetsDir, "x86_64-apple-darwin", "Lime.app.tar.gz.sig"),
      rawSignature,
    );
    writeFile(
      path.join(
        assetsDir,
        "x86_64-pc-windows-msvc",
        "Lime_1.20.0_x64-setup.exe",
      ),
    );
    writeFile(
      path.join(
        assetsDir,
        "x86_64-pc-windows-msvc",
        "Lime_1.20.0_x64-setup.exe.sig",
      ),
      encodedSignature,
    );

    const result = collectUpdaterManifest({
      assetsDir,
      baseUrl: "https://updates.limecloud.com",
      channel: "stable",
      notes: "notes",
      requiredPlatforms: ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"],
      version: "v1.20.0",
    });

    expect(result.manifest.version).toBe("1.20.0");
    expect(result.manifest.notes).toBe("notes");
    expect(result.manifest.platforms["darwin-aarch64"].signature).toBe(
      encodedSignature,
    );
    expect(result.manifest.platforms["darwin-x86_64"].signature).toBe(
      encodedSignature,
    );
    expect(result.manifest.platforms["windows-x86_64"].url).toBe(
      "https://updates.limecloud.com/lime/stable/v1.20.0/windows-x86_64/Lime_1.20.0_x64-setup.exe",
    );
    expect(result.r2UploadPlan.map((item) => item.key).sort()).toEqual([
      "lime/stable/v1.20.0/darwin-aarch64/Lime.app.tar.gz",
      "lime/stable/v1.20.0/darwin-x86_64/Lime.app.tar.gz",
      "lime/stable/v1.20.0/windows-x86_64/Lime_1.20.0_x64-setup.exe",
    ]);
  });
});

describe("R2 release cleanup", () => {
  it("只删除超过保留窗口且未受保护的旧版本", () => {
    const keys = [
      "lime/stable/v1.20.0/latest.json",
      "lime/stable/v1.20.0/Lime.nsis.zip",
      "lime/stable/v1.19.0/Lime.nsis.zip",
      "lime/stable/v1.18.0/Lime.nsis.zip",
      "lime/stable/v1.17.0/Lime.nsis.zip",
      "lime/stable/v1.16.0/Lime.nsis.zip",
    ];

    const plan = planR2ReleaseCleanup({
      currentVersion: "v1.20.0",
      keep: 3,
      keys,
      minimumSupportedVersion: "v1.16.0",
    });

    expect(plan.deleteKeys).toEqual(["lime/stable/v1.17.0/Lime.nsis.zip"]);
    expect(plan.protectedVersions).toContain("1.16.0");
  });
});

describe("GitHub release asset staging", () => {
  it("同名 macOS updater 资产上传 GitHub Release 前应重命名", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "lime-github-release-assets-"),
    );
    const assetsDir = path.join(root, "release-assets");
    const outDir = path.join(root, "release-github-assets");
    const latestPath = path.join(root, "release-updater", "latest.json");

    writeFile(path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz"));
    writeFile(
      path.join(assetsDir, "aarch64-apple-darwin", "Lime.app.tar.gz.sig"),
      "arm-sig",
    );
    writeFile(
      path.join(assetsDir, "aarch64-apple-darwin", "Lime_1.24.0_aarch64.dmg"),
    );
    writeFile(path.join(assetsDir, "x86_64-apple-darwin", "Lime.app.tar.gz"));
    writeFile(
      path.join(assetsDir, "x86_64-apple-darwin", "Lime.app.tar.gz.sig"),
      "x64-sig",
    );
    writeFile(
      path.join(assetsDir, "x86_64-apple-darwin", "Lime_1.24.0_x64.dmg"),
    );
    writeFile(latestPath, "{}");

    const copied = prepareGitHubReleaseAssets({
      assetsDir,
      extraAssets: [latestPath],
      outDir,
      version: "v1.24.0",
    });

    expect(copied.map((item) => item.name).sort()).toEqual(
      [
        "Lime_1.24.0_aarch64.app.tar.gz",
        "Lime_1.24.0_aarch64.app.tar.gz.sig",
        "Lime_1.24.0_aarch64.dmg",
        "Lime_1.24.0_x64.app.tar.gz",
        "Lime_1.24.0_x64.app.tar.gz.sig",
        "Lime_1.24.0_x64.dmg",
        "latest.json",
      ].sort(),
    );
    expect(
      fs.readFileSync(
        path.join(outDir, "Lime_1.24.0_aarch64.app.tar.gz.sig"),
        "utf8",
      ),
    ).toBe("arm-sig");
    expect(
      fs.readFileSync(
        path.join(outDir, "Lime_1.24.0_x64.app.tar.gz.sig"),
        "utf8",
      ),
    ).toBe("x64-sig");
  });
});
