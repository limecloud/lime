//! Previous-prompt editing uses the same interaction vocabulary in all supported locales.

use super::Locale;

impl Locale {
    pub(crate) fn backtrack_unavailable(self) -> &'static str {
        match self {
            Self::ZhCn => "此对话不支持历史回退编辑。",
            Self::ZhTw => "此對話不支援歷史回退編輯。",
            Self::EnUs => "Previous-prompt editing is unavailable for this conversation.",
            Self::JaJp => "この会話では以前のメッセージを戻して編集できません。",
            Self::KoKr => "이 대화에서는 이전 메시지를 되돌려 편집할 수 없습니다.",
        }
    }

    pub(crate) fn backtrack_retry_footer(self) -> &'static str {
        match self {
            Self::ZhCn => "历史读取失败 · ← 重试 · esc 返回",
            Self::ZhTw => "歷史讀取失敗 · ← 重試 · esc 返回",
            Self::EnUs => "History unavailable · ← retry · esc back",
            Self::JaJp => "履歴を取得できません · ← 再試行 · esc 戻る",
            Self::KoKr => "기록을 불러올 수 없음 · ← 재시도 · esc 뒤로",
        }
    }

    pub(crate) fn backtrack_cursor_failed(self) -> &'static str {
        match self {
            Self::ZhCn => "历史分页位置没有前进",
            Self::ZhTw => "歷史分頁位置沒有前進",
            Self::EnUs => "history cursor did not advance",
            Self::JaJp => "履歴ページの位置が進みませんでした",
            Self::KoKr => "기록 페이지 위치가 진행되지 않음",
        }
    }

    pub(crate) fn backtrack_identity_failed(self) -> &'static str {
        match self {
            Self::ZhCn => "对话标识发生变化",
            Self::ZhTw => "對話識別發生變化",
            Self::EnUs => "thread identity changed",
            Self::JaJp => "会話の識別子が変更されました",
            Self::KoKr => "대화 식별자가 변경됨",
        }
    }
    pub(crate) fn esc_backtrack_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "esc 再按一次编辑上一条消息",
            Self::ZhTw => "esc 再按一次編輯上一則訊息",
            Self::EnUs => "esc again to edit previous message",
            Self::JaJp => "esc もう一度押して前のメッセージを編集",
            Self::KoKr => "esc 다시 눌러 이전 메시지 편집",
        }
    }

    pub(crate) fn esc_backtrack_hint_compact(self) -> &'static str {
        match self {
            Self::ZhCn => "esc 编辑上条",
            Self::ZhTw => "esc 編輯上則",
            Self::EnUs => "esc edit previous",
            Self::JaJp => "esc 前を編集",
            Self::KoKr => "esc 이전 편집",
        }
    }

    pub(crate) fn backtrack_label(self) -> &'static str {
        match self {
            Self::ZhCn => "浏览对话",
            Self::ZhTw => "瀏覽對話",
            Self::EnUs => "Browsing transcript",
            Self::JaJp => "会話を参照",
            Self::KoKr => "대화 탐색",
        }
    }

    pub(crate) fn backtrack_footers(self, details: Option<&str>) -> Vec<String> {
        let actions = match self {
            Self::ZhCn => ["选择消息", "详情", "回退编辑", "返回"],
            Self::ZhTw => ["選擇訊息", "詳情", "回退編輯", "返回"],
            Self::EnUs => ["prompts", "details", "rewind", "back"],
            Self::JaJp => ["メッセージ", "詳細", "戻して編集", "戻る"],
            Self::KoKr => ["메시지", "상세", "되돌려 편집", "뒤로"],
        };
        let details = details
            .map(|key| format!(" · {key} {}", actions[1]))
            .unwrap_or_default();
        vec![
            format!(
                "{} · ←→/hl {}{details} · ↵ {} · esc {}",
                self.backtrack_label(),
                actions[0],
                actions[2],
                actions[3]
            ),
            format!("←→ {} · ↵ {} · esc {}", actions[0], actions[2], actions[3]),
            format!("↵ {} · esc {}", actions[2], actions[3]),
            "←→ · ↵ · esc".to_string(),
            "↵ · esc".to_string(),
        ]
    }

    pub(crate) fn backtrack_loading(self) -> &'static str {
        match self {
            Self::ZhCn => "正在读取历史消息…",
            Self::ZhTw => "正在讀取歷史訊息…",
            Self::EnUs => "Loading previous messages…",
            Self::JaJp => "以前のメッセージを読み込み中…",
            Self::KoKr => "이전 메시지 불러오는 중…",
        }
    }

    pub(crate) fn backtrack_empty(self) -> &'static str {
        match self {
            Self::ZhCn => "没有可编辑的历史消息。",
            Self::ZhTw => "沒有可編輯的歷史訊息。",
            Self::EnUs => "No previous message to edit.",
            Self::JaJp => "編集できる以前のメッセージがありません。",
            Self::KoKr => "편집할 이전 메시지가 없습니다.",
        }
    }

    pub(crate) fn backtrack_failed(self, error: &str) -> String {
        let label = match self {
            Self::ZhCn => "历史编辑失败",
            Self::ZhTw => "歷史編輯失敗",
            Self::EnUs => "Previous message edit failed",
            Self::JaJp => "以前のメッセージの編集に失敗",
            Self::KoKr => "이전 메시지 편집 실패",
        };
        format!("{label}: {error}")
    }

    pub(crate) fn backtrack_refresh_failed(self, error: &str) -> String {
        let retry = match self {
            Self::ZhCn => "esc 重试读取历史",
            Self::ZhTw => "esc 重試讀取歷史",
            Self::EnUs => "esc retry history",
            Self::JaJp => "esc 履歴を再取得",
            Self::KoKr => "esc 기록 다시 불러오기",
        };
        format!("{} · {retry}", self.backtrack_failed(error))
    }

    pub(crate) fn backtrack_reverting(self) -> &'static str {
        match self {
            Self::ZhCn => "正在回退对话…",
            Self::ZhTw => "正在回退對話…",
            Self::EnUs => "Rewinding conversation…",
            Self::JaJp => "会話を巻き戻しています…",
            Self::KoKr => "대화를 되돌리는 중…",
        }
    }
}
