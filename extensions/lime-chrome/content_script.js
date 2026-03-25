// 使用 IIFE 避免重复注入时的变量冲突
(function () {
  // 检查是否已经注入过
  if (
    window.__LIME_CONTENT_SCRIPT_LOADED__ ||
    window.__PROXYCAST_CONTENT_SCRIPT_LOADED__
  ) {
    return;
  }
  window.__LIME_CONTENT_SCRIPT_LOADED__ = true;
  window.__PROXYCAST_CONTENT_SCRIPT_LOADED__ = true;

  let refCounter = 0;
  const REF_ATTR = "lime-id";

  function nextRefId() {
    refCounter += 1;
    return `lime-${refCounter}`;
  }

  function resetRefs() {
    refCounter = 0;
    document.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => {
      el.removeAttribute(REF_ATTR);
    });
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isElementVisible(element) {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractiveElement(element) {
    if (!element || !isElementVisible(element)) {
      return false;
    }

    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    if (
      ["a", "button", "input", "textarea", "select", "option"].includes(tag)
    ) {
      return true;
    }
    if (
      role &&
      [
        "button",
        "link",
        "checkbox",
        "radio",
        "menuitem",
        "tab",
        "switch",
        "option",
        "searchbox",
        "textbox",
        "combobox",
      ].includes(role)
    ) {
      return true;
    }

    if (element.hasAttribute("onclick")) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return style.cursor === "pointer";
  }

  function interactiveLabel(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const text = normalizeText(
      element.innerText ||
        element.value ||
        element.placeholder ||
        element.getAttribute("aria-label") ||
        element.title ||
        element.name ||
        element.id,
    );

    if (tag === "a") {
      return `链接: ${text || "无标题链接"}`;
    }
    if (tag === "button" || role === "button") {
      return `按钮: ${text || "无标题按钮"}`;
    }
    if (tag === "input" || tag === "textarea") {
      return `输入框: ${text || "未命名输入框"}`;
    }
    if (tag === "select") {
      return `下拉框: ${text || "未命名下拉框"}`;
    }
    return `可交互元素: ${text || tag}`;
  }

  function buildMarkdown() {
    resetRefs();

    const lines = [];
    lines.push(`# ${document.title || "Untitled"}`);
    lines.push(`URL: ${window.location.href}`);
    lines.push("");

    const bodyText = normalizeText(
      document.body ? document.body.innerText : "",
    );
    if (bodyText) {
      lines.push("## 页面文本");
      lines.push(bodyText.slice(0, 6000));
      lines.push("");
    }

    lines.push("## 可交互元素");
    const allElements = Array.from(document.querySelectorAll("*")).filter(
      isInteractiveElement,
    );

    for (const element of allElements.slice(0, 300)) {
      const refId = nextRefId();
      element.setAttribute(REF_ATTR, refId);
      lines.push(`- [${interactiveLabel(element)}](${refId})`);
    }

    return lines.join("\n").trim();
  }

  function findElement(target) {
    if (!target || typeof target !== "string") {
      return null;
    }
    const trimmed = target.trim();
    if (!trimmed) {
      return null;
    }

    let element = document.querySelector(
      `[${REF_ATTR}="${CSS.escape(trimmed)}"]`,
    );
    if (element) {
      return element;
    }

    try {
      element = document.querySelector(trimmed);
      if (element) {
        return element;
      }
    } catch (_) {}

    element = Array.from(
      document.querySelectorAll(
        "button,a,input,textarea,select,[role='button']",
      ),
    ).find(
      (candidate) =>
        normalizeText(
          candidate.innerText || candidate.value || candidate.placeholder || "",
        ) === trimmed,
    );
    if (element) {
      return element;
    }

    element = Array.from(document.querySelectorAll("[aria-label]")).find(
      (candidate) =>
        normalizeText(candidate.getAttribute("aria-label")) === trimmed,
    );
    return element || null;
  }

  function scrollPage(text) {
    const input = normalizeText(text);
    let direction = "down";
    let amount = 500;

    if (input.includes(":")) {
      const parts = input.split(":");
      direction = normalizeText(parts[0]) || "down";
      const parsed = Number(parts[1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        amount = parsed;
      }
    }

    if (direction === "up") {
      window.scrollBy(0, -amount);
    } else if (direction === "left") {
      window.scrollBy(-amount, 0);
    } else if (direction === "right") {
      window.scrollBy(amount, 0);
    } else {
      window.scrollBy(0, amount);
    }
  }

  async function executeCommand(commandData) {
    const command = String(commandData.command || "").trim();
    const target = commandData.target;
    const text = commandData.text;
    const payload = commandData.payload;

    switch (command) {
      case "click": {
        const element = findElement(target);
        if (!element) {
          return { status: "error", error: `未找到点击目标: ${target}` };
        }
        element.click();
        return { status: "success", message: "click 执行成功" };
      }
      case "type": {
        const element = findElement(target);
        if (!element) {
          return { status: "error", error: `未找到输入目标: ${target}` };
        }
        const value = text == null ? "" : String(text);
        if ("value" in element) {
          element.focus();
          element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          element.textContent = value;
        }
        return { status: "success", message: "type 执行成功" };
      }
      case "scroll":
      case "scroll_page": {
        scrollPage(text);
        return { status: "success", message: "scroll 执行成功" };
      }
      case "get_page_info": {
        await sendPageInfo("get_page_info");
        return { status: "success", message: "页面信息已回传" };
      }
      case "refresh_page": {
        window.location.reload();
        return { status: "success", message: "页面刷新中" };
      }
      case "go_back": {
        window.history.back();
        return { status: "success", message: "执行后退" };
      }
      case "go_forward": {
        window.history.forward();
        return { status: "success", message: "执行前进" };
      }
      case "run_adapter": {
        const script = String(payload?.script || "").trim();
        if (!script) {
          return { status: "error", error: "run_adapter 缺少 script" };
        }
        try {
          const executor = new Function(`return ${script};`);
          const result = await executor();
          return {
            status: "success",
            message: "run_adapter 执行成功",
            data: result ?? null,
          };
        } catch (error) {
          return {
            status: "error",
            error: error?.message || String(error),
          };
        }
      }
      default:
        return { status: "error", error: `不支持的命令: ${command}` };
    }
  }

  async function sendPageInfo(reason) {
    const markdown = buildMarkdown();
    const payload = {
      type: "PAGE_INFO_UPDATE",
      data: {
        reason,
        title: document.title || "",
        url: window.location.href,
        markdown,
      },
    };
    await chrome.runtime.sendMessage(payload);
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const type = request?.type;

    if (type === "REQUEST_PAGE_CAPTURE") {
      sendPageInfo(request?.data?.reason || "manual")
        .then(() => sendResponse({ status: "success" }))
        .catch((error) =>
          sendResponse({
            status: "error",
            error: error?.message || String(error),
          }),
        );
      return true;
    }

    if (type === "EXECUTE_COMMAND") {
      executeCommand(request?.data || {})
        .then(async (result) => {
          if (request?.data?.wait_for_page_info === true) {
            setTimeout(() => {
              sendPageInfo("wait_for_page_info");
            }, 400);
          }
          sendResponse(result);
        })
        .catch((error) =>
          sendResponse({
            status: "error",
            error: error?.message || String(error),
          }),
        );
      return true;
    }

    return true;
  });

  setTimeout(() => {
    sendPageInfo("content_script_ready").catch(() => {});
  }, 800);
})(); // 结束 IIFE
