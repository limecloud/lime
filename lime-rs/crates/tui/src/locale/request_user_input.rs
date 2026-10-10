//! Question choices and unanswered confirmation copy for all product locales.

use super::Locale;

impl Locale {
    pub(crate) fn other_option_label(self) -> &'static str {
        match self {
            Self::ZhCn => "以上都不是",
            Self::ZhTw => "以上皆非",
            Self::EnUs => "None of the above",
            Self::JaJp => "上記のいずれでもない",
            Self::KoKr => "위 항목에 해당 없음",
        }
    }

    pub(crate) fn other_option_description(self) -> &'static str {
        match self {
            Self::ZhCn => "可在备注中补充说明（tab）",
            Self::ZhTw => "可在備註中補充說明（tab）",
            Self::EnUs => "Optionally, add details in notes (tab)",
            Self::JaJp => "必要に応じてメモに詳細を追加（tab）",
            Self::KoKr => "필요하면 메모에 세부 정보 추가 (tab)",
        }
    }

    pub(crate) fn request_unanswered_count(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("{count} 个未回答"),
            Self::ZhTw => format!("{count} 個未回答"),
            Self::EnUs => format!("{count} unanswered"),
            Self::JaJp => format!("未回答 {count} 件"),
            Self::KoKr => format!("미응답 {count}개"),
        }
    }

    pub(crate) fn unanswered_confirm_title(self) -> &'static str {
        match self {
            Self::ZhCn => "有未回答的问题，仍要提交吗？",
            Self::ZhTw => "有未回答的問題，仍要提交嗎？",
            Self::EnUs => "Submit with unanswered questions?",
            Self::JaJp => "未回答の質問を残して送信しますか？",
            Self::KoKr => "답하지 않은 질문을 남기고 제출할까요?",
        }
    }

    pub(crate) fn unanswered_confirm_submit(self) -> &'static str {
        match self {
            Self::ZhCn => "继续提交",
            Self::ZhTw => "繼續提交",
            Self::EnUs => "Proceed",
            Self::JaJp => "送信する",
            Self::KoKr => "제출하기",
        }
    }

    pub(crate) fn unanswered_submit_description(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("提交，保留 {count} 个问题未回答"),
            Self::ZhTw => format!("提交，保留 {count} 個問題未回答"),
            Self::EnUs => format!(
                "Submit with {count} unanswered {}",
                if count == 1 { "question" } else { "questions" }
            ),
            Self::JaJp => format!("未回答の質問 {count} 件を残して送信"),
            Self::KoKr => format!("질문 {count}개에 답하지 않고 제출"),
        }
    }

    pub(crate) fn unanswered_confirm_go_back(self) -> &'static str {
        match self {
            Self::ZhCn => "返回编辑",
            Self::ZhTw => "返回編輯",
            Self::EnUs => "Go back",
            Self::JaJp => "戻る",
            Self::KoKr => "돌아가기",
        }
    }

    pub(crate) fn unanswered_go_back_description(self) -> &'static str {
        match self {
            Self::ZhCn => "返回第一个未回答的问题",
            Self::ZhTw => "返回第一個未回答的問題",
            Self::EnUs => "Return to the first unanswered question",
            Self::JaJp => "最初の未回答の質問に戻る",
            Self::KoKr => "첫 번째 미응답 질문으로 돌아가기",
        }
    }
}
