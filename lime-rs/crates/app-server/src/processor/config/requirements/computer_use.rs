use app_server_protocol::protocol::v2::{
    AllowDenyRequirement, ComputerUseMacosRequirements, ComputerUseRequirements,
    ComputerUseWindowsExeRequirement, ComputerUseWindowsRequirements,
};
use lime_core::config::{AllowDenyRequirementToml, ComputerUseRequirementsToml};

pub(super) fn computer_requirements(
    source: ComputerUseRequirementsToml,
) -> ComputerUseRequirements {
    let decision = |value| match value {
        AllowDenyRequirementToml::Allow => AllowDenyRequirement::Allow,
        AllowDenyRequirementToml::Deny => AllowDenyRequirement::Deny,
    };
    ComputerUseRequirements {
        allow_locked_computer_use: source.allow_locked_computer_use,
        allow_persistent_approval: source.allow_persistent_approval,
        default_app_access: source.default_app_access.map(decision),
        macos: source.macos.map(|macos| ComputerUseMacosRequirements {
            bundle_ids: macos.bundle_ids.map(|ids| {
                ids.into_iter()
                    .map(|(id, access)| (id, decision(access)))
                    .collect()
            }),
        }),
        windows: source
            .windows
            .map(|windows| ComputerUseWindowsRequirements {
                aumids: windows.aumids.map(|ids| {
                    ids.into_iter()
                        .map(|(id, access)| (id, decision(access)))
                        .collect()
                }),
                exes: windows.exes.map(|exes| {
                    exes.into_iter()
                        .map(|exe| ComputerUseWindowsExeRequirement {
                            publisher_name: exe.publisher_name,
                            product_name: exe.product_name,
                            binary_name: exe.binary_name,
                            access: decision(exe.access),
                        })
                        .collect()
                }),
            }),
    }
}
