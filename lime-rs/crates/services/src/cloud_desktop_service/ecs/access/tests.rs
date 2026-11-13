use super::*;

async fn fixture() -> (tempfile::TempDir, CloudDesktopService) {
    let (directory, service) = super::super::network::tests::fixture();
    let cli = fs::read_to_string(&service.cli).unwrap();
    let before = "else: sys.exit(2)";
    assert!(cli.contains(before));
    let cli = cli.replace(before, r#"elif action=='DescribeInstances':
 item={'InstanceId':'i-rebuilt' if flag('rebuilt') else 'i-test','RegionId':'cn-test','Status':'Running','VpcAttributes':{'VSwitchId':'vsw-test'},'SecurityGroupIds':{'SecurityGroupId':['sg-other' if flag('unmanaged') else 'sg-test']}}
 items=[item]
 if flag('shared') and '--SecurityGroupId' in args: items.append(dict(item,InstanceId='i-other'))
 out={'TotalCount':len(items),'Instances':{'Instance':items}}
elif action=='AuthorizeSecurityGroup':
 receipts=[json.loads(p.read_text()) for p in (root/'receipts').glob('*.json') if not p.name.startswith(('quote-','resource-'))]
 receipt=next(r for r in receipts if r.get('request',{}).get('action')=='prepareEcsConnection' and r['phase']=='authorizing')
 assert receipt['outcome']=='connectionPreparing' and receipt['requiresInspection'] is True
 rules=json.loads((root/'rules.json').read_text()) if flag('rules.json') else []
 for n in [1,2]:
  def p(field): return arg('--Permissions.'+str(n)+'.'+field)
  assert p('IpProtocol')=='tcp' and p('PortRange') in ['8787/8787','6080/6080'] and p('SourceCidrIp').endswith('/32')
  rules.append({'SecurityGroupRuleId':'sgr-'+receipt['operationId']+'-'+str(n),'Direction':'ingress','IpProtocol':'TCP','PortRange':p('PortRange'),'SourceCidrIp':p('SourceCidrIp'),'Policy':'Accept','Priority':1,'NicType':'intranet','Description':p('Description')})
 (root/'applied-rules.json').write_text(json.dumps(rules))
 if not flag('authorization-pending'): (root/'rules.json').write_text(json.dumps(rules))
 if flag('lost-authorization') or flag('authorization-pending'): sys.exit(1)
 out={'RequestId':'must-not-project-secret'}
elif action=='RevokeSecurityGroup':
 receipts=[json.loads(p.read_text()) for p in (root/'receipts').glob('*.json') if not p.name.startswith(('quote-','resource-'))]
 receipt=next(r for r in receipts if r.get('request',{}).get('action')=='prepareEcsConnection' and r['phase']=='revoking')
 ids=[arg('--SecurityGroupRuleId.1'),arg('--SecurityGroupRuleId.2')]
 assert set(ids)==set(r['id'] for r in receipt['previousRules'])
 assert all(r['sourceCidr']!=receipt['request']['sourceCidr'] for r in receipt['previousRules'])
 rules=json.loads((root/'rules.json').read_text())
 (root/'after-revoke.json').write_text(json.dumps([r for r in rules if r['SecurityGroupRuleId'] not in ids]))
 if not flag('revocation-pending'): (root/'rules.json').write_text((root/'after-revoke.json').read_text())
 if flag('lost-revocation') or flag('revocation-pending'): sys.exit(1)
 out={}
else: sys.exit(2)
if action=='DescribeSecurityGroupAttribute' and flag('rules.json'):
 out['Permissions']['Permission']=json.loads((root/'rules.json').read_text())
"#);
    fs::write(&service.cli, cli).unwrap();
    let receipt = service
        .prepare_ecs_purchase(
            "cn-test",
            "test",
            "network",
            "prepareEcsPurchase:cn-test:test:network",
        )
        .await
        .unwrap();
    assert_eq!(receipt["operationId"], "network");
    assert_eq!(
        service
            .inspect_ecs_purchase_preparation("network")
            .await
            .unwrap()["outcome"],
        "networkReady"
    );
    (directory, service)
}

fn resource() -> CloudDesktopResource {
    CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        profile: "test".into(),
        region_id: "cn-test".into(),
        resource_id: "i-test".into(),
    }
}

async fn prepare(service: &CloudDesktopService, operation: &str, cidr: &str) -> Value {
    service
        .prepare_ecs_connection_at(
            resource(),
            operation.into(),
            "prepareEcsConnection:cn-test:i-test".into(),
            cidr.into(),
        )
        .await
        .unwrap()
}

fn mutations(directory: &Path, action: &str) -> usize {
    fs::read_to_string(directory.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Vec<String>>(line).unwrap())
        .filter(|args| args[1] == action)
        .count()
}

#[tokio::test]
async fn installs_with_two_scoped_rules_and_can_reopen_original_purchase() {
    let (directory, service) = fixture().await;
    fs::write(directory.path().join("lost-authorization"), "").unwrap();
    let receipt = prepare(&service, "connection", "8.8.8.8/32").await;
    assert_eq!(receipt["outcome"], "connectionReady");
    assert_eq!(receipt["rules"].as_array().unwrap().len(), 2);
    assert!(!receipt.to_string().contains("must-not-project"));
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 0);
    assert_eq!(
        service
            .inspect_ecs_purchase_preparation("network")
            .await
            .unwrap()["outcome"],
        "networkReady"
    );
    assert_eq!(
        prepare(&service, "another", "8.8.8.8/32").await["operationId"],
        "connection"
    );
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
    assert_eq!(mutations(directory.path(), "RunInstances"), 0);
}

#[tokio::test]
async fn lost_authorization_restart_and_new_address_only_observe_original_intent() {
    let (directory, service) = fixture().await;
    fs::write(directory.path().join("authorization-pending"), "").unwrap();
    let first = prepare(&service, "original", "8.8.8.8/32").await;
    assert_eq!(first["phase"], "authorizing");
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let second = prepare(&restarted, "new-id", "1.1.1.1/32").await;
    assert_eq!(second["operationId"], "original");
    assert_eq!(second["request"]["sourceCidr"], "8.8.8.8/32");
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
    fs::write(
        directory.path().join("rules.json"),
        fs::read(directory.path().join("applied-rules.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        restarted.inspect_ecs_connection("original").await.unwrap()["outcome"],
        "connectionReady"
    );
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
}

#[tokio::test]
async fn address_rotation_cleans_exact_previous_ids_and_never_repeats_unknown_revoke() {
    let (directory, service) = fixture().await;
    prepare(&service, "first", "8.8.8.8/32").await;
    fs::write(directory.path().join("revocation-pending"), "").unwrap();
    let rotating = prepare(&service, "rotation", "1.1.1.1/32").await;
    assert_eq!(rotating["phase"], "revoking");
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 2);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 1);
    assert_eq!(
        service.inspect_ecs_connection("rotation").await.unwrap()["phase"],
        "revoking"
    );
    assert_eq!(
        prepare(&service, "third-address", "9.9.9.9/32").await["operationId"],
        "rotation"
    );
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 2);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 1);
    fs::write(
        directory.path().join("rules.json"),
        fs::read(directory.path().join("after-revoke.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        service.inspect_ecs_connection("rotation").await.unwrap()["outcome"],
        "connectionReady"
    );
    assert_eq!(
        service
            .inspect_ecs_purchase_preparation("network")
            .await
            .unwrap()["outcome"],
        "networkReady"
    );
    let rules: Vec<Value> =
        serde_json::from_slice(&fs::read(directory.path().join("rules.json")).unwrap()).unwrap();
    assert_eq!(rules.len(), 2);
    assert!(rules
        .iter()
        .all(|rule| rule["SourceCidrIp"] == "1.1.1.1/32"));
}

#[tokio::test]
async fn unmanaged_shared_or_changed_network_cannot_be_automatically_authorized() {
    for marker in [
        "unmanaged",
        "shared",
        "changed-template",
        "wrong-tag",
        "inbound",
    ] {
        let (directory, service) = fixture().await;
        fs::write(directory.path().join(marker), "").unwrap();
        let result = service
            .prepare_ecs_connection_at(
                resource(),
                "connection".into(),
                "prepareEcsConnection:cn-test:i-test".into(),
                "8.8.8.8/32".into(),
            )
            .await;
        if marker == "unmanaged" {
            assert_eq!(result.unwrap()["outcome"], "unmanagedNetwork");
        } else {
            assert!(result.is_err(), "{marker}");
        }
        assert_eq!(
            mutations(directory.path(), "AuthorizeSecurityGroup"),
            0,
            "{marker}"
        );
        assert_eq!(
            mutations(directory.path(), "RevokeSecurityGroup"),
            0,
            "{marker}"
        );
    }
}

#[tokio::test]
async fn missing_consent_invalid_source_and_tampered_receipt_fail_before_writes() {
    let (directory, service) = fixture().await;
    assert!(service
        .prepare_ecs_connection_at(
            resource(),
            "connection".into(),
            "".into(),
            "8.8.8.8/32".into()
        )
        .await
        .is_err());
    for source in [
        "0.0.0.0/0",
        "127.0.0.1/32",
        "10.0.0.1/32",
        "100.64.0.1/32",
        "169.254.169.254/32",
        "192.0.2.1/32",
        "224.1.1.1/32",
        "8.8.8.8/24",
        "::1/32",
    ] {
        assert!(
            service
                .prepare_ecs_connection_at(
                    resource(),
                    "connection".into(),
                    "prepareEcsConnection:cn-test:i-test".into(),
                    source.into()
                )
                .await
                .is_err(),
            "{source}"
        );
    }
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 0);
    let mut receipt = prepare(&service, "connection", "8.8.8.8/32").await;
    receipt["request"]["sourceCidr"] = json!("1.1.1.1/32");
    service.replace_receipt("connection", &receipt).unwrap();
    assert!(service.inspect_ecs_connection("connection").await.is_err());
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
}

#[tokio::test]
async fn externally_modified_rules_do_not_trigger_repair_or_broader_cleanup() {
    let (directory, service) = fixture().await;
    prepare(&service, "connection", "8.8.8.8/32").await;
    let mut rules: Vec<Value> =
        serde_json::from_slice(&fs::read(directory.path().join("rules.json")).unwrap()).unwrap();
    rules[0]["SourceCidrIp"] = json!("0.0.0.0/0");
    fs::write(
        directory.path().join("rules.json"),
        serde_json::to_vec(&rules).unwrap(),
    )
    .unwrap();
    assert!(service.inspect_ecs_connection("connection").await.is_err());
    assert!(service
        .prepare_ecs_connection_at(
            resource(),
            "rotation".into(),
            "prepareEcsConnection:cn-test:i-test".into(),
            "1.1.1.1/32".into()
        )
        .await
        .is_err());
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 0);
}

#[tokio::test]
async fn rebuilt_instance_reuses_registered_rules_without_rewriting_original_intent() {
    let (directory, service) = fixture().await;
    let original = prepare(&service, "original", "8.8.8.8/32").await;
    fs::write(directory.path().join("rebuilt"), "").unwrap();
    let rebuilt = CloudDesktopResource {
        resource_id: "i-rebuilt".into(),
        ..resource()
    };
    assert!(service.inspect_ecs_connection("original").await.is_err());
    let reused = service
        .prepare_ecs_connection_at(
            rebuilt.clone(),
            "reuse".into(),
            "prepareEcsConnection:cn-test:i-rebuilt".into(),
            "8.8.8.8/32".into(),
        )
        .await
        .unwrap();
    assert_eq!(reused["outcome"], "connectionReady");
    assert_eq!(reused["operationId"], "original");
    assert_eq!(reused["request"], original["request"]);
    assert_eq!(reused["requestSha256"], original["requestSha256"]);
    assert_eq!(reused["observedResource"], json!(rebuilt));
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 1);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 0);
    assert!(!service.root.join("reuse.json").exists());

    let rotated = service
        .prepare_ecs_connection_at(
            rebuilt.clone(),
            "rotation".into(),
            "prepareEcsConnection:cn-test:i-rebuilt".into(),
            "1.1.1.1/32".into(),
        )
        .await
        .unwrap();
    assert_eq!(rotated["outcome"], "connectionReady");
    assert_eq!(rotated["observedResource"], json!(rebuilt));
    assert_eq!(rotated["previousRules"], original["rules"]);
    assert_eq!(mutations(directory.path(), "AuthorizeSecurityGroup"), 2);
    assert_eq!(mutations(directory.path(), "RevokeSecurityGroup"), 1);
    let mut wrong_scope = reused;
    wrong_scope["observedResource"]["profile"] = json!("another-profile");
    assert!(service
        .validate_ecs_connection_receipt(&wrong_scope)
        .is_err());
}
