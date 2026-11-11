use super::*;
use crate::local_data_source::skills::common::resolve_skill_package_dir;
use std::io::Write;
use tempfile::TempDir;
use zip::write::SimpleFileOptions as TestZipFileOptions;
use zip::ZipWriter;

fn build_skill_zip(entries: &[(&str, &str)]) -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = TestZipFileOptions::default();
    for (path, content) in entries {
        writer.start_file(*path, options).expect("start zip entry");
        writer
            .write_all(content.as_bytes())
            .expect("write zip entry");
    }
    writer.finish().expect("finish zip").into_inner()
}

#[test]
fn inspect_local_skill_package_returns_stripped_file_tree() {
    let package = build_skill_zip(&[
        (
            "article-typesetting-master/SKILL.md",
            "---\nname: Article Typesetting\ndescription: typeset article\n---\n",
        ),
        ("article-typesetting-master/references/guide.md", "# Guide"),
        (
            "article-typesetting-master/templates/default.md",
            "# Template",
        ),
    ]);

    let result = inspect_skill_zip_package("article-typesetting-master", &package)
        .expect("local .skill package should inspect");

    assert_eq!(result.directory, "article-typesetting-master");
    assert!(result.inspection["content"]
        .as_str()
        .expect("inspection content")
        .contains("Article Typesetting"));
    assert_eq!(
        result
            .files
            .iter()
            .map(|entry| {
                (
                    entry["path"].as_str().expect("file path"),
                    entry["isDirectory"].as_bool().expect("is directory"),
                )
            })
            .collect::<Vec<_>>(),
        vec![
            ("references", true),
            ("templates", true),
            ("SKILL.md", false),
            ("references/guide.md", false),
            ("templates/default.md", false),
        ]
    );
}

#[test]
fn export_local_skill_package_to_path_writes_skill_zip() {
    let temp_dir = TempDir::new().expect("temp dir");
    let skill_root = temp_dir.path().join("skills");
    let source_dir = skill_root.join("writer");
    fs::create_dir_all(source_dir.join("references")).expect("create skill dir");
    fs::write(
        source_dir.join("SKILL.md"),
        "---\nname: Writer\ndescription: export me\n---\n\n# Writer\n",
    )
    .expect("write skill");
    fs::write(source_dir.join("references").join("guide.md"), "# Guide").expect("write reference");

    let export_path = temp_dir.path().join("exports").join("writer.skills");
    let result = export_local_skill_package_to_path(&[skill_root], "writer", &export_path)
        .expect("local Skill package should export");

    assert_eq!(result.directory, "writer");
    assert_eq!(result.output_path, export_path.to_string_lossy());
    assert_eq!(result.file_count, 2);
    assert!(result.bytes_written > 0);
    assert!(export_path.is_file());

    let export_file = fs::File::open(&export_path).expect("open export");
    let mut archive = ZipArchive::new(export_file).expect("read export zip");
    let mut names = Vec::new();
    for index in 0..archive.len() {
        names.push(
            archive
                .by_index(index)
                .expect("zip entry")
                .name()
                .expect("zip entry name")
                .to_string(),
        );
    }
    assert_eq!(names, vec!["writer/SKILL.md", "writer/references/guide.md"]);

    let mut skill_md = String::new();
    archive
        .by_name("writer/SKILL.md")
        .expect("skill md")
        .read_to_string(&mut skill_md)
        .expect("read skill md");
    assert!(skill_md.contains("# Writer"));
}

#[test]
fn local_skill_detail_rename_and_replace_use_current_helpers() {
    let temp_dir = TempDir::new().expect("temp dir");
    let skill_root = temp_dir.path().join("skills");
    let source_dir = skill_root.join("writer");
    fs::create_dir_all(source_dir.join("references")).expect("create skill dir");
    fs::write(
        source_dir.join("SKILL.md"),
        "---\nname: Writer\ndescription: inspect me\n---\n\n# Writer\n",
    )
    .expect("write skill");
    fs::write(source_dir.join("references").join("guide.md"), "# Guide").expect("write reference");

    let skill_dir =
        resolve_skill_package_dir(&[skill_root.clone()], "writer").expect("resolve local skill");
    let inspection = SkillService::inspect_skill_dir(&skill_dir).expect("inspect skill");
    let mut directories = BTreeSet::new();
    let mut files = Vec::new();
    collect_local_skill_detail_file_entries(&skill_dir, &skill_dir, &mut directories, &mut files)
        .expect("collect local files");
    assert!(inspection.content.contains("# Writer"));
    assert_eq!(
        directories.into_iter().collect::<Vec<_>>(),
        vec!["references"]
    );
    assert_eq!(
        files
            .iter()
            .map(|entry| entry["path"].as_str().expect("file path"))
            .collect::<Vec<_>>(),
        vec!["SKILL.md", "references/guide.md"]
    );

    let renamed_dir = skill_root.join("writer-renamed");
    fs::rename(&source_dir, &renamed_dir).expect("rename skill");
    assert!(renamed_dir.join("SKILL.md").is_file());
    assert!(!source_dir.exists());

    let replacement = build_skill_zip(&[
        (
            "writer-renamed/SKILL.md",
            "---\nname: Writer Updated\ndescription: replace me\n---\n\n# Updated\n",
        ),
        ("writer-renamed/assets/sample.txt", "asset"),
    ]);
    let package = read_skill_zip_package(&replacement).expect("read replacement package");
    let staged_parent = TempDir::new_in(&skill_root).expect("replacement staging");
    let staged_dir = staged_parent.path().join("writer-renamed");
    let staged = install_skill_zip_package_into_staged_dir(&staged_dir, "writer-renamed", package)
        .expect("stage replacement package");
    assert_eq!(staged.directory, "writer-renamed");
    assert!(staged.inspection["content"]
        .as_str()
        .expect("inspection content")
        .contains("# Updated"));

    let backup_dir = skill_root.join(".writer-renamed.replace-backup-test");
    fs::rename(&renamed_dir, &backup_dir).expect("backup existing skill");
    fs::rename(&staged_dir, &renamed_dir).expect("install replacement");
    fs::remove_dir_all(&backup_dir).expect("remove backup");

    let updated = fs::read_to_string(renamed_dir.join("SKILL.md")).expect("read updated skill");
    assert!(updated.contains("# Updated"));
    assert!(renamed_dir.join("assets").join("sample.txt").is_file());
}
