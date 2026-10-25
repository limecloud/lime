import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve("electron/native/assets/computer-use-cursor");
const manifest = JSON.parse(
  readFileSync(path.join(root, "manifest.json"), "utf8"),
);
const read = (file) => readFileSync(path.join(root, file));
function chunks(bytes, from, end) {
  const result = [];
  for (let at = from; at < end; ) {
    const size = bytes.readUInt32LE(at + 4);
    expect(at + 8 + size).toBeLessThanOrEqual(end);
    result.push({
      id: bytes.toString("ascii", at, at + 4),
      data: bytes.subarray(at + 8, at + 8 + size),
    });
    at += 8 + size + (size % 2);
  }
  return result;
}

describe("Lime animated computer-use pointers", () => {
  it("uses the current logo colors and embeds all Retina animation frames into the native binary", () => {
    expect(manifest.sourceSha256).toBe(
      createHash("sha256").update(readFileSync(manifest.source)).digest("hex"),
    );
    const swift = readFileSync(
      "electron/native/macos/macos-computer-use-cursor-frames.swift",
      "utf8",
    );
    const embedded = [...swift.matchAll(/"([A-Za-z0-9+/=]+)"/g)].map(
      ([, base64]) => Buffer.from(base64, "base64"),
    );
    expect(embedded).toHaveLength(manifest.frames);
    for (let frame = 0; frame < manifest.frames; frame++) {
      const png = read(`macos/frames@2x/${String(frame).padStart(2, "0")}.png`);
      expect(embedded[frame].equals(png)).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([80, 80]);
    }
    expect(
      new Set(embedded.map((bytes) => bytes.toString("base64"))).size,
    ).toBeGreaterThan(10);
    for (const { color } of manifest.colors)
      expect(read("macos/pointer.svg").toString()).toContain(color);
  });

  it("ships a complete Windows RIFF ACON animation with stable hotspots at 100/150/200% DPI", () => {
    const ani = read("windows/lime-pointer.ani");
    expect(ani.toString("ascii", 0, 4)).toBe("RIFF");
    expect(ani.readUInt32LE(4)).toBe(ani.length - 8);
    expect(ani.toString("ascii", 8, 12)).toBe("ACON");
    const top = chunks(ani, 12, ani.length);
    const header = top.find((chunk) => chunk.id === "anih").data;
    expect([
      header.readUInt32LE(0),
      header.readUInt32LE(4),
      header.readUInt32LE(8),
      header.readUInt32LE(28),
      header.readUInt32LE(32),
    ]).toEqual([36, 24, 24, 4, 1]);
    const list = top.find((chunk) => chunk.id === "LIST").data;
    expect(list.toString("ascii", 0, 4)).toBe("fram");
    const icons = chunks(list, 4, list.length);
    expect(icons).toHaveLength(24);
    expect(
      new Set(icons.map(({ data }) => data.toString("base64"))).size,
    ).toBeGreaterThan(10);
    for (const { id, data } of icons) {
      expect(id).toBe("icon");
      expect([
        data.readUInt16LE(0),
        data.readUInt16LE(2),
        data.readUInt16LE(4),
      ]).toEqual([0, 2, 3]);
      for (let i = 0; i < 3; i++) {
        const at = 6 + i * 16,
          size = [32, 48, 64][i];
        const offset = data.readUInt32LE(at + 12),
          length = data.readUInt32LE(at + 8);
        expect([data[at], data[at + 1]]).toEqual([size, size]);
        expect([data.readUInt16LE(at + 4), data.readUInt16LE(at + 6)]).toEqual(
          [11, 11].map((v) => Math.round((v * size) / 32)),
        );
        expect(offset + length).toBeLessThanOrEqual(data.length);
        expect([
          data.readUInt32LE(offset),
          data.readInt32LE(offset + 4),
          data.readInt32LE(offset + 8),
          data.readUInt16LE(offset + 14),
        ]).toEqual([40, size, size * 2, 32]);
        // The border stays transparent and the bitmap contains visible arrow pixels.
        const alpha = [];
        for (let p = offset + 43; p < offset + 40 + size * size * 4; p += 4)
          alpha.push(data[p]);
        expect(alpha[0]).toBe(0);
        expect(Math.max(...alpha)).toBeGreaterThan(220);
      }
    }
    expect(read("windows/lime-pointer.cur").equals(icons[0].data)).toBe(true);
    const haloAlpha = (frame) => {
      const dib = frame.readUInt32LE(18);
      return frame[dib + 40 + ((31 - 27) * 32 + 16) * 4 + 3];
    };
    expect(haloAlpha(icons[0].data)).toBeGreaterThan(0);
    expect(haloAlpha(icons[12].data)).toBeGreaterThan(haloAlpha(icons[0].data));
    expect((manifest.frames / 60) * 4 * 1000).toBe(manifest.durationMs);
  });
});
