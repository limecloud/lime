import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserPasswordAutofill } from "./browserPasswordAutofillPage";

function createForm(usernameValue = "", passwordValue = "") {
  const form = document.createElement("form");
  const username = document.createElement("input");
  username.type = "text";
  username.autocomplete = "username";
  username.value = usernameValue;
  const password = document.createElement("input");
  password.type = "password";
  password.value = passwordValue;
  form.append(username, password);
  document.body.append(form);
  return { form, username, password };
}

async function focusPassword(input: HTMLInputElement) {
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = "";
  document.removeEventListener("focusin", () => undefined, true);
});

describe("installBrowserPasswordAutofill", () => {
  it("聚焦密码框时填充用户名和密码并派发事件", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([{ username: "alice", password: "secret" }]);
    const cleanup = installBrowserPasswordAutofill({ invoke });
    const { username, password } = createForm();
    const input = vi.fn();
    username.addEventListener("input", input);
    await focusPassword(password);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(username.value).toBe("alice");
    expect(password.value).toBe("secret");
    expect(input).toHaveBeenCalled();
    cleanup();
  });

  it("没有凭据或已有值时不再填充", async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    installBrowserPasswordAutofill({ invoke });
    const first = createForm();
    await focusPassword(first.password);
    expect(first.password.value).toBe("");
    const second = createForm("existing");
    invoke.mockResolvedValue([{ username: "bob", password: "two" }]);
    await focusPassword(second.password);
    expect(second.username.value).toBe("existing");
    expect(second.password.value).toBe("");
  });

  it("没有 form 时在最近容器内填充", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([{ username: "alice", password: "secret" }]);
    installBrowserPasswordAutofill({ invoke });
    const wrapper = document.createElement("div");
    const username = document.createElement("input");
    username.type = "text";
    const password = document.createElement("input");
    password.type = "password";
    wrapper.append(username, password);
    document.body.append(wrapper);
    await focusPassword(password);
    expect(username.value).toBe("alice");
    expect(password.value).toBe("secret");
  });

  it("同一表单只尝试一次", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue([{ username: "alice", password: "secret" }]);
    installBrowserPasswordAutofill({ invoke });
    const { password } = createForm();
    await focusPassword(password);
    password.value = "";
    await focusPassword(password);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
