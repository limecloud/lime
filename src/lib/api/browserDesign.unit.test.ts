import { describe, expect, it } from "vitest";
import {
  readBrowserDesignChange,
  readBrowserDesignSnapshot,
  updateBrowserDesignChange,
  type BrowserDesignSnapshot,
} from "./browserDesign";

const snapshot: BrowserDesignSnapshot = {
  declarations: [
    { property: "color", value: "rgb(0, 0, 0)", previousValue: "rgb(0, 0, 0)" },
    { property: "font-size", value: "16px", previousValue: "16px" },
  ],
  text: { value: "Original", previousValue: "Original" },
  elementTagName: "button",
};

describe("Browser design baseline", () => {
  it("keeps the first baseline across successive changes and returns null at the original values", () => {
    const first = updateBrowserDesignChange(snapshot, null, "color", "red");
    const second = updateBrowserDesignChange(snapshot, first, "color", "blue");
    expect(second).toEqual({
      declarations: [
        { property: "color", previousValue: "rgb(0, 0, 0)", value: "blue" },
      ],
    });
    const text = updateBrowserDesignChange(snapshot, second, "text", "Revised");
    const restoredColor = updateBrowserDesignChange(
      snapshot,
      text,
      "color",
      "rgb(0, 0, 0)",
    );
    expect(restoredColor).toEqual({
      declarations: [],
      text: { previousValue: "Original", value: "Revised" },
    });
    expect(
      updateBrowserDesignChange(snapshot, restoredColor, "text", "Original"),
    ).toBeNull();
  });

  it("rejects duplicate, unknown and forged baseline properties or noneditable text", () => {
    const change = {
      declarations: [
        { property: "color", value: "red", previousValue: "rgb(0, 0, 0)" },
      ],
    };
    expect(readBrowserDesignChange(change, snapshot)).toEqual(change);
    for (const invalid of [
      { declarations: [...change.declarations, ...change.declarations] },
      {
        declarations: [
          { ...change.declarations[0], property: "background-image" },
        ],
      },
      { declarations: [{ ...change.declarations[0], previousValue: "blue" }] },
      { ...change, callback: "execute" },
      { declarations: [], text: { value: "New", previousValue: "forged" } },
    ])
      expect(() => readBrowserDesignChange(invalid, snapshot)).toThrow();
    expect(() =>
      readBrowserDesignChange(
        { declarations: [], text: { value: "New", previousValue: "Original" } },
        { ...snapshot, text: undefined },
      ),
    ).toThrow();
  });

  it("bounds page snapshots and only accepts a baseline, never an already edited property", () => {
    expect(readBrowserDesignSnapshot(snapshot)).toEqual(snapshot);
    for (const invalid of [
      {
        ...snapshot,
        declarations: [...snapshot.declarations, snapshot.declarations[0]],
      },
      {
        ...snapshot,
        declarations: [
          { property: "color", value: "red", previousValue: "black" },
        ],
      },
      { ...snapshot, text: { value: "x", previousValue: "y" } },
      {
        ...snapshot,
        declarations: [
          {
            property: "color",
            value: "x".repeat(4097),
            previousValue: "x".repeat(4097),
          },
        ],
      },
    ])
      expect(() => readBrowserDesignSnapshot(invalid)).toThrow();
  });
});
