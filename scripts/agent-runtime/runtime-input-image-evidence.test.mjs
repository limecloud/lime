import { describe, expect, it } from "vitest";
import { runtimeInputImageEvidence } from "./runtime-input-image-evidence.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeFixtureBackend } from "../lib/chat-fixture/backend-script.mjs";

describe("runtime input image evidence", () => {
  it("generated independent backend records real image bytes after Vitest transforms its producer", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "runtime-image-backend-"),
    );
    try {
      const backend = path.join(directory, "backend.mjs");
      const ledger = path.join(directory, "ledger.jsonl");
      writeFixtureBackend(backend);
      const bytes = Buffer.from(
        "89504e470d0a1a0a0000000d494844520000000a00000014",
        "hex",
      );
      const result = spawnSync(process.execPath, [backend, ledger], {
        encoding: "utf8",
        timeout: 10_000,
        input: JSON.stringify({
          kind: "turnStart",
          request: {
            session: { sessionId: "s1", threadId: "t1" },
            turn: { turnId: "turn1" },
            input: {
              parts: [
                {
                  Image: {
                    uri: `data:image/png;base64,${bytes.toString("base64")}`,
                    media_type: "image/png",
                  },
                },
              ],
            },
          },
        }),
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const start = readFileSync(ledger, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((entry) => entry.kind === "turnStart");
      expect(start.inputSummary.imageEvidence).toEqual([
        {
          mediaType: "image/png",
          byteLength: 24,
          sha256:
            "164f10f30aac2391a6386fda0f476ae64eb7046834899e4a4cd5d3927565a7ac",
          signature: "89504e470d0a1a0a",
          width: 10,
          height: 20,
        },
      ]);
      expect(JSON.stringify(start.inputSummary)).not.toContain(
        bytes.toString("base64"),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
  it("records the delivered PNG bytes without putting base64 into the ledger evidence", () => {
    const header = Buffer.from(
      "89504e470d0a1a0a0000000d494844520000000a00000014",
      "hex",
    );
    const data = header.toString("base64");
    const result = runtimeInputImageEvidence({
      input: {
        parts: [
          {
            Image: {
              uri: `data:image/png;base64,${data}`,
              media_type: "image/png",
            },
          },
        ],
      },
    });
    expect(result).toEqual([
      {
        mediaType: "image/png",
        byteLength: 24,
        sha256:
          "164f10f30aac2391a6386fda0f476ae64eb7046834899e4a4cd5d3927565a7ac",
        signature: "89504e470d0a1a0a",
        width: 10,
        height: 20,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(data);
    expect(
      runtimeInputImageEvidence({
        input: {
          parts: [
            {
              Image: {
                uri: "media://captured-image",
                provider_data: `data:image/png;base64,${data}`,
                media_type: "image/png",
              },
            },
          ],
        },
      }),
    ).toEqual(result);
  });
});
