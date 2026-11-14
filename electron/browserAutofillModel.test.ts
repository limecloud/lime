import { describe, expect, it } from "vitest";
import {
  isSecureAutofillUrl,
  normalizeAutofillOrigin,
} from "./browserAutofillModel";

describe("browserAutofillModel", () => {
  it("normalizes http(s) origins", () => {
    expect(normalizeAutofillOrigin("https://Example.com/login")).toBe(
      "https://example.com",
    );
    expect(normalizeAutofillOrigin("mailto:x@example.com")).toBeNull();
  });

  it("allows https and loopback http only", () => {
    expect(isSecureAutofillUrl("https://example.com")).toBe(true);
    expect(isSecureAutofillUrl("http://localhost:3000")).toBe(true);
    expect(isSecureAutofillUrl("http://127.0.0.1/")).toBe(true);
    expect(isSecureAutofillUrl("http://example.com")).toBe(false);
  });
});
