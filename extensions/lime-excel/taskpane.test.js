import fs from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

// Explicit Office.js contract fixture. These tests do not claim Excel live evidence.
function fixture() {
  const elements = new Map();
  let ready,
    syncCount = 0,
    writes = 0,
    failWrite = false;
  const ranges = new Map();
  const range = (address) => {
    if (!ranges.has(address)) {
      let values = [["initial"]];
      ranges.set(address, {
        rowCount: 1,
        columnCount: 1,
        address,
        load() {},
        get values() {
          return values;
        },
        set values(value) {
          writes++;
          values = value;
        },
        formulas: [[""]],
      });
    }
    return ranges.get(address);
  };
  const context = {
    workbook: {
      worksheets: {
        getItem() {
          return { getRange: range };
        },
        load() {},
        items: [{ name: "Sheet1", id: "sheet-1" }],
      },
    },
    async sync() {
      syncCount++;
      if (failWrite && syncCount === 2)
        throw new Error("partial write failure");
    },
  };
  const runtime = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id))
          elements.set(id, { textContent: "", hidden: true });
        return elements.get(id);
      },
    },
    Office: {
      onReady(callback) {
        ready = callback;
      },
      context: { displayLanguage: "en-US", document: { url: "" } },
      HostType: { Excel: "Excel" },
    },
    Excel: { run: async (callback) => callback(context) },
    location: { hash: "#fixture-only", pathname: "/taskpane.html" },
    history: { replaceState() {} },
    navigator: { language: "en-US" },
    crypto: { randomUUID: () => "workbook-1" },
    setTimeout() {
      return 1;
    },
    AbortSignal: { timeout() {} },
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url === "/api/connect" ? { sessionId: "session-1" } : { commands: [] },
    }),
  });
  vm.runInContext(
    fs.readFileSync("extensions/lime-excel/taskpane.js", "utf8"),
    runtime,
  );
  const evaluate = (code) => vm.runInContext(code, runtime);
  const execute = async (id, operation) => {
    runtime.command = {
      id,
      method: "execute",
      generation: 1,
      deadline: Date.now() + 30000,
      target: JSON.parse(evaluate("JSON.stringify(target)")),
      params: { operation, fence: 1 },
    };
    await evaluate("handle(command)");
    return JSON.parse(evaluate("JSON.stringify(replies.at(-1))"));
  };
  return {
    ready: (host = "Excel") => ready({ host }),
    evaluate,
    execute,
    elements,
    setFailure(value) {
      failWrite = value;
      syncCount = 0;
    },
    get writes() {
      return writes;
    },
  };
}

it("requires the Excel host and explicit workbook consent", async () => {
  const nonExcel = fixture();
  await nonExcel.ready("Word");
  expect(nonExcel.elements.get("status").textContent).toContain(
    "Microsoft Excel",
  );
  const f = fixture();
  await f.ready();
  const reply = await f.execute("unapproved", {
    action: "range_read",
    sheet: "Sheet1",
    address: "A1",
  });
  expect(reply.error).toContain("explicit user approval");
  expect(f.writes).toBe(0);
});
it("writes once per request ID and returns actual readback", async () => {
  const f = fixture();
  await f.ready();
  f.evaluate("granted=true");
  const op = {
    action: "range_write",
    sheet: "Sheet1",
    address: "A1",
    values: [["marker"]],
  };
  const first = await f.execute("same-id", op);
  const second = await f.execute("same-id", op);
  expect(first.result.status).toBe("written_and_read_back");
  expect(first.result.values).toEqual([["marker"]]);
  expect(second).toEqual(first);
  expect(f.writes).toBe(1);
});
it("blocks uncertain writes until the affected range has been read successfully", async () => {
  const f = fixture();
  await f.ready();
  f.evaluate("granted=true");
  f.setFailure(true);
  const op = {
    action: "range_write",
    sheet: "Sheet1",
    address: "A1",
    values: [["partial"]],
  };
  expect((await f.execute("partial-write", op)).error).toContain(
    "outcome_unknown",
  );
  f.setFailure(false);
  expect((await f.execute("blocked-write", op)).error).toContain(
    "read the affected range",
  );
  await f.execute("other-range", {
    action: "range_read",
    sheet: "Sheet1",
    address: "B1",
  });
  expect((await f.execute("still-blocked", op)).error).toContain(
    "read the affected range",
  );
  const read = await f.execute("affected-range", {
    action: "range_read",
    sheet: "Sheet1",
    address: "A1",
  });
  expect(read.result.values).toEqual([["partial"]]);
  expect((await f.execute("next-write", op)).result.status).toBe(
    "written_and_read_back",
  );
  expect(f.writes).toBe(2);
});
it("rejects another workbook and expired commands before Office execution", async () => {
  const f = fixture();
  await f.ready();
  f.evaluate("granted=true");
  f.evaluate('target.workbookId="changed"');
  const result = await f.execute("expired", {
    action: "range_read",
    sheet: "Sheet1",
    address: "A1",
  });
  expect(result.result.status).toBe("observed");
  f.evaluate(
    'command={id:"wrong-workbook",method:"execute",generation:1,deadline:Date.now()+1000,target:{type:"office",host:"Excel",workbookId:"other",sessionId:"session-1"},params:{fence:1,operation:{action:"range_write",sheet:"Sheet1",address:"A1",values:[[1]]}}}',
  );
  await f.evaluate("handle(command)");
  expect(f.evaluate("replies.at(-1).error")).toContain("target changed");
  expect(f.writes).toBe(0);
});
it("has all five product languages", () => {
  expect(fixture().evaluate("Object.keys(messages).join(',')")).toBe(
    "en,zh-CN,zh-TW,ja,ko",
  );
});
