//! 网络栈只包含本次专用网络。没有实例、EIP、NAT、脚本或用户凭据。

use super::*;

pub(super) fn stack_name(operation: &str) -> String {
    format!("Lime-network-{operation}")
}

pub(in crate::cloud_desktop_service::ecs) fn template(zone: &str, operation: &str) -> Value {
    let name = stack_name(operation);
    let tags = json!([{ "Key": "lime-operation", "Value": operation }]);
    json!({
        "ROSTemplateFormatVersion": "2015-09-01",
        "Resources": {
            "Vpc": { "Type": "ALIYUN::ECS::VPC", "Properties": {
                "VpcName": name, "CidrBlock": "10.76.0.0/16", "Tags": tags
            }},
            "Switch": { "Type": "ALIYUN::ECS::VSwitch", "Properties": {
                "VpcId": { "Ref": "Vpc" }, "ZoneId": zone,
                "VSwitchName": name, "CidrBlock": "10.76.0.0/24"
            }},
            "Group": { "Type": "ALIYUN::ECS::SecurityGroup", "Properties": {
                "VpcId": { "Ref": "Vpc" }, "SecurityGroupName": name,
                "SecurityGroupType": "normal", "Tags": tags,
                "SecurityGroupIngress": [],
                "SecurityGroupEgress": [{ "IpProtocol": "all", "PortRange": "-1/-1", "DestCidrIp": "0.0.0.0/0" }]
            }}
        },
        "Outputs": {
            "VpcId": { "Value": { "Ref": "Vpc" } },
            "VSwitchId": { "Value": { "Ref": "Switch" } },
            "SecurityGroupId": { "Value": { "Ref": "Group" } }
        }
    })
}
