// Test-only WPS actions derived from each canonical observation, never stale geometry.
import assert from "node:assert/strict";

const nodes = (node) => [node, ...(node.children || []).flatMap(nodes)];

export function wpsObservation(body) {
  const message = body.messages.findLast((entry) => entry.role === "tool");
  assert(message, "canonical WPS observation must reach the provider");
  const trees = [];
  const visit = (value) => {
    if (typeof value === "string") {
      try {
        visit(JSON.parse(value));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if (value.tree?.role === "AXWindow") trees.push(value.tree);
      else Object.values(value).forEach(visit);
    }
  };
  visit(message.content);
  assert.equal(trees.length, 1, "one current WPS AX window observation");
  const tree = trees[0];
  const boxes = nodes(tree).filter(
    (node) =>
      node.role === "AXTextField" &&
      node.enabled === true &&
      /^[A-Z]+[1-9][0-9]*$/.test(node.value || ""),
  );
  assert.equal(boxes.length, 1, "unambiguous current WPS name box");
  const nameBox = boxes[0];
  const parent = nodes(tree).find((node) => node.children?.includes(nameBox));
  // WPS/Qt reports keyboard focus on the name box's immediate split group.
  const nameBoxFocused =
    nameBox.focused === true ||
    (parent?.role === "AXSplitGroup" && parent.focused === true);
  return { tree, nameBox, nameBoxFocused };
}

export function assertWpsCell(body, address, text) {
  const { tree, nameBox } = wpsObservation(body);
  assert.equal(nameBox.value, address, "WPS selected address after input");
  const values = nodes(tree).filter((node) => node.role === "AXTextArea");
  assert.equal(values.length, 1, "unambiguous WPS formula bar");
  assert.equal(values[0].value, text, `WPS ${address} formula bar readback`);
}

export function wpsWriteCellOperations(address, text, onSelected) {
  const key = (key, modifiers = []) => ({ action: "key", key, modifiers });
  const observe = { action: "observe", max_depth: 8, max_nodes: 256 };
  return [
    // Activate WPS before observing: activation can reveal a banner and reflow controls.
    key("escape"),
    observe,
    (body) => {
      const { tree, nameBox } = wpsObservation(body);
      assert(tree.frame && nameBox.frame, "current WPS name box geometry");
      return {
        action: "click",
        x: nameBox.frame.x - tree.frame.x + nameBox.frame.width / 2,
        y: nameBox.frame.y - tree.frame.y + nameBox.frame.height / 2,
        button: "left",
        count: 1,
      };
    },
    observe,
    (body) => {
      assert.equal(
        wpsObservation(body).nameBoxFocused,
        true,
        "name box must own keyboard focus before typing an address",
      );
      return key("a", ["command"]);
    },
    { action: "type", text: address },
    key("enter"),
    observe,
    (body) => {
      const { nameBox, nameBoxFocused } = wpsObservation(body);
      assert.equal(
        nameBox.value,
        address,
        "verify selected cell before submitting its content",
      );
      assert.equal(
        nameBoxFocused,
        false,
        "cell navigation must leave the name box",
      );
      onSelected?.({ address, nameBox: nameBox.frame });
      return { action: "type", text };
    },
    key("enter"),
    key("up"),
    observe,
  ];
}
