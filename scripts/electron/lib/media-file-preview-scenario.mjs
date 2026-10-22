import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { openFileTab } from "./thread-side-panel-navigation.mjs";

const pane = '[data-testid="workspace-right-surface-active-pane"]';
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function imageFixture() {
  const width = 128,
    height = 96;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels.set([32 + x, 80 + y, 190, 255], offset);
    }
  const chunk = (name, bytes) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([size, type, bytes, checksum]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function audioFixture() {
  const frames = 2000,
    sampleRate = 8000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(8000 * Math.sin((i * 440 * Math.PI * 2) / sampleRate)),
      44 + i * 2,
    );
  return bytes;
}

/** 原生Canvas/MediaRecorder只生成测试源文件，不注入产品标签、controller或业务状态。 */
export async function writeMediaPreviewFixtures(page, filePath) {
  fs.writeFileSync(filePath, imageFixture());
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Preview-audio.wav"),
    audioFixture(),
  );
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) =>
      chunks.push(event.data),
    );
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", reject, { once: true });
    });
    let timer;
    try {
      const encoded = async () => {
        const started = new Promise((resolve) =>
          recorder.addEventListener("start", resolve, { once: true }),
        );
        recorder.start();
        // Chromium收到首帧才派发start；先绘制，避免等待尚无输入的编码器。
        context.fillRect(0, 0, canvas.width, canvas.height);
        await started;
        for (let frame = 0; frame < 8; frame++) {
          context.fillStyle = frame % 2 ? "#316be9" : "#ffbb44";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await new Promise(requestAnimationFrame);
        }
        recorder.stop();
        await stopped;
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      };
      return await Promise.race([
        encoded(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native WebM fixture encoding timed out")),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      for (const track of stream.getTracks()) track.stop();
    }
  });
  assert.ok(video.length > 0, "native encoder produced a real WebM source");
  fs.writeFileSync(
    path.join(path.dirname(filePath), "Preview-video.webm"),
    Buffer.from(video),
  );
}

/** 共享Files真实打开三种文件；由Chromium解码原件，不伪造load或播放状态。 */
export async function runMediaFilePreviewScenario({
  page,
  filePath,
  evidenceDir,
  options,
}) {
  const records = [];
  for (const [kind, filename] of [
    ["image", path.basename(filePath)],
    ["audio", "Preview-audio.wav"],
    ["video", "Preview-video.webm"],
  ]) {
    const source = path.join(path.dirname(filePath), filename);
    const before = sha(fs.readFileSync(source));
    if (kind !== "image") await openFileTab(page, source, options.timeoutMs);
    const selector = `${pane} [data-testid="preview-artifact-${kind}"]`;
    const ready = await page.waitForFunction(
      ({ selector, kind }) => {
        const media = document.querySelector(selector);
        if (!media) return false;
        if (kind === "image") {
          if (
            !media.complete ||
            media.naturalWidth !== 128 ||
            media.naturalHeight !== 96
          )
            return false;
          return {
            src: media.currentSrc,
            width: media.naturalWidth,
            height: media.naturalHeight,
          };
        }
        if (
          media.error ||
          media.readyState < 2 ||
          !media.controls ||
          !media.paused
        )
          return false;
        if (kind === "audio" && Math.abs(media.duration - 0.25) > 0.01)
          return false;
        if (
          kind === "video" &&
          (media.videoWidth !== 320 || media.videoHeight !== 180)
        )
          return false;
        return {
          src: media.currentSrc,
          readyState: media.readyState,
          paused: media.paused,
          controls: media.controls,
          duration: Number.isFinite(media.duration) ? media.duration : null,
          width: media.videoWidth ?? null,
          height: media.videoHeight ?? null,
        };
      },
      { selector, kind },
      { timeout: options.timeoutMs },
    );
    const native = await ready.jsonValue();
    await ready.dispose();
    assert.ok(
      decodeURIComponent(native.src).includes(source.replace(/\\/g, "/")),
      "decoded media belongs to the exact current file",
    );
    const active = page.locator(pane);
    assert.equal(
      await active
        .locator(
          '[data-testid="preview-artifact-fallback-surface"], [data-testid="file-editor"], textarea',
        )
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(
          `[data-testid="canvas-workbench-shell"] [data-testid="preview-artifact-${kind}"]`,
        )
        .count(),
      0,
    );
    assert.equal(
      sha(fs.readFileSync(source)),
      before,
      "read-only preview preserves original bytes",
    );
    await page.screenshot({
      path: path.join(evidenceDir, `files-${kind}.png`),
    });
    records.push({
      kind,
      filename,
      sourceSha256: before,
      native,
      originalPreserved: true,
    });
  }
  return {
    records,
    nativeDecodeObserved: true,
    productionStateInjection: false,
    autoplay: false,
    scope:
      "Native file decode and controls presence, not complete playback controls/platform/codec matrix.",
  };
}
