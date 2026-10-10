use super::Locale;
use crate::external_editor::EditorError;

impl Locale {
    pub(crate) fn external_editor_failed(self, error: &anyhow::Error) -> String {
        let index = match self {
            Self::ZhCn => 0,
            Self::ZhTw => 1,
            Self::EnUs => 2,
            Self::JaJp => 3,
            Self::KoKr => 4,
        };
        let detail = match error.downcast_ref::<EditorError>() {
            Some(EditorError::MissingEditor) => {
                return [
                    "无法打开外部编辑器：请在启动 Lime 前设置 $VISUAL 或 $EDITOR。",
                    "無法開啟外部編輯器：請在啟動 Lime 前設定 $VISUAL 或 $EDITOR。",
                    "Cannot open external editor: set $VISUAL or $EDITOR before starting Lime.",
                    "外部エディターを開けません。Lime の起動前に $VISUAL または $EDITOR を設定してください。",
                    "외부 편집기를 열 수 없습니다. Lime을 시작하기 전에 $VISUAL 또는 $EDITOR를 설정하세요.",
                ][index].to_string();
            }
            #[cfg(not(windows))]
            Some(EditorError::ParseFailed) => [
                "无法解析编辑器命令",
                "無法解析編輯器命令",
                "failed to parse editor command",
                "エディターのコマンドを解析できません",
                "편집기 명령을 해석할 수 없습니다",
            ][index]
                .to_string(),
            Some(EditorError::EmptyCommand) => [
                "编辑器命令为空",
                "編輯器命令為空",
                "editor command is empty",
                "エディターのコマンドが空です",
                "편집기 명령이 비어 있습니다",
            ][index]
                .to_string(),
            None => format!("{error:#}"),
        };
        let prefix = [
            "打开编辑器失败",
            "開啟編輯器失敗",
            "Failed to open editor",
            "エディターを開けません",
            "편집기를 열 수 없습니다",
        ][index];
        format!("{prefix}: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_errors_keep_localized_guidance_and_process_details_in_all_five_languages() {
        for (locale, guidance, prefix, empty) in [
            (
                Locale::ZhCn,
                "请在启动 Lime 前设置",
                "打开编辑器失败",
                "编辑器命令为空",
            ),
            (
                Locale::ZhTw,
                "請在啟動 Lime 前設定",
                "開啟編輯器失敗",
                "編輯器命令為空",
            ),
            (
                Locale::EnUs,
                "before starting Lime",
                "Failed to open editor",
                "editor command is empty",
            ),
            (
                Locale::JaJp,
                "起動前に",
                "エディターを開けません",
                "エディターのコマンドが空です",
            ),
            (
                Locale::KoKr,
                "시작하기 전에",
                "편집기를 열 수 없습니다",
                "편집기 명령이 비어 있습니다",
            ),
        ] {
            let missing = locale.external_editor_failed(&EditorError::MissingEditor.into());
            for expected in [guidance, "$VISUAL", "$EDITOR"] {
                assert!(missing.contains(expected), "{locale:?}: {missing}");
            }
            assert_eq!(
                locale.external_editor_failed(&EditorError::EmptyCommand.into()),
                format!("{prefix}: {empty}")
            );
            let process_error = anyhow::anyhow!("exit 7").context("editor process");
            assert_eq!(
                locale.external_editor_failed(&process_error),
                format!("{prefix}: editor process: exit 7")
            );
            #[cfg(not(windows))]
            {
                let parse_error = locale.external_editor_failed(&EditorError::ParseFailed.into());
                assert!(parse_error.starts_with(prefix), "{locale:?}: {parse_error}");
                assert_ne!(parse_error, format!("{prefix}: {empty}"));
                if locale != Locale::EnUs {
                    assert!(!parse_error.contains("failed to parse editor command"));
                }
            }
        }
    }
}
