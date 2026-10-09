//! Localized labels for the non-interactive presentation surface.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum Locale {
    ZhCn,
    ZhTw,
    #[default]
    EnUs,
    JaJp,
    KoKr,
}

#[derive(Clone, Copy)]
pub(super) enum Label {
    Exec,
    ApplyPatch,
    Patch,
    WebSearch,
    Collab,
    Started,
    Completed,
    Failed,
    Declined,
    InProgress,
    Running,
    Succeeded,
    Exited,
    Compacted,
    Warning,
    Error,
    Interrupted,
    TokensUsed,
    ModelRerouted,
    SessionId,
}

impl Locale {
    fn parse(value: &str) -> Option<Self> {
        let value = value
            .trim()
            .split(['.', '@'])
            .next()
            .unwrap_or_default()
            .replace('_', "-")
            .to_ascii_lowercase();
        if value == "zh-tw" || value.starts_with("zh-tw-") || value.starts_with("zh-hant") {
            Some(Self::ZhTw)
        } else if value == "zh"
            || value == "zh-cn"
            || value.starts_with("zh-cn-")
            || value.starts_with("zh-hans")
        {
            Some(Self::ZhCn)
        } else if value == "ja" || value.starts_with("ja-") {
            Some(Self::JaJp)
        } else if value == "ko" || value.starts_with("ko-") {
            Some(Self::KoKr)
        } else if value == "en" || value.starts_with("en-") {
            Some(Self::EnUs)
        } else {
            None
        }
    }

    pub(super) fn resolve(explicit: Option<&str>) -> Self {
        Self::resolve_values(
            explicit.into_iter().map(str::to_owned).chain(
                ["LIME_LOCALE", "LC_ALL", "LANG"]
                    .into_iter()
                    .filter_map(|key| std::env::var(key).ok()),
            ),
        )
    }

    fn resolve_values(values: impl IntoIterator<Item = String>) -> Self {
        values
            .into_iter()
            .find_map(|value| Self::parse(&value))
            .unwrap_or_default()
    }

    pub(super) fn label(self, label: Label) -> &'static str {
        let values = match label {
            Label::SessionId => [
                "会话 ID",
                "對話 ID",
                "session id",
                "セッション ID",
                "세션 ID",
            ],
            Label::Exec => ["执行", "執行", "exec", "実行", "실행"],
            Label::ApplyPatch => [
                "应用补丁",
                "套用修補",
                "apply patch",
                "パッチ適用",
                "패치 적용",
            ],
            Label::Patch => ["补丁:", "修補:", "patch:", "パッチ:", "패치:"],
            Label::WebSearch => [
                "网页搜索:",
                "網頁搜尋:",
                "web search:",
                "ウェブ検索:",
                "웹 검색:",
            ],
            Label::Collab => ["协作:", "協作:", "collab:", "共同作業:", "협업:"],
            Label::Started => ["已开始", "已開始", "started", "開始", "시작됨"],
            Label::Completed => ["已完成", "已完成", "completed", "完了", "완료됨"],
            Label::Failed => ["失败", "失敗", "failed", "失敗", "실패"],
            Label::Declined => ["已拒绝", "已拒絕", "declined", "拒否", "거부됨"],
            Label::InProgress => ["进行中", "進行中", "in_progress", "実行中", "진행 중"],
            Label::Running => ["进行中", "進行中", "in progress", "実行中", "진행 중"],
            Label::Succeeded => ["成功", "成功", "succeeded", "成功", "성공"],
            Label::Exited => ["退出码", "結束碼", "exited", "終了コード", "종료 코드"],
            Label::Compacted => [
                "上下文已压缩",
                "上下文已壓縮",
                "context compacted",
                "コンテキスト圧縮完了",
                "컨텍스트 압축됨",
            ],
            Label::Warning => ["警告:", "警告:", "warning:", "警告:", "경고:"],
            Label::Error => ["错误:", "錯誤:", "ERROR:", "エラー:", "오류:"],
            Label::Interrupted => [
                "回合已中断",
                "回合已中斷",
                "turn interrupted",
                "ターン中断",
                "턴 중단됨",
            ],
            Label::TokensUsed => [
                "已用 token",
                "已用 token",
                "tokens used",
                "使用トークン",
                "사용 토큰",
            ],
            Label::ModelRerouted => [
                "模型已切换:",
                "模型已切換:",
                "model rerouted:",
                "モデル切替:",
                "모델 변경:",
            ],
        };
        values[match self {
            Self::ZhCn => 0,
            Self::ZhTw => 1,
            Self::EnUs => 2,
            Self::JaJp => 3,
            Self::KoKr => 4,
        }]
    }

    pub(super) fn command(self, command: &str, cwd: &str) -> String {
        match self {
            Self::EnUs => format!("{command} in {cwd}"),
            _ => format!("{command} ({cwd})"),
        }
    }

    pub(super) fn duration(self, duration_ms: i64) -> String {
        match self {
            Self::EnUs => format!(" in {duration_ms}ms"),
            _ => format!(" ({duration_ms}ms)"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_locale_precedes_environment_and_unknown_values_fall_through() {
        for (value, expected) in [
            ("zh_CN.UTF-8", Locale::ZhCn),
            ("zh-Hant", Locale::ZhTw),
            ("en-US.UTF-8", Locale::EnUs),
            ("ja_JP.UTF-8", Locale::JaJp),
            ("ko-KR", Locale::KoKr),
        ] {
            assert_eq!(
                Locale::resolve_values([value.into(), "en-US".into()]),
                expected
            );
        }
        assert_eq!(
            Locale::resolve_values(["auto".into(), "zh-TW".into()]),
            Locale::ZhTw
        );
        assert_eq!(Locale::resolve_values(["C.UTF-8".into()]), Locale::EnUs);
    }
}
