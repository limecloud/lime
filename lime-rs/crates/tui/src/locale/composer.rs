use super::Locale;

impl Locale {
    pub(crate) fn user_input_too_large_message(self, actual_chars: usize) -> String {
        let limit = agent_protocol::input::MAX_USER_INPUT_TEXT_CHARS;
        match self {
            Self::ZhCn => format!("消息超过 {limit} 字符上限（当前 {actual_chars} 字符）。"),
            Self::ZhTw => format!("訊息超過 {limit} 字元上限（目前 {actual_chars} 字元）。"),
            Self::EnUs => format!(
                "Message exceeds the maximum length of {limit} characters ({actual_chars} provided)."
            ),
            Self::JaJp => format!("メッセージが上限の {limit} 文字を超えています（現在 {actual_chars} 文字）。"),
            Self::KoKr => format!("메시지가 최대 {limit}자를 초과했습니다(현재 {actual_chars}자)."),
        }
    }

    pub(crate) fn history_search_pending(self) -> &'static str {
        match self {
            Self::ZhCn => "搜索中…",
            Self::ZhTw => "搜尋中…",
            Self::EnUs => "searching…",
            Self::JaJp => "検索中…",
            Self::KoKr => "검색 중…",
        }
    }

    pub(crate) fn history_search_unavailable(self) -> &'static str {
        match self {
            Self::ZhCn => "历史暂不可用",
            Self::ZhTw => "歷史暫不可用",
            Self::EnUs => "history unavailable",
            Self::JaJp => "履歴を利用できません",
            Self::KoKr => "기록을 사용할 수 없음",
        }
    }

    pub(crate) fn history_search_actions(self) -> (&'static str, &'static str) {
        match self {
            Self::ZhCn => ("接受", "取消"),
            Self::ZhTw => ("接受", "取消"),
            Self::EnUs => ("accept", "cancel"),
            Self::JaJp => ("採用", "キャンセル"),
            Self::KoKr => ("선택", "취소"),
        }
    }

    pub(crate) fn history_search_no_match(self) -> &'static str {
        match self {
            Self::ZhCn => "无匹配",
            Self::ZhTw => "無符合項目",
            Self::EnUs => "no match",
            Self::JaJp => "一致なし",
            Self::KoKr => "일치 없음",
        }
    }

    pub(crate) fn pasted_content_label(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("[已粘贴内容 {count} 字符]"),
            Self::ZhTw => format!("[已貼上內容 {count} 字元]"),
            Self::EnUs => format!("[Pasted Content {count} chars]"),
            Self::JaJp => format!("[貼り付けた内容 {count} 文字]"),
            Self::KoKr => format!("[붙여넣은 내용 {count}자]"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn size_rejection_is_localized_for_all_product_locales() {
        for (locale, expected) in [
            (
                Locale::ZhCn,
                "消息超过 1048576 字符上限（当前 1048577 字符）。",
            ),
            (
                Locale::ZhTw,
                "訊息超過 1048576 字元上限（目前 1048577 字元）。",
            ),
            (
                Locale::EnUs,
                "Message exceeds the maximum length of 1048576 characters (1048577 provided).",
            ),
            (
                Locale::JaJp,
                "メッセージが上限の 1048576 文字を超えています（現在 1048577 文字）。",
            ),
            (
                Locale::KoKr,
                "메시지가 최대 1048576자를 초과했습니다(현재 1048577자).",
            ),
        ] {
            assert_eq!(locale.user_input_too_large_message(1048577), expected);
        }
    }
}
