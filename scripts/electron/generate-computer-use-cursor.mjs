// Lime brand adaptation. Rebuild with rsvg-convert and ImageMagick; no model calls.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(root, "electron/native/assets/computer-use-cursor");
const source = readFileSync(path.join(root, "public/logo-v6.svg"), "utf8");
const gradient = source.match(
  /<linearGradient id="ringGrad"[\s\S]*?<\/linearGradient>/,
)?.[0];
if (!gradient) throw new Error("Lime logo gradient is required");
const stops = [
  ...gradient.matchAll(/offset="([^"]+)" stop-color="([^"]+)"/g),
].map(([, offset, color]) => ({ offset, color }));
const frames = 24;
const durationMs = 1600;
const variants = {
  macos: {
    width: 40,
    height: 40,
    hotspot: [15, 15],
    inset: 12,
    sizes: [1, 2],
    shape:
      "M4.1 3.2 C2.9 2.75 1.8 3.85 2.25 5.05 L5.9 15.2 C6.3 16.3 7.8 16.34 8.25 15.25 L9.92 11.15 Q10.08 10.75 10.48 10.59 L14.58 8.92 C15.67 8.47 15.63 6.97 14.53 6.57 Z",
  },
  windows: {
    width: 32,
    height: 32,
    hotspot: [11, 11],
    inset: 8,
    sizes: [1, 1.5, 2],
    shape:
      "M4.1 3.2 C2.9 2.75 1.8 3.85 2.25 5.05 L5.9 15.2 C6.3 16.3 7.8 16.34 8.25 15.25 L9.92 11.15 Q10.08 10.75 10.48 10.59 L14.58 8.92 C15.67 8.47 15.63 6.97 14.53 6.57 Z",
  },
};

function svg(platform, frame = 0) {
  const { width, height, shape, inset } = variants[platform];
  const phase = Math.sin((frame * 2 * Math.PI) / frames);
  const pulse = (1 - Math.cos((frame * 2 * Math.PI) / frames)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="lime" gradientUnits="userSpaceOnUse" x1="${-6 + phase * 3}" y1="${-4 + phase * 3}" x2="${20 + phase * 3}" y2="${20 + phase * 3}">
      ${stops.map(({ offset, color }) => `<stop offset="${offset}" stop-color="${color}"/>`).join("\n      ")}
    </linearGradient>
    <filter id="shadow" x="-35%" y="-25%" width="180%" height="170%"><feDropShadow dx="0" dy="0.5" stdDeviation="0.45" flood-color="#022c22" flood-opacity="0.22"/></filter>
    <radialGradient id="halo"><stop stop-color="#10B981" stop-opacity="0.32"/><stop offset="0.55" stop-color="#84CC16" stop-opacity="0.18"/><stop offset="1" stop-color="#84CC16" stop-opacity="0"/></radialGradient>
  </defs>
  <g transform="translate(${inset} ${inset})">
  <ellipse cx="8.5" cy="9.5" rx="${11 + pulse * 2}" ry="${11 + pulse * 2}" fill="url(#halo)" opacity="${0.6 + pulse * 0.4}"/>
  <g transform="rotate(${phase * 4} 3 3)">
  <path d="${shape}" fill="url(#lime)" fill-opacity="0.12" stroke="#064e3b" stroke-opacity="0.4" stroke-width="1.7" stroke-linejoin="round" filter="url(#shadow)"/>
  <path d="${shape}" fill="none" stroke="url(#lime)" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
  </g>
</svg>\n`;
}

function chunk(id, bytes) {
  const header = Buffer.alloc(8);
  header.write(id);
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([
    header,
    bytes,
    ...(bytes.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}

function cursor(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(2, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const dibs = images.map(({ file, width, height, hotspot }, index) => {
    const rgba = execFileSync("magick", [file, "-depth", "8", "rgba:-"]);
    if (rgba.length !== width * height * 4)
      throw new Error("Unexpected cursor pixels");
    const maskStride = Math.ceil(width / 32) * 4;
    const dib = Buffer.alloc(40 + width * height * 4 + maskStride * height);
    dib.writeUInt32LE(40);
    dib.writeInt32LE(width, 4);
    dib.writeInt32LE(height * 2, 8);
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(32, 14);
    dib.writeUInt32LE(dib.length - 40, 20);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4,
          to = 40 + ((height - y - 1) * width + x) * 4;
        dib.set(
          [rgba[from + 2], rgba[from + 1], rgba[from], rgba[from + 3]],
          to,
        );
        if (rgba[from + 3] === 0)
          dib[
            40 + width * height * 4 + (height - y - 1) * maskStride + (x >> 3)
          ] |= 0x80 >> (x % 8);
      }
    const at = 6 + index * 16;
    header[at] = width;
    header[at + 1] = height;
    header.writeUInt16LE(hotspot[0], at + 4);
    header.writeUInt16LE(hotspot[1], at + 6);
    header.writeUInt32LE(dib.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += dib.length;
    return dib;
  });
  return Buffer.concat([header, ...dibs]);
}

function animatedCursor(icons) {
  const header = Buffer.alloc(36);
  [36, frames, frames, 0, 0, 32, 1, 4, 1].forEach((value, i) =>
    header.writeUInt32LE(value, i * 4),
  );
  const contents = Buffer.concat([
    Buffer.from("ACON"),
    chunk("anih", header),
    chunk(
      "LIST",
      Buffer.concat([
        Buffer.from("fram"),
        ...icons.map((icon) => chunk("icon", icon)),
      ]),
    ),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF");
  riff.writeUInt32LE(contents.length, 4);
  return Buffer.concat([riff, contents]);
}

const temp = mkdtempSync(path.join(os.tmpdir(), "lime-cursor-"));
try {
  mkdirSync(output, { recursive: true });
  const previews = [];
  for (const [platform, variant] of Object.entries(variants)) {
    const directory = path.join(output, platform);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "pointer.svg"), svg(platform));
    const icons = [];
    const displayFrames = [];
    for (let frame = 0; frame < frames; frame++) {
      const vector = path.join(temp, `${platform}-${frame}.svg`);
      writeFileSync(vector, svg(platform, frame));
      const images = variant.sizes.map((scale) => {
        const width = variant.width * scale,
          height = variant.height * scale;
        const file = path.join(temp, `${platform}-${frame}-${scale}.png`);
        execFileSync("rsvg-convert", [
          "-w",
          String(width),
          "-h",
          String(height),
          "-o",
          file,
          vector,
        ]);
        if (platform === "macos") {
          const frameDir = path.join(
            directory,
            scale === 2 ? "frames@2x" : "frames",
          );
          mkdirSync(frameDir, { recursive: true });
          writeFileSync(
            path.join(frameDir, `${String(frame).padStart(2, "0")}.png`),
            readFileSync(file),
          );
        }
        if (frame === 0 && scale === 1)
          writeFileSync(
            path.join(directory, "pointer.png"),
            readFileSync(file),
          );
        return {
          file,
          width,
          height,
          hotspot: variant.hotspot.map((v) => Math.round(v * scale)),
        };
      });
      if (platform === "windows") icons.push(cursor(images));
      const enlarged = path.join(temp, `${platform}-display-${frame}.png`);
      execFileSync("rsvg-convert", [
        "-w",
        String(variant.width * 5),
        "-h",
        String(variant.height * 5),
        "-o",
        enlarged,
        vector,
      ]);
      displayFrames.push(enlarged);
    }
    execFileSync("magick", [
      "-delay",
      "7",
      "-dispose",
      "background",
      ...displayFrames,
      "-background",
      "#101110",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-loop",
      "0",
      path.join(directory, "preview.gif"),
    ]);
    execFileSync("magick", [
      path.join(directory, "preview.gif"),
      "-coalesce",
      "-resize",
      `${variant.width}x${variant.height}`,
      "-background",
      "#101110",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-gravity",
      "center",
      "-extent",
      "64x64",
      "-layers",
      "Optimize",
      path.join(directory, "preview-actual-size.gif"),
    ]);
    if (platform === "windows") {
      writeFileSync(
        path.join(directory, "lime-pointer.ani"),
        animatedCursor(icons),
      );
      writeFileSync(path.join(directory, "lime-pointer.cur"), icons[0]);
    }
    previews.push(platform);
  }
  const manifest = {
    schemaVersion: 1,
    source: "public/logo-v6.svg",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    colors: stops,
    frames,
    durationMs,
    motion: {
      halo: "radial opacity/size breathing",
      wobbleDegrees: 4,
      pivot: "fixed hotspot",
      reduced: "first frame",
    },
    fps: (frames * 1000) / durationMs,
    macos: {
      ...variants.macos,
      format: "PNG frames, AppKit/Core Animation overlay",
      reduceMotion: "first frame",
    },
    windows: {
      ...variants.windows,
      format: "RIFF ACON .ani with multi-resolution 32-bit CUR frames",
      reduceMotion: "lime-pointer.cur",
    },
  };
  writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const mac = variants.macos;
  const embedded = Array.from({ length: frames }, (_, frame) =>
    readFileSync(
      path.join(
        output,
        "macos/frames@2x",
        `${String(frame).padStart(2, "0")}.png`,
      ),
    ).toString("base64"),
  );
  writeFileSync(
    path.join(
      root,
      "electron/native/macos/macos-computer-use-cursor-frames.swift",
    ),
    `// Generated by scripts/electron/generate-computer-use-cursor.mjs. Do not edit.\nimport Foundation\n\nenum ComputerUseCursorFrames {\n    static let width = ${mac.width}.0\n    static let height = ${mac.height}.0\n    static let hotspotX = ${mac.hotspot[0]}.0\n    static let hotspotY = ${mac.hotspot[1]}.0\n    static let duration = ${durationMs / 1000}\n    static let png = [\n${embedded.map((value) => `        "${value}",`).join("\n")}\n    ]\n}\n`,
  );
  console.log(
    `Generated ${previews.join(", ")} animated pointers in ${output}`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
