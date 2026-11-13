use super::*;

fn release(index: usize) -> Release {
    let fixtures: serde_json::Value =
        serde_json::from_str(include_str!("../testdata/cloud-market-types.json")).unwrap();
    serde_json::from_value(fixtures[index]["item"]["release"].clone()).unwrap()
}

#[test]
fn market_http_mcp_preserves_endpoint_tools_and_oauth_scopes() {
    let release = release(1);
    let config = mcp_config(Path::new("/unused"), &release, "fixture").unwrap();
    assert!(config.enabled);
    assert_eq!(config.enabled_tools, Some(vec!["search".into()]));
    assert_eq!(config.scopes, Some(vec!["research:read".into()]));
    assert!(config.oauth.is_some());
    let McpServerTransport::StreamableHttp {
        url,
        bearer_token_env_var,
        http_headers,
        env_http_headers,
    } = config.transport
    else {
        panic!()
    };
    assert_eq!(url, "https://mcp.test.invalid/mcp");
    assert!(bearer_token_env_var.is_none() && http_headers.is_none() && env_http_headers.is_none());
}

#[test]
fn market_bearer_configuration_references_a_private_environment_value() {
    let mut release = release(1);
    release.manifest.mcp.as_mut().unwrap().auth.r#type = "bearer".into();
    let name = mcp_name("account-one:research@publisher", &release);
    let other = mcp_name("account-two:research@publisher", &release);
    assert_ne!(name, other);
    let config = mcp_config(Path::new("/unused"), &release, &name).unwrap();
    let McpServerTransport::StreamableHttp {
        bearer_token_env_var,
        ..
    } = config.transport
    else {
        panic!()
    };
    assert_eq!(
        bearer_token_env_var,
        Some(format!("LIME_MCP_{}_TOKEN", name.to_ascii_uppercase()))
    );
    assert!(config.oauth.is_none() && config.scopes.is_none());
}

#[test]
fn market_stdio_cannot_silently_drop_a_declared_http_authentication_requirement() {
    let mut release = release(2);
    release.manifest.mcp.as_mut().unwrap().auth.r#type = "oauth2".into();
    assert!(mcp_config(Path::new("/unused"), &release, "fixture").is_err());
}

#[test]
fn market_skill_loads_only_the_declared_file_including_a_root_entry() {
    let mut release = release(0);
    release.manifest.skill.as_mut().unwrap().entry = "SKILL.md".into();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("SKILL.md"),
        b"---\nname: research\ndescription: Research topics\n---\nInstructions\n",
    )
    .unwrap();
    let loaded = skill(root.path(), &release).unwrap();
    assert_eq!(loaded.name, "research");
    assert_eq!(
        loaded.skill_file_path,
        root.path().join("SKILL.md").canonicalize().unwrap()
    );
    assert_eq!(
        loaded.authority,
        lime_skills::AgentSkillAuthority::Application
    );
    std::fs::write(root.path().join("SKILL.md"), b"not a valid skill").unwrap();
    assert!(skill(root.path(), &release).is_err());
}
