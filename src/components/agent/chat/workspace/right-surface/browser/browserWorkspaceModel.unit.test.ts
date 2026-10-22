import { describe, expect, it } from "vitest";
import { normalizeBrowserAddress } from "./browserWorkspaceModel";

describe("normalizeBrowserAddress", () => {
  it.each([
    ["  ", ""],
    ["localhost:1420/preview", "http://localhost:1420/preview"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000/"],
    ["[::1]:3000/test", "http://[::1]:3000/test"],
    ["example.com/path", "https://example.com/path"],
    ["http://example.com/", "http://example.com/"],
    ["lime browser", "https://www.google.com/search?q=lime%20browser"],
  ])("normalizes %s for the existing HTTP native host", (input, expected) => {
    expect(normalizeBrowserAddress(input)).toBe(expected);
  });
});
