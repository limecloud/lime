use crate::plugin_remote::wire::Item;
use app_server_protocol::protocol::v2::{
    PluginAuthPolicy, PluginAvailability, PluginDetail, PluginInstallPolicy, PluginInterface,
    PluginSource, PluginSummary,
};

impl Item {
    pub(crate) fn summary(&self, language: &str) -> PluginSummary {
        let manifest = &self.release.manifest;
        PluginSummary {
            id: format!("{}@{}", manifest.name, self.marketplace()),
            remote_plugin_id: Some(self.id.clone()),
            version: Some(manifest.version.clone()),
            local_version: None,
            name: manifest.name.clone(),
            source: PluginSource::Remote,
            installed: false,
            installed_at: None,
            enabled: false,
            install_policy: if self.compatibility.status == "supported" && self.release.compatible()
            {
                PluginInstallPolicy::Available
            } else {
                PluginInstallPolicy::NotAvailable
            },
            install_policy_source: None,
            must_show_installation_interstitial: None,
            auth_policy: PluginAuthPolicy::OnInstall,
            availability: PluginAvailability::Available,
            disabled_reason: None,
            eligible_plan_types: None,
            interface: Some(PluginInterface {
                display_name: Some(manifest.title.value(language)),
                short_description: Some(manifest.description.value(language)),
                long_description: None,
                developer_name: None,
                category: None,
                capabilities: Vec::new(),
                website_url: None,
                privacy_policy_url: None,
                terms_of_service_url: None,
                default_prompt: None,
                brand_color: None,
                composer_icon: None,
                composer_icon_url: None,
                logo: None,
                logo_dark: None,
                logo_url: None,
                logo_url_dark: None,
                screenshots: Vec::new(),
                screenshot_urls: Vec::new(),
            }),
            keywords: Vec::new(),
        }
    }
    pub(crate) fn detail(&self, language: &str) -> PluginDetail {
        PluginDetail {
            marketplace_name: self.marketplace(),
            marketplace_path: None,
            summary: self.summary(language),
            description: Some(self.release.manifest.description.value(language)),
            skills: Vec::new(),
            onboarding_skill: None,
            hooks: Vec::new(),
            apps: Vec::new(),
            app_templates: Vec::new(),
            mcp_servers: Vec::new(),
            scheduled_tasks: None,
        }
    }
}
