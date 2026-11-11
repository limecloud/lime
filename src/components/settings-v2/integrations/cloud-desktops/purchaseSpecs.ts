import type {
  EcsDesktopSpec,
  WuyingDesktopSpec,
} from "@limecloud/app-server-client";

export const initialEcsSpec: EcsDesktopSpec = {
  profile: "",
  regionId: "cn-hangzhou",
  vSwitchId: "",
  securityGroupId: "",
  keyPairName: "",
  instanceType: "",
  imageId: "",
  systemDiskGib: 80,
  outboundMbps: 5,
};

export const initialWuyingSpec: WuyingDesktopSpec = {
  profile: "",
  regionId: "",
  officeSiteId: "",
  endUserId: "",
  policyGroupId: "",
  desktopType: "eds.enterprise_office.4c8g",
  imageId: "desktopimage-ubuntu-2404-asp",
  systemDiskGib: 80,
  dataDiskGib: 0,
};
