document.documentElement.lang = chrome.i18n.getUILanguage();
document.querySelectorAll("[data-i18n]").forEach((node) => {
  node.textContent = chrome.i18n.getMessage(node.dataset.i18n);
});
const request = new URL(location.href).searchParams.get("request");
document.querySelector("#task-tabs").hidden = Boolean(request);
document.querySelector("#session-name").value = "🔎 Lime";
async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "state", request });
  document.querySelector("#status").textContent = chrome.i18n.getMessage(
    state.connected ? "connected" : "disconnected",
  );
  document.querySelector("#target").textContent = state.target
    ? `${state.target.origin}\n${state.target.url}`
    : state.error || "";
  document.querySelector("#approval").hidden = !state.pending;
  document.querySelector("#reconnect").hidden = Boolean(state.connected);
}
for (const [id, accepted] of [
  ["allow", true],
  ["deny", false],
])
  document.getElementById(id).onclick = async () => {
    await chrome.runtime.sendMessage({ type: "approve", request, accepted });
    window.close();
  };
document.querySelector("#reconnect").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "reconnect" });
  await refresh();
};
void refresh();
document.querySelector("#task-tabs").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "createTab",
      name: document.querySelector("#session-name").value,
      url: document.querySelector("#session-url").value,
    });
    document.querySelector("#group-status").textContent =
      chrome.i18n.getMessage(result.error || "groupCreated");
  } catch {
    document.querySelector("#group-status").textContent =
      chrome.i18n.getMessage("groupFailed");
  } finally {
    button.disabled = false;
  }
};
