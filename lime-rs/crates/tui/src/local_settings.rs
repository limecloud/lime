//! Client-owned settings resolved from the App Server user configuration layer.
//!
//! The TUI never reads config files directly. `config/read` is the only load boundary, and the
//! resolved runtime keymap remains immutable for the lifetime of one TUI process.

use anyhow::{Context, Result};
use lime_core::config::TuiConfig;
use serde_json::Value;

use crate::app_server_session::AppServerSession;
use crate::keymap::RuntimeKeymap;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct LocalSettings {
    pub(crate) keymap: RuntimeKeymap,
    pub(crate) tui: TuiConfig,
    pub(crate) config_version: Option<String>,
}

impl LocalSettings {
    pub(crate) async fn read(session: &AppServerSession) -> Result<Self> {
        let response = session.read_config().await?;
        let mut settings = Self::from_config_value(&response.config)?;
        settings.config_version = response
            .layers
            .as_ref()
            .and_then(|layers| layers.first())
            .map(|layer| layer.version.clone());
        Ok(settings)
    }

    fn from_config_value(config: &Value) -> Result<Self> {
        let tui = config
            .get("tui")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default()));
        let tui: TuiConfig = serde_json::from_value(tui)
            .context("App Server config/read returned an invalid `tui` configuration")?;
        let keymap = RuntimeKeymap::from_config(&tui.keymap)
            .map_err(anyhow::Error::msg)
            .context("invalid TUI keymap")?;
        Ok(Self {
            keymap,
            tui,
            config_version: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::{GlobalKeymapAction, KeyChordMatcher, KeymapMatch};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use lime_core::config::RightClickPaste;
    use serde_json::json;

    #[test]
    fn config_read_value_resolves_a_runtime_snapshot() {
        let settings = LocalSettings::from_config_value(&json!({
            "tui": {
                "keymap": {
                    "global": {"find_transcript": "ctrl-x f"}
                }
            }
        }))
        .expect("valid local settings");
        assert_eq!(settings.tui.right_click_paste, RightClickPaste::Auto);
        let mut matcher = KeyChordMatcher::default();
        assert_eq!(
            settings.keymap.transcript().dispatch_global(
                &mut matcher,
                KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL),
            ),
            KeymapMatch::Pending
        );
        assert_eq!(
            settings.keymap.transcript().dispatch_global(
                &mut matcher,
                KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE),
            ),
            KeymapMatch::Completed(GlobalKeymapAction::FindTranscript)
        );
    }

    #[test]
    fn config_read_value_rejects_ambiguous_runtime_bindings() {
        let error = LocalSettings::from_config_value(&json!({
            "tui": {
                "keymap": {
                    "global": {
                        "open_transcript": "f6",
                        "find_transcript": "f6"
                    }
                }
            }
        }))
        .expect_err("conflict must fail closed");
        assert!(error.to_string().contains("invalid TUI keymap"));
    }

    #[test]
    fn config_read_value_resolves_right_click_paste_policy() {
        let settings = LocalSettings::from_config_value(&json!({
            "tui": {"right_click_paste": "off"}
        }))
        .expect("valid local settings");
        assert_eq!(settings.tui.right_click_paste, RightClickPaste::Off);
    }

    #[test]
    fn config_read_value_preserves_order_empty_and_colors_without_a_private_default() {
        for ids in [json!([]), json!(["current-dir", "model"])] {
            let settings = LocalSettings::from_config_value(
                &json!({"tui": {"status_line": ids, "status_line_use_colors": false, "terminal_title": ids}}),
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(&settings.tui).unwrap()["status_line"],
                ids
            );
            assert_eq!(
                serde_json::to_value(&settings.tui).unwrap()["terminal_title"],
                ids
            );
            assert!(!settings.tui.status_line_use_colors);
        }
        let settings = LocalSettings::from_config_value(&json!({})).unwrap();
        assert_eq!(settings.tui, TuiConfig::default());
    }

    #[test]
    fn config_read_value_resolves_editor_bindings_and_rejects_global_shadowing() {
        let settings = LocalSettings::from_config_value(&json!({
            "tui":{"keymap":{"editor":{"insert_newline":"f11", "delete_forward":[]}}}
        }))
        .unwrap();
        let mut composer = crate::bottom_pane::BottomPane::default();
        composer.set_keymap_bindings(&settings.keymap);
        composer.insert_str("abc");
        composer.handle_key_event(KeyEvent::new(KeyCode::F(11), KeyModifiers::NONE));
        composer.handle_key_event(KeyEvent::new(KeyCode::Delete, KeyModifiers::NONE));
        assert_eq!(composer.composer_text(), "abc\n");
        let error = LocalSettings::from_config_value(&json!({
            "tui":{"keymap":{"global":{"open_agents":"ctrl-n"}}}
        }))
        .unwrap_err();
        assert!(format!("{error:#}").contains("editor.move_down"));
    }

    #[test]
    fn config_read_value_resolves_list_bindings_and_hints_from_one_snapshot() {
        let settings = LocalSettings::from_config_value(
            &json!({"tui":{"keymap":{"list":{"accept":"f9", "cancel":"ctrl-x q"}}}}),
        )
        .unwrap();
        let list = settings.keymap.list();
        assert_eq!(
            list.primary_hint(crate::keymap::ListAction::Accept)
                .as_deref(),
            Some("f9")
        );
        assert_eq!(
            list.dispatch(
                &mut KeyChordMatcher::default(),
                KeyEvent::new(KeyCode::F(9), KeyModifiers::NONE),
                true
            ),
            KeymapMatch::Completed(crate::keymap::ListAction::Accept)
        );
        assert_eq!(
            list.dispatch(
                &mut KeyChordMatcher::default(),
                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
                true
            ),
            KeymapMatch::PassThrough
        );
    }
}
