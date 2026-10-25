use super::*;
use crate::config::managed::compose_requirements;
use crate::config::AllowDenyRequirementToml::{Allow, Deny};

#[test]
fn computer_requirements_preserve_omission_and_explicit_false() {
    for source in [
        "",
        "[computer_use]",
        "[computer_use.macos]",
        "[computer_use.windows]",
    ] {
        assert!(
            ConfigRequirements::parse(source).unwrap().is_empty(),
            "{source}"
        );
    }
    let requirements = ConfigRequirements::parse("[computer_use]\nallow_locked_computer_use = false\nallow_persistent_approval = false\ndefault_app_access = 'deny'").unwrap();
    assert!(!requirements.is_empty());
    let computer = requirements.computer_use.unwrap();
    assert_eq!(computer.allow_locked_computer_use, Some(false));
    assert_eq!(computer.allow_persistent_approval, Some(false));
    assert_eq!(computer.default_app_access, Some(Deny));
}

#[test]
fn computer_requirements_reject_malformed_and_unknown_policy() {
    for source in [
        "[computer_use]\nallow_persistent_approval = 'false'",
        "[computer_use]\nallow_locked_computer_use = 1",
        "[computer_use]\ndefault_app_access = 'ask'",
        "[computer_use]\nallow_everything = true",
        "[computer_use.macos]\nbundle_id = {}",
        "[computer_use.macos.bundle_ids]\n'com.example.Editor' = false",
        "[computer_use.windows]\nexe = []",
        "[[computer_use.windows.exes]]\npublisher_name='Example'\nproduct_name='Editor'\naccess='allow'\nunknown=true",
    ] {
        assert!(ConfigRequirements::parse(source).is_err(), "{source}");
    }
}

#[test]
fn computer_admin_composition_keeps_unmentioned_system_rules() {
    let system = ConfigRequirements::parse(
        r#"
        [computer_use]
        allow_locked_computer_use = false
        allow_persistent_approval = false
        [computer_use.macos.bundle_ids]
        'com.example.System' = 'deny'
        'com.example.Editor' = 'deny'
        [computer_use.windows.aumids]
        'Example!System' = 'deny'
        [[computer_use.windows.exes]]
        publisher_name = 'CN=Example'
        product_name = 'Editor'
        access = 'deny'
    "#,
    )
    .unwrap();
    let explicit = ConfigRequirements::parse(
        r#"
        [computer_use]
        default_app_access = 'deny'
        [computer_use.macos.bundle_ids]
        'com.example.Editor' = 'allow'
        [computer_use.windows.aumids]
        'Example!Editor' = 'allow'
        [[computer_use.windows.exes]]
        publisher_name = 'CN=Example'
        product_name = 'Editor'
        access = 'allow'
    "#,
    )
    .unwrap();
    let computer = compose_requirements(Some(system), None, Some(explicit))
        .unwrap()
        .unwrap()
        .computer_use
        .unwrap();
    assert_eq!(computer.allow_locked_computer_use, Some(false));
    assert_eq!(computer.allow_persistent_approval, Some(false));
    let macos = computer.macos.unwrap().bundle_ids.unwrap();
    assert_eq!(macos["com.example.System"], Deny);
    assert_eq!(macos["com.example.Editor"], Allow);
    let windows = computer.windows.unwrap();
    assert_eq!(windows.aumids.as_ref().unwrap()["Example!System"], Deny);
    assert_eq!(windows.aumids.as_ref().unwrap()["Example!Editor"], Allow);
    let exes = windows.exes.unwrap();
    assert_eq!(exes.len(), 1);
    assert_eq!(exes[0].access, Allow);
}

#[test]
fn computer_admin_exe_array_uses_upstream_regular_toml_replacement() {
    let system = ConfigRequirements::parse(
        r#"
        [computer_use]
        allow_persistent_approval = false
        [[computer_use.windows.exes]]
        publisher_name = 'CN=Example'
        product_name = 'Editor'
        access = 'deny'
    "#,
    )
    .unwrap();
    let explicit = ConfigRequirements::parse("[computer_use.windows]\nexes=[]").unwrap();
    let result = compose_requirements(Some(system), None, Some(explicit))
        .unwrap()
        .unwrap();
    assert_eq!(
        result
            .computer_use
            .unwrap()
            .windows
            .unwrap()
            .exes
            .unwrap()
            .len(),
        0
    );
}
