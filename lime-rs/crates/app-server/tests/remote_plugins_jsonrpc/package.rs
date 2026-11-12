use super::*;
use flate2::{write::GzEncoder, Compression};
use sha2::{Digest, Sha256};
use std::io::Cursor;

pub fn configure(f: &Fixture) -> Value {
    let files = [
        (
            ".lime-plugin/plugin.json",
            br#"{"name":"research","version":"1.0.0","skills":["./skills"]}"#.as_slice(),
        ),
        (
            "skills/research/SKILL.md",
            b"---\nname: research\ndescription: Research topics\n---\nResearch instructions\n"
                .as_slice(),
        ),
    ];
    let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::default()));
    let mut entries = Vec::new();
    for (path, bytes) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, path, Cursor::new(bytes))
            .unwrap();
        entries.push(format!(
            r#"{{"path":"{path}","sha256":"{}","size":{}}}"#,
            hex::encode(Sha256::digest(bytes)),
            bytes.len()
        ));
    }
    let bytes = archive.into_inner().unwrap().finish().unwrap();
    // Canonical field order is defined by Cloud's published manifest contract.
    let manifest = format!(
        r#"{{"schema_version":1,"kind":"plugin","name":"research","version":"1.0.0","title":{{"source":"Research","translations":{{}}}},"description":{{"source":"Research topics","translations":{{}}}},"license":"MIT","hosts":[{{"id":"lime","min_version":"1.0.0","capabilities":["plugins","skills","mcp"]}}],"files":[{}],"plugin":{{"entry":".lime-plugin/plugin.json","dependencies":[]}}}}"#,
        entries.join(",")
    );
    let sha = hex::encode(Sha256::digest(&bytes));
    let release = json!({"id":"rel_research","itemId":"item_research","manifest":serde_json::from_str::<Value>(&manifest).unwrap(),"manifestSha256":hex::encode(Sha256::digest(manifest.as_bytes())),"archiveSha256":sha,"archiveSize":bytes.len(),"status":"approved","revision":1});
    let item = json!({"id":"item_research","publisherApplicationId":"publisher","environment":"sandbox","kind":"plugin","name":"Research","publishedReleaseId":"rel_research","revision":1,"release":release,"compatibility":{"status":"supported","reasons":[]}});
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
    f.respond("/api/v1/client/market/releases/rel_research", 200, release);
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
