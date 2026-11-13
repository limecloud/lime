use super::*;
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::{accept_async, tungstenite::Message};

fn channel() -> CloudDesktopTunnelChannel {
    CloudDesktopTunnelChannel::Desktop
}

#[test]
fn session_credentials_are_https_only_and_never_appear_in_validation_errors() {
    let result = session_url(&json!({"SessionId":"s-test", "WebSocketUrl":"wss://cn-test.axt.aliyun.com/ws?sessionid=s-test&token=must-not-leak"})).unwrap();
    assert_eq!(
        result
            .query_pairs()
            .find(|(key, _)| key == "sessionId")
            .unwrap()
            .1,
        "s-test"
    );
    for endpoint in [
        "ws://cn-test.axt.aliyun.com/?token=must-not-leak",
        "wss://aliyun.com.evil.test/?token=must-not-leak",
        "wss://user:must-not-leak@cn-test.axt.aliyun.com/",
        "wss://cn-test.axt.aliyun.com:8443/",
        "wss://127.0.0.1/?token=must-not-leak",
    ] {
        let error =
            session_url(&json!({"SessionId":"s-test", "WebSocketUrl":endpoint})).unwrap_err();
        assert!(!error.contains("must-not-leak"));
    }
}

fn server_frame(kind: u32, payload: &[u8]) -> Vec<u8> {
    // Independent fixture of the official variable-identity header; its integer
    // fields use little endian, while status-rate bytes use network byte order.
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&kind.to_le_bytes());
    bytes.extend_from_slice(b"1.01\x03sid\x04i-vm");
    bytes.extend_from_slice(&1700000000000u64.to_le_bytes());
    bytes.extend_from_slice(&42u64.to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

#[test]
fn official_variable_headers_decode_and_truncated_or_oversized_frames_fail_closed() {
    let packet = server_frame(1, b"a\0b\xff");
    let parsed = wire::parse(&packet).unwrap();
    assert_eq!(parsed.kind, 1);
    assert_eq!(parsed.payload, b"a\0b\xff");
    let mut current_agent = packet.clone();
    current_agent[4..8].copy_from_slice(b"1.00");
    let parsed = wire::parse(&current_agent).unwrap();
    assert_eq!(parsed.kind, 1);
    assert_eq!(parsed.payload, b"a\0b\xff");
    for length in 0..packet.len() {
        assert!(wire::parse(&packet[..length]).is_err());
    }
    let mut extra = packet.clone();
    extra.push(0);
    assert!(wire::parse(&extra).is_err());
    let mut wrong_version = packet.clone();
    wrong_version[7] = b'2';
    assert!(wire::parse(&wrong_version).is_err());
    let mut huge = packet.clone();
    huge[33..37].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(wire::parse(&huge).is_err());
    let encoded = wire::encode(0, 17, b"input");
    assert_eq!(&encoded[..10], b"\0\0\0\x001.01\0\0");
    assert_eq!(u64::from_le_bytes(encoded[18..26].try_into().unwrap()), 17);
    assert_eq!(&encoded[30..], b"input");
}

#[tokio::test]
async fn real_tcp_and_websocket_preserve_binary_bytes_and_close_without_replay() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = upstream.local_addr().unwrap();
    let expected: Vec<u8> = (0..6000).map(|index| (index % 256) as u8).collect();
    let source = expected.clone();
    let server = tokio::spawn(async move {
        let (socket, _) = upstream.accept().await.unwrap();
        let mut ws = accept_async(socket).await.unwrap();
        ws.send(Message::Binary(server_frame(5, &[7, 0x20, 0, 0])))
            .await
            .unwrap();
        let mut seen = Vec::new();
        let mut sequence = 0u64;
        while seen.len() < source.len() {
            let Message::Binary(bytes) = ws.next().await.unwrap().unwrap() else {
                panic!("binary wire expected")
            };
            let frame = wire::parse(&bytes).unwrap();
            assert_eq!(frame.kind, 0);
            assert_eq!(
                u64::from_le_bytes(bytes[18..26].try_into().unwrap()),
                sequence
            );
            sequence += 1;
            seen.extend_from_slice(frame.payload);
        }
        assert_eq!(seen, source);
        ws.send(Message::Binary(server_frame(1, &seen)))
            .await
            .unwrap();
        let Message::Binary(bytes) = ws.next().await.unwrap().unwrap() else {
            panic!("close frame expected")
        };
        assert_eq!(wire::parse(&bytes).unwrap().kind, 3);
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut tunnel = start_listener(
        listener,
        url::Url::parse(&format!("ws://{address}")).unwrap(),
        channel(),
        IDLE,
    )
    .unwrap();
    let mut client = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, tunnel.port))
        .await
        .unwrap();
    client.write_all(&expected).await.unwrap();
    let mut received = vec![0; expected.len()];
    tokio::time::timeout(Duration::from_secs(10), client.read_exact(&mut received))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(received, expected);
    client.shutdown().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    tunnel.cancel.send(true).unwrap();
    (&mut tunnel.task).await.unwrap();
}

#[tokio::test]
async fn closing_a_tunnel_owns_its_listener_and_every_open_stream() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = upstream.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (socket, _) = upstream.accept().await.unwrap();
        let mut ws = accept_async(socket).await.unwrap();
        let _ = ws.next().await;
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut tunnel = start_listener(
        listener,
        url::Url::parse(&format!("ws://{address}")).unwrap(),
        channel(),
        IDLE,
    )
    .unwrap();
    let mut client = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, tunnel.port))
        .await
        .unwrap();
    for _ in 0..50 {
        if tunnel.state.active.load(Ordering::Relaxed) == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(tunnel.state.active.load(Ordering::Relaxed), 1);
    tunnel.cancel.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(2), &mut tunnel.task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(client.read(&mut [0; 1]).await.unwrap(), 0);
    assert!(
        TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, tunnel.port))
            .await
            .is_err()
    );
    server.abort();
}

#[tokio::test]
async fn unused_listeners_expire_and_metadata_never_claims_desktop_readiness() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut tunnel = start_listener(
        listener,
        url::Url::parse("wss://cn-test.axt.aliyun.com/?token=must-not-leak").unwrap(),
        channel(),
        Duration::from_millis(20),
    )
    .unwrap();
    let metadata = tunnel.metadata();
    assert_eq!(metadata["desktopReady"], false);
    assert_eq!(metadata["persistent"], false);
    assert!(!metadata.to_string().contains("must-not-leak"));
    tokio::time::timeout(Duration::from_secs(1), &mut tunnel.task)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn rejected_status_and_nonbinary_messages_close_tcp_without_exposing_supplier_output() {
    for message in [
        Message::Binary(server_frame(5, b"\x05must-not-leak")),
        Message::Binary(server_frame(5, b"\x09must-not-leak")),
        Message::Text("must-not-leak".into()),
    ] {
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = upstream.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = upstream.accept().await.unwrap();
            let mut ws = accept_async(socket).await.unwrap();
            ws.send(message).await.unwrap();
            let _ = ws.next().await;
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut tunnel = start_listener(
            listener,
            url::Url::parse(&format!("ws://{address}")).unwrap(),
            channel(),
            IDLE,
        )
        .unwrap();
        let mut client = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, tunnel.port))
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), client.read(&mut [0; 64]))
                .await
                .unwrap()
                .unwrap(),
            0
        );
        for _ in 0..100 {
            if tunnel.state.failed.load(Ordering::Relaxed) {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(tunnel.metadata()["connectionFailed"], true);
        assert!(!tunnel.metadata().to_string().contains("must-not-leak"));
        tunnel.cancel.send(true).unwrap();
        (&mut tunnel.task).await.unwrap();
        server.await.unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn public_requests_reuse_one_fixed_target_and_do_not_persist_supplier_credentials() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli,r#"#!/usr/bin/env python3
import json,pathlib,sys
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
with (root/'calls').open('a') as out: out.write(json.dumps(args)+'\n')
if args[1]=='DescribeInstances':
 print(json.dumps({'Instances':{'Instance':[{'InstanceId':'i-test','Status':'Running','OperationLocks':{}}]}}))
elif args[1]=='StartTerminalSession':
 assert args[args.index('--PortNumber')+1]==((root/'expected-port').read_text() if (root/'expected-port').exists() else '6080')
 assert args[args.index('--TargetServer')+1]==((root/'expected-address').read_text() if (root/'expected-address').exists() else '127.0.0.1')
 assert '--CommandLine' not in args
 print(json.dumps({'SessionId':'s-test','WebSocketUrl':'wss://cn-test.axt.aliyun.com/ws?sessionid=s-test&token=must-not-leak'}))
else: sys.exit(2)
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("state"),
        cli,
    };
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        region_id: "cn-test".into(),
        resource_id: "i-test".into(),
        profile: "test".into(),
    };
    let open = CloudDesktopParams::OpenEcsTunnel {
        resource: resource.clone(),
        channel: channel(),
    };
    let (first, second) = tokio::join!(service.request(open.clone()), service.request(open));
    let first = first.unwrap().data;
    assert_eq!(first, second.unwrap().data);
    assert_eq!(first["state"], "listening");
    assert!(!first.to_string().contains("must-not-leak"));
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.contains("StartTerminalSession"))
            .count(),
        1
    );
    assert!(
        !service.root.exists(),
        "session URLs and ephemeral ports must not create persisted state"
    );
    service
        .request(CloudDesktopParams::CloseEcsTunnel {
            resource: resource.clone(),
            channel: channel(),
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .request(CloudDesktopParams::ReadEcsTunnel {
                resource: resource.clone(),
                channel: channel()
            })
            .await
            .unwrap()
            .data["state"],
        "closed"
    );
    for (channel, port, target, scheme) in [
        (
            CloudDesktopTunnelChannel::Installation,
            "8787",
            "127.0.0.2",
            "https",
        ),
        (
            CloudDesktopTunnelChannel::AppServer,
            "8787",
            "127.0.0.1",
            "ws",
        ),
    ] {
        fs::write(directory.path().join("expected-port"), port).unwrap();
        fs::write(directory.path().join("expected-address"), target).unwrap();
        let opened = service
            .request(CloudDesktopParams::OpenEcsTunnel {
                resource: resource.clone(),
                channel,
            })
            .await
            .unwrap()
            .data;
        let endpoint = url::Url::parse(opened["endpoint"].as_str().unwrap()).unwrap();
        assert_eq!(endpoint.scheme(), scheme);
        assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
        assert!(endpoint.port().is_some());
        assert_eq!(opened["persistent"], false);
        assert!(!opened.to_string().contains("must-not-leak"));
        service
            .request(CloudDesktopParams::CloseEcsTunnel {
                resource: resource.clone(),
                channel,
            })
            .await
            .unwrap();
        assert_eq!(
            service
                .request(CloudDesktopParams::ReadEcsTunnel {
                    resource: resource.clone(),
                    channel
                })
                .await
                .unwrap()
                .data["state"],
            "closed"
        );
    }
    let mut wrong = resource;
    wrong.provider = CloudDesktopProvider::Wuying;
    assert!(service
        .request(CloudDesktopParams::OpenEcsTunnel {
            resource: wrong,
            channel: channel()
        })
        .await
        .is_err());
}

#[cfg(unix)]
fn slow_session_service() -> (tempfile::TempDir, CloudDesktopService, CloudDesktopResource) {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(
        &cli,
        r#"#!/usr/bin/env python3
import json,pathlib,sys,time
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
with (root/'calls').open('a') as out: out.write(json.dumps(args)+'\n')
if args[1]=='DescribeInstances':
 identity=json.loads(args[args.index('--InstanceIds')+1])[0]
 print(json.dumps({'Instances':{'Instance':[{'InstanceId':identity,'Status':'Running','OperationLocks':{}}]}}))
elif args[1]=='StartTerminalSession':
 assert args[args.index('--PortNumber')+1]=='6080'
 assert args[args.index('--TargetServer')+1]=='127.0.0.1'
 if args[args.index('--InstanceId.1')+1]=='i-slow':
  (root/'pending').touch()
  deadline=time.monotonic()+10
  while not (root/'allow').exists():
   if time.monotonic()>deadline: sys.exit(3)
   time.sleep(0.01)
  (root/'completed').touch()
 print(json.dumps({'SessionId':'s-test','WebSocketUrl':'wss://cn-test.axt.aliyun.com/ws?sessionid=s-test&token=must-not-leak'}))
else: sys.exit(2)
"#,
    )
    .unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("state"),
        cli,
    };
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        region_id: "cn-test".into(),
        resource_id: "i-slow".into(),
        profile: "test".into(),
    };
    (directory, service, resource)
}

#[cfg(unix)]
async fn wait_for_session_request(directory: &Path) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !directory.join("pending").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the fixture must reach the pending supplier request");
}

#[cfg(unix)]
#[tokio::test]
async fn slow_open_does_not_block_another_resource_reads_or_close() {
    let (directory, service, resource) = slow_session_service();
    let pending = {
        let service = service.clone();
        let resource = resource.clone();
        tokio::spawn(async move { service.open_ecs_tunnel(resource, channel()).await })
    };
    wait_for_session_request(directory.path()).await;
    let mut other = resource.clone();
    other.resource_id = "i-fast".into();
    let opened = tokio::time::timeout(
        Duration::from_secs(2),
        service.open_ecs_tunnel(other.clone(), channel()),
    )
    .await
    .expect("an unrelated cloud API must not wait for the slow resource")
    .unwrap();
    assert_eq!(opened["state"], "listening");
    let observed = tokio::time::timeout(
        Duration::from_secs(1),
        service.read_ecs_tunnel(&resource, channel()),
    )
    .await
    .expect("status reads must not wait for session creation")
    .unwrap();
    assert_eq!(observed["state"], "closed");
    assert!(observed.get("endpoint").is_none());
    tokio::time::timeout(
        Duration::from_secs(1),
        service.close_ecs_tunnel(&resource, channel()),
    )
    .await
    .expect("close must cancel a pending supplier call")
    .unwrap();
    assert!(pending.await.unwrap().is_err());
    fs::write(directory.path().join("allow"), b"").unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !directory.path().join("completed").exists(),
        "the cancelled supplier subprocess must not continue after close"
    );
    service.close_ecs_tunnel(&other, channel()).await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn abandoning_the_last_opener_cancels_creation_and_only_an_explicit_open_starts_again() {
    let (directory, service, resource) = slow_session_service();
    let pending = {
        let service = service.clone();
        let resource = resource.clone();
        tokio::spawn(async move { service.open_ecs_tunnel(resource, channel()).await })
    };
    wait_for_session_request(directory.path()).await;
    let identity = key(&service.root, &resource, channel());
    // Another resource can prune cancelled entries; observe the actual task.
    let creation = TUNNELS.lock().await[&identity].task.abort_handle();
    pending.abort();
    assert!(pending.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(2), async {
        while !creation.is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("abandoning the request must stop creation without an explicit close");
    fs::write(directory.path().join("allow"), b"").unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!directory.path().join("completed").exists());
    assert_eq!(
        service.read_ecs_tunnel(&resource, channel()).await.unwrap()["state"],
        "closed"
    );
    let opened = service
        .open_ecs_tunnel(resource.clone(), channel())
        .await
        .unwrap();
    assert_eq!(opened["state"], "listening");
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.contains("StartTerminalSession"))
            .count(),
        2,
        "one cancelled request and one explicit new open, with no automatic retry"
    );
    service
        .close_ecs_tunnel(&resource, channel())
        .await
        .unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn cancelling_one_of_two_openers_keeps_the_shared_request_for_the_other() {
    let (directory, service, resource) = slow_session_service();
    let open = || {
        let service = service.clone();
        let resource = resource.clone();
        tokio::spawn(async move { service.open_ecs_tunnel(resource, channel()).await })
    };
    let first = open();
    wait_for_session_request(directory.path()).await;
    let second = open();
    let identity = key(&service.root, &resource, channel());
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let waiters = TUNNELS.lock().await[&identity]
                .state
                .waiting
                .load(Ordering::Relaxed);
            if waiters == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    fs::write(directory.path().join("allow"), b"").unwrap();
    assert_eq!(second.await.unwrap().unwrap()["state"], "listening");
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| line.contains("StartTerminalSession"))
            .count(),
        1
    );
    service
        .close_ecs_tunnel(&resource, channel())
        .await
        .unwrap();
}
