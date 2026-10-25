import { describe, expect, it } from "vitest";
import {
  assertWpsCell,
  wpsWriteCellOperations,
} from "./computer-use-wps-workbook.mjs";

const observation = ({
  y = 215,
  address = "A1",
  focused = false,
  value = "new marker",
} = {}) => ({
  messages: [
    {
      role: "tool",
      content: JSON.stringify({
        tree: {
          role: "AXWindow",
          frame: { x: 100, y: 25, width: 1440, height: 875 },
          children: [
            {
              role: "AXTextField",
              enabled: true,
              value: address,
              focused,
              frame: { x: 123, y, width: 120, height: 20 },
            },
            { role: "AXTextArea", value },
          ],
        },
      }),
    },
  ],
});

describe("WPS observed input", () => {
  it("derives the next click from current banner geometry and window origin", () => {
    const click = wpsWriteCellOperations("A1", "new marker")[2];
    expect(click(observation({ y: 180 }))).toMatchObject({ x: 83, y: 165 });
    expect(click(observation({ y: 215 }))).toMatchObject({ x: 83, y: 200 });
  });

  it("refuses address typing when the grid received the name-box click", () => {
    const select = wpsWriteCellOperations("A1", "new marker")[4];
    expect(() => select(observation())).toThrow(/keyboard focus/);
    expect(select(observation({ focused: true }))).toEqual({
      action: "key",
      key: "a",
      modifiers: ["command"],
    });
  });

  it("recognizes the actual WPS/Qt name-box parent focus while rejecting grid focus", () => {
    const body = observation();
    const { tree } = JSON.parse(body.messages[0].content);
    tree.children = [
      { role: "AXGroup", focused: true, children: [] },
      { role: "AXSplitGroup", focused: true, children: [tree.children[0]] },
      tree.children[1],
    ];
    body.messages[0].content = JSON.stringify({ tree });
    const select = wpsWriteCellOperations("A1", "new marker")[4];
    expect(select(body)).toMatchObject({ action: "key", key: "a" });
    tree.children[1].focused = false;
    body.messages[0].content = JSON.stringify({ tree });
    expect(() => select(body)).toThrow(/keyboard focus/);
  });

  it("refuses content typing if navigation landed on another cell or stayed in the name box", () => {
    const write = wpsWriteCellOperations("A1", "new marker")[8];
    expect(() => write(observation({ address: "F17" }))).toThrow(
      /selected cell/,
    );
    expect(() => write(observation({ focused: true }))).toThrow(
      /leave the name box/,
    );
    expect(write(observation())).toEqual({
      action: "type",
      text: "new marker",
    });
  });

  it("does not count a matching marker in the wrong cell as successful readback", () => {
    expect(() =>
      assertWpsCell(observation({ address: "F18" }), "A1", "new marker"),
    ).toThrow(/selected address/);
    expect(() =>
      assertWpsCell(observation({ value: "old marker" }), "A1", "new marker"),
    ).toThrow(/formula bar readback/);
    expect(() =>
      assertWpsCell(observation(), "A1", "new marker"),
    ).not.toThrow();
  });
});
