//! Model picker labels share the product locales; catalog facts remain server-owned.

use super::Locale;

impl Locale {
    pub(crate) fn agent_picker_title(self) -> &'static str {
        match self {
            Self::ZhCn => "子 Agent",
            Self::ZhTw => "子 Agent",
            Self::EnUs => "Subagents",
            Self::JaJp => "サブエージェント",
            Self::KoKr => "하위 에이전트",
        }
    }

    pub(crate) fn agent_picker_empty(self) -> &'static str {
        match self {
            Self::ZhCn => "暂无可用的子 Agent",
            Self::ZhTw => "目前沒有可用的子 Agent",
            Self::EnUs => "No sub-agents available",
            Self::JaJp => "利用可能なサブエージェントがありません",
            Self::KoKr => "사용 가능한 하위 에이전트가 없습니다",
        }
    }

    pub(crate) fn agent_picker_subtitle(self, previous: &str, next: &str) -> String {
        match self {
            Self::ZhCn => format!("选择要查看的 Agent。{previous} 上一个，{next} 下一个。"),
            Self::ZhTw => format!("選擇要檢視的 Agent。{previous} 上一個，{next} 下一個。"),
            Self::EnUs => format!("Select an agent to watch. {previous} previous, {next} next."),
            Self::JaJp => format!("表示するエージェントを選択。{previous} 前へ、{next} 次へ。"),
            Self::KoKr => format!("볼 에이전트를 선택하세요. {previous} 이전, {next} 다음."),
        }
    }

    pub(crate) fn picker_empty(self) -> &'static str {
        match self {
            Self::ZhCn => "没有匹配的模型",
            Self::ZhTw => "沒有符合的模型",
            Self::EnUs => "No matching models",
            Self::JaJp => "一致するモデルがありません",
            Self::KoKr => "일치하는 모델이 없습니다",
        }
    }

    pub(crate) fn resume_toolbar_label(self, control: &str) -> &'static str {
        match (self, control) {
            (Self::ZhCn, "filter") => "目录",
            (Self::ZhCn, "status") => "状态",
            (Self::ZhCn, "sort") => "排序",
            (Self::ZhTw, "filter") => "目錄",
            (Self::ZhTw, "status") => "狀態",
            (Self::ZhTw, "sort") => "排序",
            (Self::EnUs, "filter") => "Filter",
            (Self::EnUs, "status") => "Status",
            (Self::EnUs, "sort") => "Sort",
            (Self::JaJp, "filter") => "絞り込み",
            (Self::JaJp, "status") => "状態",
            (Self::JaJp, "sort") => "並び順",
            (Self::KoKr, "filter") => "필터",
            (Self::KoKr, "status") => "상태",
            (Self::KoKr, "sort") => "정렬",
            _ => "",
        }
    }

    pub(crate) fn resume_search_label(self) -> &'static str {
        match self {
            Self::ZhCn => "搜索",
            Self::ZhTw => "搜尋",
            Self::EnUs => "Search",
            Self::JaJp => "検索",
            Self::KoKr => "검색",
        }
    }

    pub(crate) fn resume_escape_hint(self, key: &str, has_query: bool) -> String {
        let label = match (self, has_query) {
            (Self::ZhCn, false) => "关闭",
            (Self::ZhCn, true) => "清空搜索",
            (Self::ZhTw, false) => "關閉",
            (Self::ZhTw, true) => "清除搜尋",
            (Self::EnUs, false) => "close",
            (Self::EnUs, true) => "clear search",
            (Self::JaJp, false) => "閉じる",
            (Self::JaJp, true) => "検索をクリア",
            (Self::KoKr, false) => "닫기",
            (Self::KoKr, true) => "검색 지우기",
        };
        format!("{key} {label}")
    }

    pub(crate) fn resume_enter_hint(self, key: &str, fork: bool, archived: bool) -> String {
        let label = match (self, fork, archived) {
            (Self::ZhCn, _, true) | (Self::ZhCn, false, false) => "恢复",
            (Self::ZhCn, true, false) => "分叉",
            (Self::ZhTw, _, true) | (Self::ZhTw, false, false) => "恢復",
            (Self::ZhTw, true, false) => "分支",
            (Self::EnUs, _, true) => "restore",
            (Self::EnUs, false, false) => "resume",
            (Self::EnUs, true, false) => "fork",
            (Self::JaJp, _, true) | (Self::JaJp, false, false) => "再開",
            (Self::JaJp, true, false) => "分岐",
            (Self::KoKr, _, true) => "복원",
            (Self::KoKr, false, false) => "재개",
            (Self::KoKr, true, false) => "분기",
        };
        format!("{key} {label}")
    }

    pub(crate) fn resume_controls_hint(self, option_keys: &str) -> String {
        let (focus, change, close, density) = match self {
            Self::ZhCn => ("聚焦", "切换", "关闭", "密度"),
            Self::ZhTw => ("聚焦", "切換", "關閉", "密度"),
            Self::EnUs => ("focus", "change", "close", "density"),
            Self::JaJp => ("フォーカス", "切り替え", "閉じる", "表示密度"),
            Self::KoKr => ("포커스", "변경", "닫기", "밀도"),
        };
        let change = if option_keys.is_empty() {
            String::new()
        } else {
            format!("  {option_keys} {change}")
        };
        format!("tab {focus}{change}  ctrl+c {close}  ctrl+o {density}")
    }

    pub(crate) fn resume_more(self, above: bool) -> &'static str {
        match (self, above) {
            (Self::ZhCn | Self::ZhTw, true) => "↑ 更多",
            (Self::ZhCn | Self::ZhTw, false) => "↓ 更多",
            (Self::EnUs, true) => "↑ more",
            (Self::EnUs, false) => "↓ more",
            (Self::JaJp, true) => "↑ もっと見る",
            (Self::JaJp, false) => "↓ もっと見る",
            (Self::KoKr, true) => "↑ 더 보기",
            (Self::KoKr, false) => "↓ 더 보기",
        }
    }

    pub(crate) fn request_question_progress(self, index: usize, total: usize) -> String {
        match self {
            Self::ZhCn => format!("问题 {index}/{total}"),
            Self::ZhTw => format!("問題 {index}/{total}"),
            Self::EnUs => format!("Question {index}/{total}"),
            Self::JaJp => format!("質問 {index}/{total}"),
            Self::KoKr => format!("질문 {index}/{total}"),
        }
    }

    pub(crate) fn approval_header_elision(self, lines: usize) -> String {
        match self {
            Self::ZhCn => format!("[… {lines} 行] ctrl+a 查看全文"),
            Self::ZhTw => format!("[… {lines} 行] ctrl+a 查看全文"),
            Self::EnUs => format!("[… {lines} lines] ctrl+a view all"),
            Self::JaJp => format!("[… {lines} 行] ctrl+a 全文を表示"),
            Self::KoKr => format!("[… {lines}줄] ctrl+a 전체 보기"),
        }
    }

    pub(crate) fn completion_skill_tag(self) -> &'static str {
        match self {
            Self::ZhCn => "[技能]",
            Self::ZhTw => "[技能]",
            Self::EnUs => "[Skill]",
            Self::JaJp => "[スキル]",
            Self::KoKr => "[스킬]",
        }
    }

    pub(crate) fn skill_popup_footer(self) -> &'static str {
        match self {
            Self::ZhCn => "enter 插入 · esc 关闭",
            Self::ZhTw => "enter 插入 · esc 關閉",
            Self::EnUs => "enter insert · esc close",
            Self::JaJp => "enter 挿入 · esc 閉じる",
            Self::KoKr => "enter 삽입 · esc 닫기",
        }
    }

    pub(crate) fn model_picker_search_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "输入以筛选模型",
            Self::ZhTw => "輸入以篩選模型",
            Self::EnUs => "Type to filter models",
            Self::JaJp => "入力してモデルを絞り込む",
            Self::KoKr => "입력하여 모델 필터링",
        }
    }
    pub(crate) fn model_picker_title(self) -> &'static str {
        match self {
            Self::ZhCn => "选择模型和推理强度",
            Self::ZhTw => "選擇模型與推理強度",
            Self::EnUs => "Select Model and Effort",
            Self::JaJp => "モデルと推論レベルを選択",
            Self::KoKr => "모델 및 추론 수준 선택",
        }
    }

    pub(crate) fn reasoning_picker_title(self, advanced: bool) -> &'static str {
        match (self, advanced) {
            (Self::ZhCn, false) => "选择推理强度",
            (Self::ZhCn, true) => "高级推理",
            (Self::ZhTw, false) => "選擇推理強度",
            (Self::ZhTw, true) => "進階推理",
            (Self::EnUs, false) => "Select Reasoning Level",
            (Self::EnUs, true) => "Advanced Reasoning",
            (Self::JaJp, false) => "推論レベルを選択",
            (Self::JaJp, true) => "高度な推論",
            (Self::KoKr, false) => "추론 수준 선택",
            (Self::KoKr, true) => "고급 추론",
        }
    }

    pub(crate) fn more_reasoning_label(self) -> &'static str {
        match self {
            Self::ZhCn => "更多推理强度…",
            Self::ZhTw => "更多推理強度…",
            Self::EnUs => "More reasoning…",
            Self::JaJp => "その他の推論レベル…",
            Self::KoKr => "추가 추론 수준…",
        }
    }

    pub(crate) fn reasoning_effort_label(self, effort: &str) -> String {
        let label = match (self, effort) {
            (Self::ZhCn, "none") => "无",
            (Self::ZhTw, "none") => "無",
            (Self::EnUs, "none") => "None",
            (Self::JaJp, "none") => "なし",
            (Self::KoKr, "none") => "없음",
            (Self::ZhCn | Self::ZhTw, "minimal") => "最低",
            (Self::EnUs, "minimal") => "Minimal",
            (Self::JaJp, "minimal") => "最小",
            (Self::KoKr, "minimal") => "최소",
            (Self::ZhCn | Self::ZhTw, "low") => "低",
            (Self::EnUs, "low") => "Low",
            (Self::JaJp, "low") => "低",
            (Self::KoKr, "low") => "낮음",
            (Self::ZhCn | Self::ZhTw, "medium") => "中",
            (Self::EnUs, "medium") => "Medium",
            (Self::JaJp, "medium") => "中",
            (Self::KoKr, "medium") => "중간",
            (Self::ZhCn | Self::ZhTw, "high") => "高",
            (Self::EnUs, "high") => "High",
            (Self::JaJp, "high") => "高",
            (Self::KoKr, "high") => "높음",
            (Self::ZhCn, "xhigh") => "极高",
            (Self::ZhTw, "xhigh") => "極高",
            (Self::EnUs, "xhigh") => "Extra high",
            (Self::JaJp, "xhigh") => "非常に高い",
            (Self::KoKr, "xhigh") => "매우 높음",
            (Self::ZhCn, "max") => "最大",
            (Self::ZhTw, "max") => "最大",
            (Self::EnUs, "max") => "Max",
            (Self::JaJp, "max") => "最大",
            (Self::KoKr, "max") => "최대",
            (Self::ZhCn, "ultra") => "超强",
            (Self::ZhTw, "ultra") => "超強",
            (Self::EnUs, "ultra") => "Ultra",
            (Self::JaJp, "ultra") => "超高",
            (Self::KoKr, "ultra") => "울트라",
            (Self::ZhCn, "persistent") => "持续",
            (Self::ZhTw, "persistent") => "持續",
            (Self::EnUs, "persistent") => "Persistent",
            (Self::JaJp, "persistent") => "継続",
            (Self::KoKr, "persistent") => "지속",
            _ => effort,
        };
        label.to_string()
    }

    pub(crate) fn picker_current_label(self) -> &'static str {
        match self {
            Self::ZhCn => "当前",
            Self::ZhTw => "目前",
            Self::EnUs => "current",
            Self::JaJp => "現在",
            Self::KoKr => "현재",
        }
    }

    pub(crate) fn picker_default_label(self) -> &'static str {
        match self {
            Self::ZhCn => "默认",
            Self::ZhTw => "預設",
            Self::EnUs => "default",
            Self::JaJp => "デフォルト",
            Self::KoKr => "기본값",
        }
    }

    pub(crate) fn selection_picker_footer(
        self,
        accept: Option<&str>,
        cancel: Option<&str>,
    ) -> String {
        let (select, back) = match self {
            Self::ZhCn => ("选择", "返回"),
            Self::ZhTw => ("選擇", "返回"),
            Self::EnUs => ("select", "back"),
            Self::JaJp => ("選択", "戻る"),
            Self::KoKr => ("선택", "돌아가기"),
        };
        [
            accept.map(|key| format!("{key} {select}")),
            cancel.map(|key| format!("{key} {back}")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ")
    }
}
