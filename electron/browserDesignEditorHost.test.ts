// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  fixture,
  message,
  native,
  presentation,
} from "./browserAnnotationEditorHost.testFixture";

const snapshot = {
  elementTagName: "button",
  declarations: [{ property: "color", value: "black", previousValue: "black" }],
};
const change = {
  declarations: [{ property: "color", value: "red", previousValue: "black" }],
};

describe("trusted design draft wire", () => {
  it("rejects forged baselines and same-revision design replacements while accepting design-only send", async () => {
    const f = fixture();
    const base = presentation();
    await f.show({
      ...base,
      body: "",
      revision: 0,
      designSnapshot: snapshot,
      designChange: null,
      labels: {
        ...base.labels,
        design: {
          title: "Design",
          text: "Text",
          reset: "Reset",
          invalid: "Invalid",
        },
      },
    });
    const view = native.views[0];
    message(view, { kind: "ready" });
    expect(f.events).toHaveLength(1);
    f.events.length = 0;
    const action = {
      kind: "action",
      action: "change",
      body: "",
      revision: 1,
      designChange: change,
    };
    message(view, {
      ...action,
      designChange: {
        declarations: [{ ...change.declarations[0], previousValue: "forged" }],
      },
    });
    message(view, action, {});
    expect(f.events).toEqual([]);
    message(view, action);
    expect(f.events).toHaveLength(1);
    message(view, { ...action, designChange: null });
    expect(f.events).toHaveLength(1);
    message(view, { ...action, action: "send" });
    expect(f.events.at(-1)).toMatchObject({
      action: "send",
      body: "",
      revision: 1,
      designChange: change,
    });
    message(view, { ...action, action: "send" });
    expect(f.events).toHaveLength(2);
    f.host.dispose();
  });
});
