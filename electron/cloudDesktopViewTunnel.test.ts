// @vitest-environment node
import { expect, it, vi } from "vitest";
import { resolveCloudDesktopViewTunnel } from "./cloudDesktopTaskTunnel";

const resource = {
  provider: "ecs" as const,
  profile: "owned",
  regionId: "cn-test",
  resourceId: "i-test",
};
const listening = (endpoint: unknown) => ({
  data: { channel: "desktop", state: "listening", persistent: false, endpoint },
});

it("只显式打开同一资源的 desktop 通道，不重启任务或申请接管", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(listening("http://127.0.0.1:12345/vnc.html"));
  await expect(resolveCloudDesktopViewTunnel(request, resource)).resolves.toBe(
    "http://127.0.0.1:12345/vnc.html",
  );
  expect(request).toHaveBeenCalledExactlyOnceWith({
    action: "openEcsTunnel",
    resource,
    channel: "desktop",
  });
});

it.each([
  "https://supplier.invalid/?token=private-value",
  "http://localhost:12345/vnc.html",
  "http://127.0.0.1:0/vnc.html",
  "http://127.0.0.1:12345/other.html",
  "http://127.0.0.1:12345/vnc.html?password=private-value",
  "http://user:private-value@127.0.0.1:12345/vnc.html",
  "file:///tmp/private-value",
  undefined,
])("拒绝不可信端点且错误不包含原地址：%s", async (endpoint) => {
  const request = vi.fn().mockResolvedValue(listening(endpoint));
  await expect(
    resolveCloudDesktopViewTunnel(request, resource),
  ).rejects.toThrow(/^CLOUD_DESKTOP_VIEW_FAILED$/);
});

it.each([
  {
    ...listening("http://127.0.0.1:12345/vnc.html").data,
    channel: "appServer",
  },
  { ...listening("http://127.0.0.1:12345/vnc.html").data, persistent: true },
  {
    ...listening("http://127.0.0.1:12345/vnc.html").data,
    connectionFailed: true,
  },
  { state: "closed", channel: "desktop" },
])("校验通道状态后才允许嵌入", async (data) => {
  await expect(
    resolveCloudDesktopViewTunnel(
      vi.fn().mockResolvedValue({ data }),
      resource,
    ),
  ).rejects.toThrow(/^CLOUD_DESKTOP_VIEW_FAILED$/);
});

it("将安全组拒绝转换为固定提示，既不改规则也不重试", async () => {
  const request = vi
    .fn()
    .mockRejectedValue(
      new Error(
        "ErrorCode=InvalidOperation.SecurityGroupRuleDenied private-value",
      ),
    );
  await expect(
    resolveCloudDesktopViewTunnel(request, resource),
  ).rejects.toThrow(/^ECS_SECURITY_GROUP_DENIED$/);
  expect(request).toHaveBeenCalledTimes(1);
});
