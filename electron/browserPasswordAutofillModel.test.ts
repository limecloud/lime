import { describe, expect, it } from "vitest";
import { isSecureAutofillUrl } from "./browserPasswordAutofillModel";

describe("isSecureAutofillUrl", () => {
  it("允许 https 与本机 http", () => {
    expect(isSecureAutofillUrl("https://example.com/login")).toBe(true);
    expect(isSecureAutofillUrl("http://localhost:3000/login")).toBe(true);
    expect(isSecureAutofillUrl("http://127.0.0.1:3000/login")).toBe(true);
  });

  it("拒绝公网 http 与非 http", () => {
    expect(isSecureAutofillUrl("http://example.com")).toBe(false);
    expect(isSecureAutofillUrl("ftp://example.com")).toBe(false);
    expect(isSecureAutofillUrl("not a url")).toBe(false);
  });
});
