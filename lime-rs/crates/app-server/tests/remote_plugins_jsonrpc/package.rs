use super::*;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

pub fn artifact() -> (Value, Vec<u8>) {
    artifact_version("1.0.0")
}

pub fn artifact_version(version: &str) -> (Value, Vec<u8>) {
    artifact_with_host(version, "lime")
}

pub fn artifact_with_host(version: &str, host: &str) -> (Value, Vec<u8>) {
    let plugin = format!(r#"{{"name":"research","version":"{version}","skills":["./skills"]}}"#);
    let files = [
        (".lime-plugin/plugin.json", plugin.as_bytes()),
        (
            "skills/research/SKILL.md",
            b"---\nname: research\ndescription: Research topics\n---\nResearch instructions\n"
                .as_slice(),
        ),
    ];
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let mut entries = Vec::new();
    for (path, bytes) in files {
        archive
            .start_file(
                path,
                SimpleFileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .last_modified_time(
                        zip::DateTime::from_date_and_time(2020, 1, 1, 0, 0, 0).unwrap(),
                    )
                    .unix_permissions(0o644),
            )
            .unwrap();
        archive.write_all(bytes).unwrap();
        entries.push(format!(
            r#"{{"path":"{path}","sha256":"{}","size":{}}}"#,
            hex::encode(Sha256::digest(bytes)),
            bytes.len()
        ));
    }
    let bytes = archive.finish().unwrap().into_inner();
    // Canonical field order is defined by Cloud's published manifest contract.
    let manifest = format!(
        r#"{{"schema_version":1,"kind":"plugin","name":"research","version":"{version}","title":{{"source":"Research","translations":{{"zh-CN":"资料研究"}}}},"description":{{"source":"Research topics","translations":{{"zh-CN":"研究选定资料"}}}},"license":"MIT","hosts":[{{"id":"{host}","min_version":"1.0.0","capabilities":["plugins","skills","mcp"]}}],"files":[{}],"plugin":{{"entry":".lime-plugin/plugin.json","dependencies":[]}}}}"#,
        entries.join(",")
    );
    let sha = hex::encode(Sha256::digest(&bytes));
    let release = json!({"id":"rel_research","itemId":"item_research","manifest":serde_json::from_str::<Value>(&manifest).unwrap(),"manifestSha256":hex::encode(Sha256::digest(manifest.as_bytes())),"archiveSha256":sha,"archiveSize":bytes.len(),"status":"approved","revision":1});
    let item = json!({"id":"item_research","publisherApplicationId":"publisher","environment":"sandbox","kind":"plugin","name":"Research","publishedReleaseId":"rel_research","revision":1,"release":release,"compatibility":{"status":"supported","reasons":[]}});
    (item, bytes)
}

pub fn configure(f: &Fixture) -> Value {
    let (item, bytes) = artifact();
    configure_artifact(f, item, bytes)
}

pub fn configure_artifact(f: &Fixture, item: Value, bytes: Vec<u8>) -> Value {
    let release = item["release"].clone();
    let sha = release["archiveSha256"].as_str().unwrap();
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[item],"nextCursor":""}),
    );
    f.respond(
        "/api/v1/client/market/items/item_research",
        200,
        item.clone(),
    );
    f.respond(
        "/api/v1/client/market/releases/rel_research",
        200,
        release.clone(),
    );
    f.respond(
        "/api/v1/client/market/featured",
        200,
        json!({"revision":1,"items":[release]}),
    );
    let acquisition =
        json!({"id":"acq_research","releaseId":"rel_research","status":"active","revision":1});
    f.respond(
        "/api/v1/client/market/acquisitions",
        200,
        acquisition.clone(),
    );
    f.respond("/api/v1/client/market/acquisitions/acq_research/download-tickets", 200, json!({"sha256":sha,"size":bytes.len(),"download":{"url":format!("{}/bundle",f.base),"method":"GET","headers":{},"expiresAt":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339()}}));
    let mut state = f.state.lock().unwrap();
    state.responses.insert("/bundle".into(), (200, bytes));
    let mut digest = Sha256::new();
    for value in ["original-install-attempt", "item_research", "acquire"] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    state.responses.insert(
        format!(
            "/api/v1/client/market/operations/{}",
            hex::encode(digest.finalize())
        ),
        (
            200,
            serde_json::to_vec(&json!({"result":acquisition})).unwrap(),
        ),
    );
    item
}
