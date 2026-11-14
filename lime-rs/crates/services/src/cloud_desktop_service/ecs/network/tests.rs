use super::*;
use std::os::unix::fs::PermissionsExt;

pub(in crate::cloud_desktop_service::ecs) fn fixture() -> (tempfile::TempDir, CloudDesktopService) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, r#"#!/usr/bin/env python3
import json,pathlib,sys
root=pathlib.Path(__file__).parent
args=sys.argv[1:]; action=args[1]
def arg(key): return args[args.index(key)+1]
def flag(key): return (root/key).exists()
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
def image(): return {'ImageId':'ubuntu_24_04','ImageName':'ubuntu_24_04_x64','Architecture':'x86_64','Platform':'Ubuntu','OSType':'linux','ImageOwnerAlias':'system','Status':'Available','Size':40,'CreationTime':'2026-11-01T00:00:00Z'}
if action=='DescribeImages': out={'Images':{'Image':[image()]},'TotalCount':1}
elif action=='DescribeRecommendInstanceType':
 out={'Data':{'RecommendInstanceType':[{'RegionId':'cn-test','InstanceChargeType':'PostPaid','NetworkType':'vpc','SpotStrategy':'NoSpot','ZoneId':'cn-test-a','InstanceType':{'InstanceType':kind}} for kind in ['ecs.test.large','ecs.cheaper.large','ecs.arm.large']]}}
elif action=='DescribeInstanceTypes':
 kinds=[arg(key) for key in args if key.startswith('--InstanceTypes.')]
 out={'InstanceTypes':{'InstanceType':[{'InstanceTypeId':kind,'CpuArchitecture':'ARM' if kind=='ecs.arm.large' else 'X86','GPUAmount':0,'CpuCoreCount':2,'MemorySize':4,'InstanceFamilyLevel':'EnterpriseLevel'} for kind in kinds]}}
elif action=='DescribeAvailableResource':
 assert arg('--NetworkCategory')=='vpc'
 out={'AvailableZones':{'AvailableZone':[{'ZoneId':'cn-test-a','Status':'Available','AvailableResources':{'AvailableResource':[{'Type':'InstanceType','SupportedResources':{'SupportedResource':[{'Value':kind,'Status':'Available','StatusCategory':'SoldOut' if flag('sold-out') else 'WithStock'} for kind in ['ecs.test.large','ecs.cheaper.large','ecs.arm.large']]}}]}}]}}
elif action=='DescribePrice':
 out={'PriceInfo':{'Price':{'TradePrice':0.4 if arg('--InstanceType')=='ecs.cheaper.large' else 0.8,'Currency':'CNY'}}}
elif action=='CreateStack':
 receipt=json.loads((root/'receipts'/(arg('--ClientToken')+'.json')).read_text())
 assert receipt['outcome']=='unknown'
 assert arg('--DisableRollback')=='false'
 assert arg('--ClientToken')==receipt['operationId']
 (root/'stack').write_text(json.dumps({'name':arg('--StackName'),'operation':arg('--ClientToken'),'template':arg('--TemplateBody')}))
 if flag('lost-response'): sys.exit(1)
 out={'StackId':'stack-test'}
elif action=='ListStacks':
 items=[]
 if flag('stack') and not flag('invisible'):
  s=json.loads((root/'stack').read_text());items=[{'StackId':'stack-test','StackName':s['name'],'RegionId':'cn-test'}]
 if flag('duplicate'): items*=2
 out={'Stacks':items,'TotalCount':len(items)}
elif action=='GetStack':
 s=json.loads((root/'stack').read_text())
 status='DELETE_COMPLETE' if flag('deleted') else 'CREATE_ROLLBACK_COMPLETE' if flag('rollback') else 'CREATE_ROLLBACK_FAILED' if flag('rollback-failed') else 'CREATE_IN_PROGRESS' if flag('pending') else 'CREATE_COMPLETE'
 out={'StackId':'stack-test','StackName':s['name'],'RegionId':'cn-test','Status':status,'Tags':[{'Key':'lime-operation','Value':'wrong' if flag('wrong-tag') else s['operation']}],'Outputs':[{'OutputKey':key,'OutputValue':value} for key,value in [('VpcId','vpc-test'),('VSwitchId','vsw-test'),('SecurityGroupId','sg-test')]],'StatusReason':'must-not-project-secret'}
 if flag('deleted') and not flag('wrong-tag'): out['Tags']=[]
elif action=='ListStackResources':
 resources=[{'LogicalResourceId':logical,'PhysicalResourceId':physical,'ResourceType':kind,'StackId':'stack-test','Status':'DELETE_COMPLETE'} for logical,physical,kind in [('Vpc','vpc-test','ALIYUN::ECS::VPC'),('Switch','vsw-test','ALIYUN::ECS::VSwitch'),('Group','sg-test','ALIYUN::ECS::SecurityGroup')]]
 for resource in resources: resource['PhysicalResourceId']=''
 if flag('retained'): resources[0]['Status']='DELETE_SKIPPED'
 if flag('changed-deleted'): resources[1]['PhysicalResourceId']='vsw-other'
 out={'Resources':resources}
elif action=='GetTemplate':
 s=json.loads((root/'stack').read_text());body=json.loads(s['template'])
 if flag('changed-template'): body['Resources']['Unexpected']={'Type':'ALIYUN::ECS::Instance'}
 out={'TemplateBody':json.dumps(body)}
elif action=='DescribeVSwitchAttributes': out={'VSwitchId':'vsw-test','Status':'Available','AvailableIpAddressCount':200,'ZoneId':'cn-wrong' if flag('wrong-zone') else 'cn-test-a','VpcId':'vpc-test'}
elif action=='DescribeVSwitches':
 assert arg('--VSwitchId')=='vsw-test'
 items=[{'VSwitchId':'vsw-test'}] if flag('switch-still-present') else []
 out={'TotalCount':len(items),'VSwitches':{'VSwitch':items}}
elif action=='DescribeSecurityGroups':
 assert arg('--SecurityGroupId')=='sg-test'
 items=[{'SecurityGroupId':'sg-test'}] if flag('group-still-present') else []
 out={'TotalCount':len(items),'SecurityGroups':{'SecurityGroup':items}}
 if flag('malformed-deleted-inventory'): del out['SecurityGroups']
elif action=='DescribeSecurityGroupAttribute':
 out={'SecurityGroupId':'sg-test','VpcId':'vpc-test','RegionId':'cn-test','Permissions':{'Permission':[{'Direction':'ingress','PortRange':'22/22'}] if flag('inbound') else [{'Direction':'egress'}]}}
else: sys.exit(2)
print(json.dumps(out))
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    (directory, service)
}

fn prepare(id: &str) -> CloudDesktopParams {
    CloudDesktopParams::PrepareEcsPurchase {
        region_id: "cn-test".into(),
        profile: "test".into(),
        operation_id: id.into(),
        confirmation: format!("prepareEcsPurchase:cn-test:test:{id}"),
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
async fn new_account_uses_available_low_price_x86_and_original_quote_without_buying_compute() {
    let (directory, service) = fixture();
    assert_eq!(
        service
            .read_ecs_purchase_preparation("cn-test", "test")
            .await
            .unwrap()["outcome"],
        "notPrepared"
    );
    assert!(!directory.path().join("calls").exists());
    let prepared = service.request(prepare("network-1")).await.unwrap().data;
    assert_eq!(prepared["outcome"], "networkPreparing");
    let ready = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "network-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(ready["outcome"], "networkReady");
    assert_eq!(ready["spec"]["instanceType"], "ecs.cheaper.large");
    assert_eq!(ready["spec"]["keyPairName"], "");
    assert!(!ready.to_string().contains("must-not-project"));
    let quote = service
        .request(CloudDesktopParams::QuoteEcs {
            spec: serde_json::from_value(ready["spec"].clone()).unwrap(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(quote["quote"]["price"]["hourlyPrice"], 0.4);
    service.request(prepare("network-new")).await.unwrap();
    let log = calls(directory.path());
    assert_eq!(
        log.iter().filter(|call| call[1] == "CreateStack").count(),
        1
    );
    assert!(!log
        .iter()
        .any(|call| call[1] == "RunInstances" || call[1] == "AuthorizeSecurityGroup"));
    let stack: Value =
        serde_json::from_reader(File::open(directory.path().join("stack")).unwrap()).unwrap();
    let body: Value = serde_json::from_str(stack["template"].as_str().unwrap()).unwrap();
    assert_eq!(body["Resources"].as_object().unwrap().len(), 3);
    assert_eq!(
        body["Resources"]["Group"]["Properties"]["SecurityGroupIngress"],
        json!([])
    );
}

#[tokio::test]
async fn lost_submission_and_restart_only_observe_original_stack_even_with_new_operation_id() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("lost-response"), "").unwrap();
    let lost = service.request(prepare("network-lost")).await.unwrap().data;
    assert_eq!(lost["outcome"], "unknown");
    fs::write(directory.path().join("invisible"), "").unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(
        restarted
            .request(prepare("new-attempt"))
            .await
            .unwrap()
            .data["outcome"],
        "unknown"
    );
    fs::remove_file(directory.path().join("invisible")).unwrap();
    let ready = restarted
        .read_ecs_purchase_preparation("cn-test", "test")
        .await
        .unwrap();
    assert_eq!(ready["operationId"], "network-lost");
    assert_eq!(ready["outcome"], "networkReady");
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|call| call[1] == "CreateStack")
            .count(),
        1
    );
}

#[tokio::test]
async fn mismatched_template_owner_zone_and_inbound_permissions_block_purchase_configuration() {
    for flag in ["changed-template", "wrong-tag", "wrong-zone", "inbound"] {
        let (directory, service) = fixture();
        service.request(prepare("network-1")).await.unwrap();
        fs::write(directory.path().join(flag), "").unwrap();
        assert!(
            service
                .read_ecs_purchase_preparation("cn-test", "test")
                .await
                .is_err(),
            "{flag}"
        );
        assert_ne!(
            service.read_receipt("network-1").unwrap().unwrap()["outcome"],
            "networkReady"
        );
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|call| call[1] == "CreateStack")
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn rollback_is_observed_and_only_confirmed_completed_rollback_allows_a_new_preparation() {
    let (directory, service) = fixture();
    service.request(prepare("network-1")).await.unwrap();
    fs::write(directory.path().join("rollback-failed"), "").unwrap();
    assert_eq!(
        service
            .read_ecs_purchase_preparation("cn-test", "test")
            .await
            .unwrap()["outcome"],
        "networkFailed"
    );
    service.request(prepare("network-2")).await.unwrap();
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|call| call[1] == "CreateStack")
            .count(),
        1
    );
    fs::write(directory.path().join("rollback"), "").unwrap();
    assert_eq!(
        service
            .read_ecs_purchase_preparation("cn-test", "test")
            .await
            .unwrap()["outcome"],
        "networkRolledBack"
    );
    assert_eq!(
        service.request(prepare("network-2")).await.unwrap().data["outcome"],
        "networkPreparing"
    );
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|call| call[1] == "CreateStack")
            .count(),
        2
    );
}

#[tokio::test]
async fn deleted_network_requires_all_original_resources_removed_before_new_preparation() {
    let (directory, service) = fixture();
    service.request(prepare("network-1")).await.unwrap();
    service
        .read_ecs_purchase_preparation("cn-test", "test")
        .await
        .unwrap();
    fs::write(directory.path().join("deleted"), "").unwrap();
    for flag in [
        "retained",
        "changed-deleted",
        "wrong-tag",
        "switch-still-present",
        "group-still-present",
        "malformed-deleted-inventory",
    ] {
        fs::write(directory.path().join(flag), "").unwrap();
        assert!(
            service
                .read_ecs_purchase_preparation("cn-test", "test")
                .await
                .is_err(),
            "{flag}"
        );
        assert!(
            service.request(prepare("network-2")).await.is_err(),
            "{flag}"
        );
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|call| call[1] == "CreateStack")
                .count(),
            1
        );
        fs::remove_file(directory.path().join(flag)).unwrap();
    }
    assert_eq!(
        service
            .read_ecs_purchase_preparation("cn-test", "test")
            .await
            .unwrap()["outcome"],
        "notPrepared"
    );
    let old = service.request(prepare("network-1")).await.unwrap().data;
    assert_eq!(old["outcome"], "networkDeleted");
    assert_eq!(old["requiresInspection"], false);
    let next = service.request(prepare("network-2")).await.unwrap().data;
    assert_eq!(next["outcome"], "networkPreparing");
    let log = calls(directory.path());
    assert_eq!(
        log.iter().filter(|call| call[1] == "CreateStack").count(),
        2
    );
    assert!(!log
        .iter()
        .any(|call| call[1] == "RunInstances" || call[1] == "DeleteStack"));
}

#[tokio::test]
async fn deleted_untagged_stack_without_prior_resource_verification_blocks_new_preparation() {
    let (directory, service) = fixture();
    service.request(prepare("network-1")).await.unwrap();
    fs::write(directory.path().join("deleted"), "").unwrap();
    assert!(service
        .read_ecs_purchase_preparation("cn-test", "test")
        .await
        .is_err());
    assert!(service.request(prepare("network-2")).await.is_err());
    let log = calls(directory.path());
    assert_eq!(
        log.iter().filter(|call| call[1] == "CreateStack").count(),
        1
    );
    assert!(!log.iter().any(|call| call[1] == "RunInstances"));
}

#[tokio::test]
async fn no_stock_or_missing_confirmation_never_submits_a_stack() {
    let (directory, service) = fixture();
    let mut request = prepare("network-1");
    if let CloudDesktopParams::PrepareEcsPurchase { confirmation, .. } = &mut request {
        *confirmation = "wrong".into();
    }
    assert!(service.request(request).await.is_err());
    assert!(!directory.path().join("calls").exists());
    fs::write(directory.path().join("sold-out"), "").unwrap();
    assert!(service.request(prepare("network-1")).await.is_err());
    assert!(!calls(directory.path())
        .iter()
        .any(|call| call[1] == "CreateStack"));
    assert!(service.read_receipt("network-1").unwrap().is_none());
}

#[tokio::test]
async fn corrupt_receipt_and_ambiguous_stack_recovery_never_resubmit() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("lost-response"), "").unwrap();
    service.request(prepare("network-1")).await.unwrap();
    fs::write(directory.path().join("duplicate"), "").unwrap();
    assert!(service
        .read_ecs_purchase_preparation("cn-test", "test")
        .await
        .is_err());
    let mut receipt = service.read_receipt("network-1").unwrap().unwrap();
    receipt["request"]["regionId"] = json!("cn-other");
    service.replace_receipt("network-1", &receipt).unwrap();
    assert!(service.request(prepare("network-1")).await.is_err());
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|call| call[1] == "CreateStack")
            .count(),
        1
    );
}
