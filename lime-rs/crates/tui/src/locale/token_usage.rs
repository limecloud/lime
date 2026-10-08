use super::Locale;
use crate::bottom_pane::status_line_setup::StatusLineItem;

impl Locale {
    pub(crate) fn context_window_remaining(self, percent: i64) -> String {
        let percent = percent.clamp(0, 100);
        match self {
            Self::ZhCn => format!("{percent}% 上下文剩余"),
            Self::ZhTw => format!("{percent}% 上下文剩餘"),
            Self::EnUs => format!("{percent}% context left"),
            Self::JaJp => format!("{percent}% コンテキスト残量"),
            Self::KoKr => format!("{percent}% 컨텍스트 남음"),
        }
    }

    fn usage_copy(self, values: [&'static str; 5]) -> &'static str {
        values[match self {
            Self::ZhCn => 0,
            Self::ZhTw => 1,
            Self::EnUs => 2,
            Self::JaJp => 3,
            Self::KoKr => 4,
        }]
    }

    pub(crate) fn token_usage_item_name(self, item: StatusLineItem) -> &'static str {
        self.usage_copy(match item {
            StatusLineItem::UsedTokens => [
                "已用 token",
                "已用 token",
                "Used tokens",
                "使用済みトークン",
                "사용한 토큰",
            ],
            StatusLineItem::TotalInputTokens => [
                "累计输入 token",
                "累計輸入 token",
                "Total input tokens",
                "累計入力トークン",
                "총 입력 토큰",
            ],
            StatusLineItem::TotalOutputTokens => [
                "累计输出 token",
                "累計輸出 token",
                "Total output tokens",
                "累計出力トークン",
                "총 출력 토큰",
            ],
            StatusLineItem::ContextWindowSize => [
                "上下文窗口",
                "上下文視窗",
                "Context window size",
                "コンテキストウィンドウ",
                "컨텍스트 창 크기",
            ],
            StatusLineItem::ContextRemaining => [
                "上下文剩余",
                "上下文剩餘",
                "Context remaining",
                "コンテキスト残量",
                "남은 컨텍스트",
            ],
            StatusLineItem::ContextUsed => [
                "上下文已用",
                "上下文已用",
                "Context used",
                "使用済みコンテキスト",
                "사용한 컨텍스트",
            ],
            _ => unreachable!("only token usage items have usage labels"),
        })
    }

    pub(crate) fn token_usage_item_description(self, item: StatusLineItem) -> &'static str {
        self.usage_copy(match item {
            StatusLineItem::UsedTokens => [
                "累计非缓存输入与输出，零值省略",
                "累計非快取輸入與輸出，零值省略",
                "Total non-cached input and output, omitted when zero",
                "キャッシュ以外の累計入力と出力、ゼロは省略",
                "캐시 외 누적 입력 및 출력, 0이면 생략",
            ],
            StatusLineItem::TotalInputTokens => [
                "服务端报告的累计输入 token",
                "伺服器回報的累計輸入 token",
                "Total input tokens reported by the server",
                "サーバーが報告した累計入力トークン",
                "서버가 보고한 총 입력 토큰",
            ],
            StatusLineItem::TotalOutputTokens => [
                "服务端报告的累计输出 token",
                "伺服器回報的累計輸出 token",
                "Total output tokens reported by the server",
                "サーバーが報告した累計出力トークン",
                "서버가 보고한 총 출력 토큰",
            ],
            StatusLineItem::ContextWindowSize => [
                "服务端报告的模型上下文窗口大小",
                "伺服器回報的模型上下文視窗大小",
                "Model context window size reported by the server",
                "サーバーが報告したモデルのコンテキスト容量",
                "서버가 보고한 모델 컨텍스트 창 크기",
            ],
            StatusLineItem::ContextRemaining => [
                "最近用量对应的可用上下文百分比",
                "最近用量對應的可用上下文百分比",
                "Context remaining from the latest usage",
                "最新の使用量に基づくコンテキスト残量",
                "최근 사용량 기준 남은 컨텍스트 비율",
            ],
            StatusLineItem::ContextUsed => [
                "最近用量对应的已用上下文百分比",
                "最近用量對應的已用上下文百分比",
                "Context used from the latest usage",
                "最新の使用量に基づく使用済みコンテキスト",
                "최근 사용량 기준 사용한 컨텍스트 비율",
            ],
            _ => unreachable!("only token usage items have usage descriptions"),
        })
    }

    pub(crate) fn token_usage_value(self, item: StatusLineItem, value: &str) -> String {
        match item {
            StatusLineItem::UsedTokens => format!(
                "{value} {}",
                self.usage_copy(["已用", "已用", "used", "使用済み", "사용"])
            ),
            StatusLineItem::TotalInputTokens => format!(
                "{value} {}",
                self.usage_copy(["输入", "輸入", "in", "入力", "입력"])
            ),
            StatusLineItem::TotalOutputTokens => format!(
                "{value} {}",
                self.usage_copy(["输出", "輸出", "out", "出力", "출력"])
            ),
            StatusLineItem::ContextWindowSize => format!(
                "{value} {}",
                self.usage_copy(["窗口", "視窗", "window", "容量", "창"])
            ),
            StatusLineItem::ContextRemaining => format!(
                "{} {value}% {}",
                self.usage_copy(["上下文", "上下文", "Context", "コンテキスト", "컨텍스트"]),
                self.usage_copy(["剩余", "剩餘", "left", "残り", "남음"])
            ),
            StatusLineItem::ContextUsed => format!(
                "{} {value}% {}",
                self.usage_copy(["上下文", "上下文", "Context", "コンテキスト", "컨텍스트"]),
                self.usage_copy(["已用", "已用", "used", "使用済み", "사용"])
            ),
            _ => unreachable!("only token usage items have usage values"),
        }
    }
}
