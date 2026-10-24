use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Release {
    pub version: String,
    pub platforms: Vec<Platform>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Platform {
    pub os: String,
    pub arch: String,
    pub artifacts: Vec<Artifact>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Artifact {
    pub name: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub archive: Archive,
    pub root: String,
    pub executable: String,
    pub bin: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Archive {
    TarGz,
    Zip,
}

impl Release {
    pub fn current() -> Self {
        serde_json::from_str(include_str!("release.json"))
            .expect("compiled dependency release manifest must be valid")
    }

    pub fn platform(&self) -> Option<&Platform> {
        self.platforms.iter().find(|platform| {
            platform.os == std::env::consts::OS && platform.arch == std::env::consts::ARCH
        })
    }
}
