use super::*;
use std::cell::Cell;

#[tokio::test]
async fn verified_steps_finish_without_polling_delays_and_preserve_exactly_once_mutations() {
    let (directory, service) = fixture("Running");
    let _lease = initialize(&service).await;
    let waits = Cell::new(0);
    service
        .run_hibernation_with_wait("save-1", || {
            waits.set(waits.get() + 1);
            std::future::ready(())
        })
        .await;
    assert_eq!(
        service.request(read()).await.unwrap().data["outcome"],
        "hibernated"
    );
    assert_eq!(waits.get(), 0, "verified stages must advance immediately");
    for action in [
        "StopInstance",
        "CreateSnapshot",
        "CreateImage",
        "DeleteInstance",
    ] {
        assert_eq!(calls(&directory, action), 1, "{action}");
    }
}

#[tokio::test]
async fn pending_snapshots_and_images_wait_before_inspection_and_never_resubmit() {
    let (directory, service) = fixture("Stopped");
    let _lease = initialize(&service).await;
    for marker in ["snapshot-pending", "image-pending"] {
        fs::write(directory.path().join(marker), "").unwrap();
    }
    let waited_phases = std::cell::RefCell::new(Vec::new());
    service
        .run_hibernation_with_wait("save-1", || {
            let receipt = service.read_receipt("save-1").unwrap().unwrap();
            let phase = receipt["phase"].as_str().unwrap();
            waited_phases.borrow_mut().push(phase.to_owned());
            // A provider readiness event arrives during each poll interval.
            let marker = match phase {
                "snapshotting" => "snapshot-pending",
                "imaging" => "image-pending",
                other => panic!("unexpected wait after verified stage: {other}"),
            };
            fs::remove_file(directory.path().join(marker)).unwrap();
            std::future::ready(())
        })
        .await;
    assert_eq!(
        service.request(read()).await.unwrap().data["outcome"],
        "hibernated"
    );
    assert_eq!(*waited_phases.borrow(), ["snapshotting", "imaging"]);
    for action in ["CreateSnapshot", "CreateImage", "DeleteInstance"] {
        assert_eq!(calls(&directory, action), 1, "{action}");
    }
}

#[tokio::test]
async fn pending_stop_and_release_wait_for_provider_without_repeating_mutations() {
    let (directory, service) = fixture("Running");
    let _lease = initialize(&service).await;
    for marker in ["stop-pending", "hold-delete"] {
        fs::write(directory.path().join(marker), "").unwrap();
    }
    let waited_phases = std::cell::RefCell::new(Vec::new());
    service
        .run_hibernation_with_wait("save-1", || {
            let receipt = service.read_receipt("save-1").unwrap().unwrap();
            let phase = receipt["phase"].as_str().unwrap();
            waited_phases.borrow_mut().push(phase.to_owned());
            match phase {
                "stopping" => modify(&directory, "instance.json", |instance| {
                    instance["Status"] = json!("Stopped");
                }),
                "releasing" => fs::write(directory.path().join("released"), "").unwrap(),
                other => panic!("unexpected wait after verified stage: {other}"),
            }
            std::future::ready(())
        })
        .await;
    assert_eq!(
        service.request(read()).await.unwrap().data["outcome"],
        "hibernated"
    );
    assert_eq!(*waited_phases.borrow(), ["stopping", "releasing"]);
    for action in [
        "StopInstance",
        "CreateSnapshot",
        "CreateImage",
        "DeleteInstance",
    ] {
        assert_eq!(calls(&directory, action), 1, "{action}");
    }
}

#[tokio::test]
async fn cancellation_while_waiting_retains_original_disk_and_created_snapshot() {
    let (directory, service) = fixture("Stopped");
    let _lease = initialize(&service).await;
    fs::write(directory.path().join("snapshot-pending"), "").unwrap();
    let waits = Cell::new(0);
    service
        .run_hibernation_with_wait("save-1", || {
            waits.set(waits.get() + 1);
            service
                .cancel_ecs_hibernation("save-1", "cancelEcsHibernation:save-1")
                .unwrap();
            std::future::ready(())
        })
        .await;
    assert_eq!(waits.get(), 1);
    assert_eq!(
        service.request(read()).await.unwrap().data["outcome"],
        "cancelled"
    );
    assert_eq!(calls(&directory, "CreateSnapshot"), 1);
    for action in ["CreateImage", "DeleteInstance", "DeleteSnapshot"] {
        assert_eq!(calls(&directory, action), 0, "{action}");
    }
    assert!(!directory.path().join("released").exists());
}
