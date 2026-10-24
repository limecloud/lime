use super::*;
use manifest::{Archive, Artifact, Platform};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicUsize, Ordering};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn published_manifest_covers_platforms_with_complete_pinned_identities() {
    let release = Release::current();
    assert_eq!(release.platforms.len(), 6);
    for platform in &release.platforms {
        assert_eq!(platform.artifacts.len(), 2);
        for artifact in &platform.artifacts {
            assert_eq!(hex::decode(&artifact.sha256).unwrap().len(), 32);
            assert!(artifact.url.starts_with("https://"));
            assert!(Path::new(&artifact.executable).starts_with(&artifact.root));
        }
    }
}

#[cfg(unix)]
fn fixture_service(root: PathBuf, release: Release) -> PrimaryRuntimeService {
    let mut service = PrimaryRuntimeService::with_release(root, release).unwrap();
    // Local fixtures must not inherit the host's HTTP proxy settings.
    service.client = reqwest::Client::builder().no_proxy().build().unwrap();
    service
}

#[cfg(unix)]
struct Fixture {
    temp: TempDir,
    manager: PrimaryRuntimeService,
    requests: Arc<AtomicUsize>,
    listener: tokio::task::JoinHandle<()>,
}

#[cfg(unix)]
impl Fixture {
    async fn new(corrupt_hash: bool, stalled: bool) -> Self {
        let temp = TempDir::new().unwrap();
        let marker = temp.path().join("probe-count");
        let mut archive = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (name, version) in [("node", "v1.2.3"), ("python", "Python 3.13.17")] {
            let body = format!(
                "#!/bin/sh\nprintf x >> '{}'\nprintf '%s\\n' '{}'\n",
                marker.display(),
                version
            );
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            archive
                .append_data(&mut header, format!("tools/{name}"), body.as_bytes())
                .unwrap();
        }
        let bytes = archive.into_inner().unwrap().finish().unwrap();
        let checksum = hex::encode(Sha256::digest(&bytes));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/bundle", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = requests.clone();
        let handle = tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let bytes = bytes.clone();
                let observed = observed.clone();
                tokio::spawn(async move {
                    let mut buffer = [0; 2048];
                    let _ = socket.read(&mut buffer).await;
                    observed.fetch_add(1, Ordering::SeqCst);
                    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).as_bytes()).await.unwrap();
                    if stalled {
                        // Wait for the client to close the canceled request, rather than a fixed timer.
                        let _ = socket.read(&mut buffer).await;
                    } else {
                        let _ = socket.write_all(&bytes).await;
                    }
                });
            }
        });
        let release = Release {
            version: "fixture-1".into(),
            platforms: vec![Platform {
                os: std::env::consts::OS.into(),
                arch: std::env::consts::ARCH.into(),
                artifacts: vec![Artifact {
                    name: "tools".into(),
                    version: "1.2.3".into(),
                    url,
                    sha256: if corrupt_hash {
                        "0".repeat(64)
                    } else {
                        checksum
                    },
                    archive: Archive::TarGz,
                    root: "tools".into(),
                    executable: "tools/node".into(),
                    bin: "tools".into(),
                }],
            }],
        };
        let manager = fixture_service(temp.path().join("dependencies"), release);
        Self {
            temp,
            manager,
            requests,
            listener: handle,
        }
    }

    async fn terminal(&self) -> PrimaryRuntimeInstallProgress {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let snapshot = self.manager.diagnose_dependencies(true, false).await;
                if let Some(update) = snapshot.update.filter(|update| !update.phase.is_active()) {
                    return update;
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("dependency operation terminal")
    }
}

#[cfg(unix)]
impl Drop for Fixture {
    fn drop(&mut self) {
        self.listener.abort();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn real_archive_install_passive_diagnostics_probe_cold_read_and_child_path() {
    let fixture = Fixture::new(false, false).await;
    let initial = fixture.manager.diagnose_dependencies(false, false).await;
    assert!(!initial.installed);
    assert!(!initial.enabled);
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 0);
    let update = fixture.manager.install(false).unwrap();
    assert_eq!(fixture.manager.install(true).unwrap().id, update.id);
    assert_eq!(
        fixture.terminal().await.phase,
        PrimaryRuntimeInstallPhase::Ready
    );
    assert!(!fixture.manager.cancel_install(&update.id));
    let marker = fixture.temp.path().join("probe-count");
    assert_eq!(std::fs::read(&marker).unwrap(), b"x");
    let passive = fixture.manager.diagnose_dependencies(true, false).await;
    assert!(passive.installed);
    assert_eq!(passive.bundle_version.as_deref(), Some("fixture-1"));
    assert_eq!(
        std::fs::read(&marker).unwrap(),
        b"x",
        "passive reads must never execute binaries"
    );
    assert!(
        fixture
            .manager
            .diagnose_dependencies(true, true)
            .await
            .installed
    );
    assert_eq!(std::fs::read(&marker).unwrap(), b"xx");
    let cold = fixture_service(
        fixture.manager.root.clone(),
        (*fixture.manager.release).clone(),
    );
    assert!(cold.diagnose_dependencies(true, false).await.installed);
    let mut environment = HashMap::from([("PATH".into(), "/usr/bin:/bin".into())]);
    assert!(cold.expose(&mut environment).unwrap());
    let output = tokio::process::Command::new("sh")
        .args(["-c", "node --version"])
        .envs(environment)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, b"v1.2.3\n");
    let ready = cold.install(false).unwrap();
    assert_eq!(ready.phase, PrimaryRuntimeInstallPhase::Ready);
    assert_eq!(
        fixture.requests.load(Ordering::SeqCst),
        1,
        "already-current avoids downloads"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn checksum_failure_and_canceled_reinstall_keep_previous_installation() {
    let fixture = Fixture::new(false, false).await;
    fixture.manager.install(false).unwrap();
    assert_eq!(
        fixture.terminal().await.phase,
        PrimaryRuntimeInstallPhase::Ready
    );
    let before = std::fs::read(fixture.manager.root.join("current.json")).unwrap();
    let mut release = (*fixture.manager.release).clone();
    release.platforms[0].artifacts[0].sha256 = "0".repeat(64);
    let broken = fixture_service(fixture.manager.root.clone(), release);
    broken.install(true).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let diagnostic = broken.diagnose_dependencies(true, false).await;
            if diagnostic.update.unwrap().phase == PrimaryRuntimeInstallPhase::Error {
                assert!(diagnostic.installed);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(fixture.manager.root.join("current.json")).unwrap(),
        before
    );
    let stalled = Fixture::new(false, true).await;
    let mut release = (*stalled.manager.release).clone();
    release.version = "fixture-1".into();
    let reinstall = fixture_service(fixture.manager.root.clone(), release);
    let update = reinstall.install(true).unwrap();
    assert!(!reinstall.cancel_install("stale-operation"));
    assert!(reinstall.cancel_install(&update.id));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if reinstall
                .diagnose_dependencies(true, false)
                .await
                .update
                .unwrap()
                .phase
                == PrimaryRuntimeInstallPhase::Canceled
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(fixture.manager.root.join("current.json")).unwrap(),
        before
    );
    assert!(
        fixture
            .manager
            .diagnose_dependencies(true, true)
            .await
            .installed
    );
}

#[cfg(unix)]
#[tokio::test]
async fn separate_managers_cannot_install_concurrently_and_invalid_receipts_are_rejected() {
    let fixture = Fixture::new(false, true).await;
    let update = fixture.manager.install(false).unwrap();
    let second = fixture_service(
        fixture.manager.root.clone(),
        (*fixture.manager.release).clone(),
    );
    assert!(second.install(true).is_err());
    assert!(fixture.manager.cancel_install(&update.id));
    assert_eq!(
        fixture.terminal().await.phase,
        PrimaryRuntimeInstallPhase::Canceled
    );
    std::fs::write(
        fixture.manager.root.join("current.json"),
        r#"{"bundleVersion":"fixture-1","generation":"../../escape"}"#,
    )
    .unwrap();
    let diagnosis = second.diagnose_dependencies(true, false).await;
    assert!(!diagnosis.installed);
    assert_eq!(diagnosis.problems, ["invalid-receipt"]);
    assert!(second.expose(&mut HashMap::new()).is_err());
}

#[test]
fn archive_rejects_links_outside_bundle_and_zip_traversal() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("malicious.tar.gz");
    let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
        std::fs::File::create(&source).unwrap(),
        flate2::Compression::fast(),
    ));
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o777);
    tar.append_link(&mut header, "tools/escape", "../../outside")
        .unwrap();
    tar.into_inner().unwrap().finish().unwrap();
    let artifact = Artifact {
        name: "tools".into(),
        version: "1".into(),
        url: "https://unused.invalid".into(),
        sha256: String::new(),
        archive: Archive::TarGz,
        root: "tools".into(),
        executable: "tools/node".into(),
        bin: "tools".into(),
    };
    let destination = temp.path().join("unpacked");
    std::fs::create_dir(&destination).unwrap();
    assert!(
        bundle_archive::extract(&source, &destination, &artifact, &CancellationToken::new())
            .is_err()
    );
    let source = temp.path().join("malicious.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
    zip.start_file("../escape", zip::write::FileOptions::default())
        .unwrap();
    zip.finish().unwrap();
    let artifact = Artifact {
        archive: Archive::Zip,
        ..artifact
    };
    assert!(
        bundle_archive::extract(&source, &destination, &artifact, &CancellationToken::new())
            .is_err()
    );
    assert!(!temp.path().join("escape").exists());
}
