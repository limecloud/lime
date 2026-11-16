use super::*;
use pretty_assertions::assert_eq;

#[test]
fn resolves_only_executables_inside_installation_directories() {
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let executable = bin.join(format!("helper{}", std::env::consts::EXE_SUFFIX));
    std::fs::write(&executable, "installed helper").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(/*mode*/ 0o755))
            .unwrap();
    }
    let directories = vec![dunce::canonicalize(bin).unwrap()];
    assert_eq!(
        executable_in_directories("helper", &directories),
        Some(dunce::canonicalize(&executable).unwrap())
    );
    assert_eq!(executable_in_directories("../helper", &directories), None);
    assert_eq!(executable_in_directories("missing", &directories), None);
    #[cfg(unix)]
    {
        let outside = root.path().join("outside");
        std::fs::rename(&executable, &outside).unwrap();
        std::os::unix::fs::symlink(&outside, &executable).unwrap();
        assert_eq!(executable_in_directories("helper", &directories), None);
    }
}
