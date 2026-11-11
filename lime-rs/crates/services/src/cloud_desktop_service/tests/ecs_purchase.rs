use super::*;
use app_server_protocol::protocol::v2::EcsDesktopSpec;
use std::os::unix::fs::PermissionsExt;

pub(super) fn fixture() -> (tempfile::TempDir, CloudDesktopService, EcsDesktopSpec) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, r#"#!/usr/bin/env python3
import json, pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
action = args[1]
def flag(name): return (root / name).exists()
def arg(name): return args[args.index(name)+1]
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
if action == 'DescribeLaunchTemplates':
 result = {'LaunchTemplateSets':{'LaunchTemplateSet':[{'LaunchTemplateId':'lt-test','LaunchTemplateName':'Linux desktop','DefaultVersionNumber':1,'CreatedBy':'must-not-project'}]},'TotalCount':1,'PageNumber':1}
 if flag('duplicate-templates'): result['LaunchTemplateSets']['LaunchTemplateSet'] *= 2; result['TotalCount']=2
elif action == 'DescribeLaunchTemplateVersions':
 data = {'VSwitchId':'vsw-test','SecurityGroupIds':{'SecurityGroupId':['sg-test']},'KeyPairName':'key-test','InstanceType':'ecs.test.large','ImageId':'ubuntu-test','SystemDisk.Size':80,'SystemDisk.Encrypted':'false','InternetMaxBandwidthOut':5,'DataDisks':{'DataDisk':[]},'NetworkInterfaces':{'NetworkInterface':[]}}
 if flag('template-userdata'): data['UserData']='must-not-project-secret'
 if flag('template-extra-disk'): data['DataDisks']['DataDisk']=[{'Size':100}]
 result = {'LaunchTemplateVersionSets':{'LaunchTemplateVersionSet':[{'LaunchTemplateId':'lt-test','LaunchTemplateName':'Linux desktop','VersionNumber':2 if flag('wrong-template-version') else 1,'LaunchTemplateData':data}]},'TotalCount':1}
elif action == 'DescribeVSwitchAttributes':
 result = {'VSwitchId':'vsw-test','Status':'Available','AvailableIpAddressCount':2,'ZoneId':'cn-test-a','VpcId':'vpc-test'}
 if flag('no-ip'): result['AvailableIpAddressCount']=0
elif action == 'DescribeSecurityGroupAttribute':
 result = {'SecurityGroupId':'sg-test','RegionId':'cn-test','VpcId':'vpc-other' if flag('wrong-vpc') else 'vpc-test'}
elif action == 'DescribeImages':
 result = {'Images':{'Image':[{'ImageId':'ubuntu-test','Status':'Available','OSType':'linux','Architecture':'arm64' if flag('arm-image') else 'x86_64','Platform':'Ubuntu','ImageOwnerAlias':'marketplace' if flag('market-image') else 'system','Size':40}]},'TotalCount':1}
elif action == 'DescribeInstanceTypes':
 result = {'InstanceTypes':{'InstanceType':[{'InstanceTypeId':'ecs.test.large','CpuArchitecture':'ARM' if flag('arm-type') else 'X86','GPUAmount':1 if flag('gpu') else 0,'CpuCoreCount':2,'MemorySize':4}]}}
elif action == 'DescribeKeyPairs':
 result = {'KeyPairs':{'KeyPair':[{'KeyPairName':'key-test','PublicKey':'must-not-project'}]},'TotalCount':1}
elif action == 'DescribePrice':
 result = {'PriceInfo':{'Price':{'TradePrice':0.9 if flag('price-changed') else 0.8,'Currency':'CNY'}}}
elif action == 'RunInstances':
 (root/'created').write_text(arg('--ClientToken'))
 if flag('lost-response'): sys.exit(1)
 result = {'InstanceIdSets':{'InstanceIdSet':['i-test','i-extra'] if flag('multiple-created') else ['i-test']},'RequestId':'request-test'}
elif action == 'DescribeInstances':
 if flag('query-failed') and '--Tag.1.Key' in args: sys.exit(1)
 created = (root/'created').read_text() if flag('created') else 'operation-1'
 item = {'InstanceId':'i-test','RegionId':'cn-test','InstanceName':'Lime-test','Status':'Running','ImageId':'ubuntu-test','InstanceType':'ecs.test.large','KeyPairName':'key-test','InstanceChargeType':'PostPaid','InternetChargeType':'PayByTraffic','InternetMaxBandwidthOut':5,'VpcAttributes':{'VSwitchId':'vsw-test'},'SecurityGroupIds':{'SecurityGroupId':['sg-test']},'Tags':{'Tag':[{'TagKey':'lime-operation','TagValue':'other' if flag('wrong-tag') else created}]}}
 if flag('wrong-instance-spec'): item['ImageId']='other-image'
 items = [item] if (flag('created') and not flag('invisible')) or flag('existing') else []
 if flag('duplicate-matches') and items: items.append(item.copy())
 result = {'Instances':{'Instance':items},'TotalCount':9 if flag('bad-count') else len(items)}
 if flag('pagination'): result['NextToken']='next'
elif action == 'DescribeDisks':
 result = {'Disks':{'Disk':[{'DiskId':'d-test','InstanceId':'i-test','Type':'system','Encrypted':not flag('unencrypted'),'Category':'cloud_essd','PerformanceLevel':'PL1','Size':80}]},'TotalCount':1}
else: sys.exit(2)
print(json.dumps(result))
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    let spec = EcsDesktopSpec {
        region_id: "cn-test".into(),
        profile: "lime".into(),
        v_switch_id: "vsw-test".into(),
        security_group_id: "sg-test".into(),
        key_pair_name: "key-test".into(),
        instance_type: "ecs.test.large".into(),
        image_id: "ubuntu-test".into(),
        system_disk_gib: 80,
        outbound_mbps: 5,
    };
    (directory, service, spec)
}

async fn purchase_request(
    service: &CloudDesktopService,
    spec: EcsDesktopSpec,
) -> CloudDesktopParams {
    let quote = service
        .request(CloudDesktopParams::QuoteEcs { spec: spec.clone() })
        .await
        .unwrap()
        .data;
    let id = quote["quoteId"].as_str().unwrap();
    assert_eq!(quote["quote"]["price"]["systemDiskEncrypted"], true);
    assert!(!quote.to_string().contains("must-not-project"));
    CloudDesktopParams::PurchaseEcs {
        spec,
        desktop_name: "Lime-test".into(),
        operation_id: "operation-1".into(),
        quote_id: id.into(),
        confirmation: format!("purchase:ecs:cn-test:Lime-test:{id}"),
    }
}

fn calls(directory: &Path) -> Vec<Vec<String>> {
    fs::read_to_string(directory.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[tokio::test]
async fn encrypted_single_purchase_binds_only_verified_instance_and_never_resubmits() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    let receipt = service.request(request.clone()).await.unwrap().data;
    assert_eq!(receipt["outcome"], "provisioned");
    assert_eq!(receipt["desktopReady"], false);
    assert_eq!(receipt["observedAfter"]["systemDiskEncrypted"], true);
    service.request(request).await.unwrap();
    let calls = calls(directory.path());
    let purchases: Vec<_> = calls
        .iter()
        .filter(|args| args[1] == "RunInstances")
        .collect();
    assert_eq!(purchases.len(), 1);
    let args = purchases[0];
    for (key, value) in [
        ("--Amount", "1"),
        ("--MinAmount", "1"),
        ("--AutoRenew", "false"),
        ("--SystemDisk.Encrypted", "true"),
        ("--InstanceChargeType", "PostPaid"),
        ("--InternetChargeType", "PayByTraffic"),
        ("--ClientToken", "operation-1"),
        ("--version", "2014-05-26"),
    ] {
        assert!(args.windows(2).any(|pair| pair == [key, value]));
    }
    assert!(!args
        .iter()
        .any(|arg| ["--Password", "--UserData"].contains(&arg.as_str())));
    assert_eq!(
        service.list_resources().unwrap()["resources"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn lost_response_survives_restart_and_profile_alias_cannot_bypass_unknown() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec.clone()).await;
    fs::write(directory.path().join("lost-response"), "").unwrap();
    fs::write(directory.path().join("query-failed"), "").unwrap();
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    let mut alias = spec.clone();
    alias.profile = "same-account-alias".into();
    let mut retry = purchase_request(&service, alias).await;
    if let CloudDesktopParams::PurchaseEcs { operation_id, .. } = &mut retry {
        *operation_id = "operation-2".into();
    }
    assert!(service
        .request(retry)
        .await
        .unwrap_err()
        .contains("already exists"));
    // Restore the read path without deleting the failed evidence or repeating RunInstances.
    fs::rename(
        directory.path().join("query-failed"),
        directory.path().join("query-failed-resolved"),
    )
    .unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let receipt = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "operation-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(receipt["outcome"], "provisioned");
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|args| args[1] == "RunInstances")
            .count(),
        1
    );
}

#[tokio::test]
async fn inventory_and_price_failures_never_submit() {
    for flag in [
        "no-ip",
        "wrong-vpc",
        "arm-image",
        "market-image",
        "arm-type",
        "gpu",
        "price-changed",
        "existing",
        "bad-count",
        "pagination",
    ] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join(flag), "").unwrap();
        let result = service.request(request).await.unwrap().data;
        assert_eq!(result["outcome"], "notSubmitted", "{flag}");
        assert_eq!(result["submitted"], false);
        assert!(!service.root.join("operation-1.json").exists());
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|args| args[1] == "RunInstances")
                .count(),
            0,
            "{flag}"
        );
    }
}

#[tokio::test]
async fn malformed_or_mismatched_results_are_not_bound_or_repurchased() {
    for flag in [
        "unencrypted",
        "wrong-tag",
        "wrong-instance-spec",
        "duplicate-matches",
        "invisible",
    ] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join(flag), "").unwrap();
        let receipt = service.request(request.clone()).await.unwrap().data;
        assert_ne!(receipt["outcome"], "provisioned", "{flag}");
        service.request(request).await.unwrap();
        assert!(
            service.list_resources().unwrap()["resources"]
                .as_array()
                .unwrap()
                .is_empty(),
            "{flag}"
        );
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|args| args[1] == "RunInstances")
                .count(),
            1,
            "{flag}"
        );
    }
}

#[tokio::test]
async fn malformed_purchase_response_can_only_recover_by_exact_tag() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    fs::write(directory.path().join("multiple-created"), "").unwrap();
    fs::write(directory.path().join("query-failed"), "").unwrap();
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    service.request(request).await.unwrap();
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|args| args[1] == "RunInstances")
            .count(),
        1
    );
}

#[tokio::test]
async fn confirmation_expiry_tampering_and_consumed_quote_fail_closed() {
    for case in ["confirmation", "expiry", "tamper"] {
        let (_directory, service, spec) = fixture();
        let mut request = purchase_request(&service, spec).await;
        if let CloudDesktopParams::PurchaseEcs {
            confirmation,
            quote_id,
            ..
        } = &mut request
        {
            if case == "confirmation" {
                *confirmation = "yes".into();
            } else {
                let path = service.root.join(format!("quote-{quote_id}.json"));
                let mut quote: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                if case == "expiry" {
                    quote["expiresAt"] = json!("2000-01-01T00:00:00Z");
                } else {
                    quote["price"]["hourlyPrice"] = json!(0.01);
                }
                fs::write(path, serde_json::to_vec(&quote).unwrap()).unwrap();
            }
        }
        if case == "confirmation" {
            assert!(service.request(request).await.is_err());
        } else {
            assert_eq!(
                service.request(request).await.unwrap().data["outcome"],
                "notSubmitted"
            );
        }
    }
    let (_directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    service.request(request.clone()).await.unwrap();
    let mut retry = request;
    if let CloudDesktopParams::PurchaseEcs {
        operation_id,
        desktop_name,
        confirmation,
        quote_id,
        ..
    } = &mut retry
    {
        *operation_id = "operation-2".into();
        *desktop_name = "Other-name".into();
        *confirmation = format!("purchase:ecs:cn-test:Other-name:{quote_id}");
    }
    assert!(service
        .request(retry)
        .await
        .unwrap_err()
        .contains("already exists"));
    let path = service.root.join("operation-1.json");
    let mut receipt: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    receipt["observedAfter"]["systemDiskEncrypted"] = json!(false);
    fs::write(path, serde_json::to_vec(&receipt).unwrap()).unwrap();
    assert!(service.read_receipt("operation-1").is_err());
}
