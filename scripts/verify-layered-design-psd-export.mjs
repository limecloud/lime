#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function printHelp() {
  console.log(`
Layered Design PSD Export Verifier

用途:
  验证 trial.psd 是否是可解析 PSD，并可选校验 psd-like-manifest.json 的图层数和图层名称。

用法:
  node scripts/verify-layered-design-psd-export.mjs --psd <trial.psd> --psd-like-manifest <psd-like-manifest.json>

选项:
  --psd <path>                 trial.psd 路径
  --psd-like-manifest <path>   可选 psd-like-manifest.json 路径
  -h, --help                   显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    psdPath: "",
    psdLikeManifestPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--psd") {
      options.psdPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--psd-like-manifest") {
      options.psdLikeManifestPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (!options.psdPath) {
    throw new Error("必须传入 --psd");
  }

  return options;
}

function readAscii(buffer, offset, length) {
  return Array.from(buffer.slice(offset, offset + length))
    .map((code) => String.fromCharCode(code))
    .join("");
}

function readUnicodeString(buffer, offset, byteLength) {
  if (byteLength < 4) {
    return "";
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const charCount = view.getUint32(offset, false);
  let cursor = offset + 4;
  const chars = [];
  for (let index = 0; index < charCount && cursor + 1 < offset + byteLength; index += 1) {
    chars.push(String.fromCharCode(view.getUint16(cursor, false)));
    cursor += 2;
  }
  return chars.join("");
}

function parseAdditionalLayerInfo(buffer, start, end) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = start;
  let unicodeName = "";
  const tags = [];

  while (offset + 12 <= end) {
    const signature = readAscii(buffer, offset, 4);
    const key = readAscii(buffer, offset + 4, 4);
    const length = view.getUint32(offset + 8, false);
    const dataStart = offset + 12;
    const dataEnd = dataStart + length;
    if ((signature !== "8BIM" && signature !== "8B64") || dataEnd > end) {
      break;
    }
    tags.push(key);
    if (key === "luni") {
      unicodeName = readUnicodeString(buffer, dataStart, length);
    }
    offset = dataEnd + (length % 2);
  }

  return { unicodeName, tags };
}

function parsePsd(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 30) {
    throw new Error("PSD 文件过短");
  }
  const signature = readAscii(buffer, 0, 4);
  const version = view.getUint16(4, false);
  const channels = view.getUint16(12, false);
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  const depth = view.getUint16(22, false);
  const colorMode = view.getUint16(24, false);
  if (signature !== "8BPS" || version !== 1) {
    throw new Error(`不是 PSD v1 文件: signature=${signature} version=${version}`);
  }

  let offset = 26;
  const colorModeDataLength = view.getUint32(offset, false);
  offset += 4 + colorModeDataLength;
  const imageResourcesLength = view.getUint32(offset, false);
  offset += 4 + imageResourcesLength;
  const layerMaskInfoLength = view.getUint32(offset, false);
  offset += 4;
  const layerMaskInfoEnd = offset + layerMaskInfoLength;
  if (layerMaskInfoLength === 0) {
    return {
      signature,
      version,
      channels,
      height,
      width,
      depth,
      colorMode,
      layerCount: 0,
      layers: [],
    };
  }
  if (layerMaskInfoEnd > buffer.byteLength) {
    throw new Error("PSD layer/mask section 越界");
  }

  const layerInfoLength = view.getUint32(offset, false);
  offset += 4;
  const layerInfoEnd = offset + layerInfoLength;
  const signedLayerCount = view.getInt16(offset, false);
  offset += 2;
  const layerCount = Math.abs(signedLayerCount);
  const layers = [];

  for (let index = 0; index < layerCount; index += 1) {
    const top = view.getInt32(offset, false);
    const left = view.getInt32(offset + 4, false);
    const bottom = view.getInt32(offset + 8, false);
    const right = view.getInt32(offset + 12, false);
    offset += 16;
    const channelCount = view.getUint16(offset, false);
    offset += 2 + channelCount * 6;
    const blendModeSignature = readAscii(buffer, offset, 4);
    const blendModeKey = readAscii(buffer, offset + 4, 4);
    const opacity = buffer[offset + 8];
    const flags = buffer[offset + 10];
    offset += 12;
    const extraLength = view.getUint32(offset, false);
    offset += 4;
    const extraStart = offset;
    const extraEnd = extraStart + extraLength;
    if (extraEnd > layerInfoEnd) {
      throw new Error(`PSD layer ${index} extra data 越界`);
    }

    const maskLength = view.getUint32(offset, false);
    offset += 4 + maskLength;
    const blendingRangesLength = view.getUint32(offset, false);
    offset += 4 + blendingRangesLength;
    const pascalStart = offset;
    const pascalLength = buffer[offset];
    const pascalName = readAscii(buffer, offset + 1, pascalLength);
    const pascalPaddedLength = Math.ceil((1 + pascalLength) / 4) * 4;
    offset = pascalStart + pascalPaddedLength;
    const { unicodeName, tags } = parseAdditionalLayerInfo(buffer, offset, extraEnd);
    offset = extraEnd;

    layers.push({
      index,
      name: unicodeName || pascalName,
      pascalName,
      bounds: { top, left, bottom, right },
      blendModeSignature,
      blendModeKey,
      opacity,
      visible: (flags & 0x02) === 0,
      tags,
    });
  }

  return {
    signature,
    version,
    channels,
    height,
    width,
    depth,
    colorMode,
    layerCount,
    layers,
  };
}

function readManifest(manifestPath) {
  if (!manifestPath) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.layers)) {
    throw new Error("psd-like manifest 缺少 layers 数组");
  }
  return manifest;
}

function truncateTextForLayerName(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
}

function resolveExpectedManifestLayerName(layer) {
  const name = String(layer.name ?? "");
  const text = typeof layer.text?.text === "string" ? layer.text.text : "";
  if (layer.type !== "text" || !text) {
    return name;
  }
  const textPreview = truncateTextForLayerName(text);
  if (!textPreview || name.includes(textPreview)) {
    return name;
  }
  return `${name} · ${textPreview}`;
}

function validateAgainstManifest(parsed, manifest) {
  if (!manifest) {
    return undefined;
  }
  const manifestLayerNames = manifest.layers.map(resolveExpectedManifestLayerName);
  const psdLayerNames = parsed.layers.map((layer) => layer.name);
  if (parsed.layerCount !== manifest.layers.length) {
    throw new Error(
      `PSD 图层数 ${parsed.layerCount} 与 manifest 图层数 ${manifest.layers.length} 不一致`,
    );
  }
  for (let index = 0; index < manifestLayerNames.length; index += 1) {
    if (psdLayerNames[index] !== manifestLayerNames[index]) {
      throw new Error(
        `PSD 图层 ${index} 名称不一致: ${psdLayerNames[index]} !== ${manifestLayerNames[index]}`,
      );
    }
  }
  if (manifest.compatibility?.truePsd !== false) {
    throw new Error("psd-like manifest 必须明确 compatibility.truePsd=false");
  }

  return {
    manifestLayerCount: manifest.layers.length,
    manifestLayerNames,
    namesMatch: true,
    compatibilityTruePsd: manifest.compatibility.truePsd,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const psdPath = path.resolve(options.psdPath);
  const manifestPath = options.psdLikeManifestPath
    ? path.resolve(options.psdLikeManifestPath)
    : "";
  const parsed = parsePsd(fs.readFileSync(psdPath));
  const manifest = readManifest(manifestPath);
  const manifestValidation = validateAgainstManifest(parsed, manifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        psdPath,
        ...(manifestPath ? { psdLikeManifestPath: manifestPath } : {}),
        psd: {
          signature: parsed.signature,
          version: parsed.version,
          width: parsed.width,
          height: parsed.height,
          channels: parsed.channels,
          depth: parsed.depth,
          colorMode: parsed.colorMode,
          layerCount: parsed.layerCount,
          layerNames: parsed.layers.map((layer) => layer.name),
          layers: parsed.layers,
        },
        ...(manifestValidation ? { manifestValidation } : {}),
      },
      null,
      2,
    ),
  );
}

main();
