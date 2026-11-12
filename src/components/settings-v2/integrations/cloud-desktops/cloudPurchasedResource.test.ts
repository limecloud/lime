import { expect, it } from "vitest";
import { cloudPurchasedResource } from "./cloudPurchasedResource";
import { initialEcsSpec, initialWuyingSpec } from "./purchaseSpecs";

const context = {
  operationId: "purchase-test",
  desktopName: "Lime-test",
  spec: {
    ...initialEcsSpec,
    profile: "user",
    regionId: "cn-test",
    imageId: "m-restored",
  },
};
function receipt() {
  return {
    outcome: "provisioned",
    operationId: context.operationId,
    requiresInspection: false,
    instanceId: "i-created",
    request: {
      action: "purchaseEcs",
      spec: { ...context.spec },
      desktopName: context.desktopName,
    },
    observedAfter: {
      operationId: context.operationId,
      instanceId: "i-created",
      desktopName: context.desktopName,
      spec: { ...context.spec },
      systemDiskId: "d-created",
      systemDiskEncrypted: true,
      chargeType: "PostPaid",
    },
  };
}

it("只从原操作和原规格已核验的采购收据投影精确资源，不推断镜像已安装", () => {
  expect(cloudPurchasedResource(receipt(), context)).toEqual({
    provider: "ecs",
    profile: "user",
    regionId: "cn-test",
    resourceId: "i-created",
  });
});

it.each([
  ["outcome", "unknown"],
  ["requiresInspection", true],
  ["operationId", "other-operation"],
  ["instanceId", "i-other"],
  ["instanceId", "../../unexpected"],
])("拒绝不完整或错配收据 %s=%s", (key, value) => {
  expect(
    cloudPurchasedResource({ ...receipt(), [key]: value }, context),
  ).toBeUndefined();
});

it.each([
  ["instanceId", "i-other"],
  ["operationId", "other-operation"],
  ["systemDiskId", ""],
  ["systemDiskEncrypted", false],
  ["chargeType", "PrePaid"],
  ["desktopName", "Lime-other"],
])("拒绝缺少或错配的供应商核验 %s=%s", (key, value) => {
  const original = receipt();
  expect(
    cloudPurchasedResource(
      {
        ...original,
        observedAfter: {
          ...original.observedAfter,
          [key]: value,
        },
      },
      context,
    ),
  ).toBeUndefined();
});

it.each(["profile", "regionId", "imageId", "systemDiskGib"])(
  "原请求或核验规格 %s 错配时不接续其他资源",
  (key) => {
    for (const field of ["request", "observedAfter"] as const) {
      const original = receipt();
      const changed = {
        ...original,
        [field]: {
          ...original[field],
          spec: { ...original[field].spec, [key]: "other" },
        },
      };
      expect(cloudPurchasedResource(changed, context)).toBeUndefined();
    }
  },
);

it("无影及缺失供应商证明不被投影为 ECS", () => {
  expect(
    cloudPurchasedResource(receipt(), { ...context, spec: initialWuyingSpec }),
  ).toBeUndefined();
  expect(
    cloudPurchasedResource(
      { outcome: "provisioned", request: { action: "purchaseEcs" } },
      context,
    ),
  ).toBeUndefined();
});
