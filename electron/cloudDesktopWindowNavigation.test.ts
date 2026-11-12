// @vitest-environment node
import { expect, it } from "vitest";
import { isCloudFrameNavigationAllowed } from "./cloudDesktopWindowFactory";

const renderer = "http://127.0.0.1:1420/index.html";
const viewer = "http://127.0.0.1:12345";
it("子页面只允许 Main 为当前窗口登记的桌面 Origin", () => {
  expect(
    isCloudFrameNavigationAllowed(
      viewer + "/vnc.html?view_only=true",
      false,
      renderer,
      viewer,
    ),
  ).toBe(true);
  expect(
    isCloudFrameNavigationAllowed(viewer + "/vnc.html", false, renderer),
  ).toBe(false);
  expect(
    isCloudFrameNavigationAllowed(
      "http://127.0.0.1:23456/vnc.html",
      false,
      renderer,
      viewer,
    ),
  ).toBe(false);
});
it.each([
  renderer,
  "http://127.0.0.1:1420/vnc.html",
  "file:///app/dist/index.html",
  "file:///Users/test/.ssh/id_ed25519",
  "https://supplier.invalid/",
  "javascript:alert(1)",
  "data:text/html,<p>untrusted</p>",
])("拒绝子页面逃逸或重定向到产品/本机页面：%s", (url) => {
  expect(isCloudFrameNavigationAllowed(url, false, renderer, viewer)).toBe(
    false,
  );
});
it("查看端点不能借开发服务器同源路径取得 parent bridge", () => {
  expect(
    isCloudFrameNavigationAllowed(
      "http://127.0.0.1:1420/vnc.html",
      false,
      renderer,
      "http://127.0.0.1:1420",
    ),
  ).toBe(false);
});
it("主页面继续只允许原产品入口", () => {
  expect(isCloudFrameNavigationAllowed(renderer, true, renderer, viewer)).toBe(
    true,
  );
  expect(
    isCloudFrameNavigationAllowed(viewer + "/vnc.html", true, renderer, viewer),
  ).toBe(false);
  expect(
    isCloudFrameNavigationAllowed(
      "file:///app/dist/index.html",
      false,
      "file:///app/dist/index.html",
      viewer,
    ),
  ).toBe(false);
});
