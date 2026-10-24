import { describe, expect, it, vi } from "vitest";
import {
  createW3cTraceContextCarrier,
  normalizeW3cTraceContextCarrier,
} from "./traceContext";

describe("traceContext", () => {
  it("应生成合法 W3C trace context carrier", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-2222-3333-4444-555555555555")
      .mockReturnValueOnce("66666666-7777-8888-9999-aaaaaaaaaaaa");

    expect(createW3cTraceContextCarrier()).toEqual({
      traceparent: "00-11111111222233334444555555555555-9999aaaaaaaaaaaa-01",
      tracestate: null,
      traceId: "11111111222233334444555555555555",
    });
  });

  it("应归一化合法 W3C carrier 并拒绝非法 traceparent", () => {
    expect(
      normalizeW3cTraceContextCarrier({
        traceparent: "00-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB-01",
        tracestate: "vendor=value",
      }),
    ).toEqual({
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      tracestate: "vendor=value",
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(
      normalizeW3cTraceContextCarrier({
        traceparent: "00-00000000000000000000000000000000-bbbbbbbbbbbbbbbb-01",
      }),
    ).toBeNull();
  });
});
