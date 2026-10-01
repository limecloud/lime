import { readFileSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("prompt history canonical identity", () => {
  it("keeps both GUI append callers on the canonical v2 field", () => {
    for (const file of ["src/components/agent/chat/components/EmptyState.tsx", "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts"]) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, file).toMatch(/appendPromptHistory\(\{\s*threadId: sessionId,/u);
      expect(source, file).not.toMatch(/appendPromptHistory\(\{\s*sessionId,/u);
    }
  });
});
