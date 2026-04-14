import { describe, expect, it } from "vitest";

import { isToolResultSuccessful } from "./agentChatToolResult";

describe("agentChatToolResult", () => {
  it("reported_success 为 true 时应覆盖非零 exit_code", () => {
    expect(
      isToolResultSuccessful({
        success: true,
        metadata: {
          exit_code: 1,
          reported_success: true,
        },
      }),
    ).toBe(true);
  });

  it("reported_success 为 false 时应优先判定失败", () => {
    expect(
      isToolResultSuccessful({
        success: true,
        metadata: {
          exit_code: 0,
          reported_success: false,
        },
      }),
    ).toBe(false);
  });
});
