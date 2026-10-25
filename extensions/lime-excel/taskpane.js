/* global Office, Excel */
const messages = {
  en: [
    "Connect this workbook to Lime Desktop or CLI.",
    "Connected",
    "Allow Lime to read and edit this workbook for this session?",
    "Allow workbook",
    "Deny",
    "Disconnect",
    "Open this add-in in Microsoft Excel.",
    "Untitled workbook",
    "Connection failed. Reopen the add-in to reconnect.",
  ],
  "zh-CN": [
    "将此工作簿连接到 Lime 桌面或 CLI。",
    "已连接",
    "允许 Lime 在本次会话中读取和编辑此工作簿？",
    "允许此工作簿",
    "拒绝",
    "断开连接",
    "请在 Microsoft Excel 中打开此加载项。",
    "未命名工作簿",
    "连接失败，请重新打开加载项。",
  ],
  "zh-TW": [
    "將此活頁簿連線至 Lime 桌面或 CLI。",
    "已連線",
    "允許 Lime 在本次工作階段中讀取和編輯此活頁簿？",
    "允許此活頁簿",
    "拒絕",
    "中斷連線",
    "請在 Microsoft Excel 中開啟此增益集。",
    "未命名活頁簿",
    "連線失敗，請重新開啟增益集。",
  ],
  ja: [
    "このブックを Lime デスクトップまたは CLI に接続します。",
    "接続済み",
    "このセッションで Lime にこのブックの読み取りと編集を許可しますか？",
    "このブックを許可",
    "拒否",
    "切断",
    "Microsoft Excel でこのアドインを開いてください。",
    "名前のないブック",
    "接続できません。アドインを開き直してください。",
  ],
  ko: [
    "이 통합 문서를 Lime 데스크톱 또는 CLI에 연결합니다.",
    "연결됨",
    "이 세션에서 Lime이 이 통합 문서를 읽고 편집하도록 허용할까요?",
    "통합 문서 허용",
    "거부",
    "연결 끊기",
    "Microsoft Excel에서 이 추가 기능을 여세요.",
    "제목 없는 통합 문서",
    "연결하지 못했습니다. 추가 기능을 다시 여세요.",
  ],
};
let labels = messages.en;
let sessionId,
  target,
  stopped = false,
  granted = false,
  uncertain = null;
let generation = 1,
  fence = 0;
let replies = [];
const pending = new Map();
const outcomes = new Map();
const byId = (id) => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(labels[8]);
  return response.json();
}
function snapshot() {
  return {
    generation,
    readiness: "ready",
    reason: null,
    setupSteps: [],
    targets: [
      {
        identity: target,
        nativeApp: null,
        locked: false,
        capabilities: [
          "observe",
          "workbook_read",
          "range_read",
          "range_write",
          "formula_write",
        ],
      },
    ],
  };
}
function check(command, approval = true) {
  if (
    stopped ||
    command.canceled ||
    command.deadline <= Date.now() ||
    command.generation !== generation ||
    JSON.stringify(command.target) !== JSON.stringify(target)
  )
    throw new Error(
      "Document target changed or command canceled; outcome_unknown",
    );
  if (approval && !granted)
    throw new Error("Workbook requires explicit user approval");
}
function approve(value) {
  for (const command of pending.values()) {
    if (command.method !== "setup") continue;
    try {
      check(command, false);
      granted = value;
      command.resolve({ accepted: value });
    } catch (error) {
      command.reject(error);
    }
  }
  byId("approval").hidden = true;
}
async function handle(command) {
  if (pending.has(command.id)) return;
  if (outcomes.has(command.id)) {
    replies.push(outcomes.get(command.id));
    return;
  }
  pending.set(command.id, command);
  let reply;
  try {
    check(command, command.method !== "setup");
    let result;
    if (command.method === "setup") {
      result = await new Promise((resolve, reject) => {
        Object.assign(command, { resolve, reject });
        byId("approval").hidden = false;
        setTimeout(
          () => {
            if (pending.has(command.id)) {
              resolve({ accepted: false });
              byId("approval").hidden = true;
            }
          },
          Math.max(0, command.deadline - Date.now()),
        );
      });
    } else if (command.method === "execute") {
      if (
        !Number.isSafeInteger(command.params.fence) ||
        command.params.fence < fence
      )
        throw new Error("Stale control fence");
      fence = command.params.fence;
      result = await execute(command);
    } else throw new Error("Unsupported document operation");
    reply = { id: command.id, result };
  } catch (error) {
    reply = { id: command.id, error: error.message };
  } finally {
    pending.delete(command.id);
  }
  outcomes.set(command.id, reply);
  if (outcomes.size > 256) outcomes.delete(outcomes.keys().next().value);
  replies.push(reply);
}
async function execute(command) {
  const operation = command.params.operation;
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    if (["observe", "workbook_read"].includes(operation.action)) {
      sheets.load("items/name,items/id");
      await context.sync();
      check(command);
      return {
        executorSessionId: sessionId,
        workbook: target,
        sheets: sheets.items.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
        })),
        schema: {
          operations: ["range_read", "range_write", "formula_write"],
          maxCells: 1000,
          requires: ["sheet", "address"],
          idempotencyKey: command.id,
        },
      };
    }
    if (
      !["range_read", "range_write", "formula_write"].includes(
        operation.action,
      ) ||
      !/^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/.test(
        operation.address,
      )
    )
      throw new Error("Unsupported or invalid range operation");
    const range = sheets.getItem(operation.sheet).getRange(operation.address);
    range.load("rowCount,columnCount");
    await context.sync();
    check(command);
    if (range.rowCount * range.columnCount > 1000)
      throw new Error("Range exceeds 1000 cells");
    const writing = operation.action !== "range_read";
    if (writing) {
      if (uncertain)
        throw new Error(
          "Previous write outcome_unknown; read the affected range before writing again",
        );
      const values =
        operation.action === "formula_write"
          ? operation.formulas
          : operation.values;
      if (
        values.length !== range.rowCount ||
        values.some((row) => row.length !== range.columnCount)
      )
        throw new Error("Range dimensions do not match values");
      uncertain = { sheet: operation.sheet, address: operation.address };
      if (operation.action === "formula_write") range.formulas = values;
      else range.values = values;
      try {
        await context.sync();
      } catch (error) {
        throw new Error(
          `outcome_unknown; read the affected range before retrying: ${error.message}`,
        );
      }
      check(command);
    }
    range.load("address,values,formulas");
    try {
      await context.sync();
    } catch (error) {
      throw new Error(`Readback failed; outcome_unknown: ${error.message}`);
    }
    check(command);
    if (
      uncertain?.sheet === operation.sheet &&
      uncertain.address === operation.address
    )
      uncertain = null;
    return {
      status: writing ? "written_and_read_back" : "observed",
      executorSessionId: sessionId,
      idempotencyKey: command.id,
      address: range.address,
      values: range.values,
      formulas: range.formulas,
    };
  });
}
async function poll() {
  if (stopped) return;
  try {
    const message = await post("/api/poll", {
      sessionId,
      snapshot: snapshot(),
      responses: replies.splice(0, 16),
    });
    for (const id of message.cancels || []) {
      const command = pending.get(id);
      if (command) {
        command.canceled = true;
        command.resolve?.({ accepted: false });
      }
    }
    for (const command of message.commands || []) void handle(command);
    setTimeout(poll, 200);
  } catch (error) {
    stopped = true;
    granted = false;
    byId("error").textContent = error.message;
  }
}
Office.onReady(async (info) => {
  const locale = Office.context.displayLanguage || navigator.language;
  labels = messages[locale] || messages[locale.split("-")[0]] || messages.en;
  for (const [id, index] of [
    ["description", 0],
    ["question", 2],
    ["allow", 3],
    ["deny", 4],
    ["disconnect", 5],
  ])
    byId(id).textContent = labels[index];
  if (info.host !== Office.HostType.Excel) {
    byId("status").textContent = labels[6];
    return;
  }
  try {
    ({ sessionId } = await post("/api/connect"));
    target = {
      type: "office",
      host: "Excel",
      workbookId: crypto.randomUUID(),
      sessionId,
      workbookName: Office.context.document.url.split("/").pop() || labels[7],
    };
    byId("status").textContent = labels[1];
    byId("workbook").textContent = target.workbookName;
    byId("allow").onclick = () => approve(true);
    byId("deny").onclick = () => approve(false);
    byId("disconnect").hidden = false;
    byId("disconnect").onclick = () => {
      approve(false);
      stopped = true;
      granted = false;
      generation++;
      void post("/api/disconnect", { sessionId }).catch(() => {});
      byId("status").textContent = labels[5];
    };
    await poll();
  } catch (error) {
    byId("error").textContent = error.message;
  }
});
