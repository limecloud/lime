mod agents;
mod backtrack;
mod composer;
mod external_editor;
mod pickers;
mod reasoning;
mod request_user_input;
mod shortcuts;
mod status_line;
mod title;
mod token_usage;
pub(crate) use shortcuts::ShortcutLabel;

use std::borrow::Cow;

use crate::footer_hint::display_key_label;
use crate::slash_command::SlashCommand;
use std::env;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Locale {
    ZhCn,
    ZhTw,
    #[default]
    EnUs,
    JaJp,
    KoKr,
}

impl Locale {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        let normalized = value.trim().replace('_', "-").to_ascii_lowercase();
        if normalized.is_empty() {
            return None;
        }
        if normalized == "zh-tw"
            || normalized.starts_with("zh-hant")
            || normalized.starts_with("zh-tw-")
        {
            return Some(Self::ZhTw);
        }
        if normalized == "zh"
            || normalized == "zh-cn"
            || normalized.starts_with("zh-hans")
            || normalized.starts_with("zh-cn-")
        {
            return Some(Self::ZhCn);
        }
        if normalized == "ja" || normalized.starts_with("ja-") {
            return Some(Self::JaJp);
        }
        if normalized == "ko" || normalized.starts_with("ko-") {
            return Some(Self::KoKr);
        }
        if normalized == "en" || normalized.starts_with("en-") {
            return Some(Self::EnUs);
        }
        None
    }

    pub(crate) fn resolve(explicit: Option<&str>) -> Self {
        explicit
            .and_then(Self::parse)
            .or_else(|| {
                env::var("LIME_LOCALE")
                    .ok()
                    .and_then(|value| Self::parse(&value))
            })
            .or_else(|| {
                env::var("LC_ALL")
                    .ok()
                    .and_then(|value| Self::parse(&value))
            })
            .or_else(|| env::var("LANG").ok().and_then(|value| Self::parse(&value)))
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(crate) fn tag(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::ZhTw => "zh-TW",
            Self::EnUs => "en-US",
            Self::JaJp => "ja-JP",
            Self::KoKr => "ko-KR",
        }
    }

    pub(crate) fn model_label(self) -> &'static str {
        match self {
            Self::ZhCn | Self::ZhTw => "模型",
            Self::EnUs => "model",
            Self::JaJp => "モデル",
            Self::KoKr => "모델",
        }
    }

    pub(crate) fn plan_mode_cycle_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "计划模式（Shift+Tab 切换）",
            Self::ZhTw => "計畫模式（Shift+Tab 切換）",
            Self::EnUs => "Plan mode (shift+tab to cycle)",
            Self::JaJp => "計画モード（Shift+Tab で切り替え）",
            Self::KoKr => "계획 모드 (Shift+Tab으로 전환)",
        }
    }

    pub(crate) fn plan_mode_label(self) -> &'static str {
        match self {
            Self::ZhCn => "计划模式",
            Self::ZhTw => "計畫模式",
            Self::EnUs => "Plan mode",
            Self::JaJp => "計画モード",
            Self::KoKr => "계획 모드",
        }
    }

    pub(crate) fn composer_placeholder(self) -> &'static str {
        match self {
            Self::ZhCn => "询问 Lime 做任何事",
            Self::ZhTw => "詢問 Lime 做任何事",
            Self::EnUs => "Ask Lime to do anything",
            Self::JaJp => "Lime に何でも依頼",
            Self::KoKr => "Lime에게 무엇이든 요청",
        }
    }

    pub(crate) fn effort_label(self) -> &'static str {
        match self {
            Self::ZhCn | Self::ZhTw => "推理",
            Self::EnUs => "effort",
            Self::JaJp => "推論",
            Self::KoKr => "추론",
        }
    }

    pub(crate) fn permissions_label(self) -> &'static str {
        match self {
            Self::ZhCn => "权限",
            Self::ZhTw => "權限",
            Self::EnUs => "permissions",
            Self::JaJp => "権限",
            Self::KoKr => "권한",
        }
    }

    pub(crate) fn ready_label(self) -> &'static str {
        match self {
            Self::ZhCn => "就绪",
            Self::ZhTw => "就緒",
            Self::EnUs => "ready",
            Self::JaJp => "準備完了",
            Self::KoKr => "준비됨",
        }
    }

    pub(crate) fn working_label(self) -> &'static str {
        match self {
            Self::ZhCn => "处理中",
            Self::ZhTw => "處理中",
            Self::EnUs => "Working",
            Self::JaJp => "処理中",
            Self::KoKr => "작업 중",
        }
    }

    pub(crate) fn interrupt_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "Esc 中断",
            Self::ZhTw => "Esc 中斷",
            Self::EnUs => "esc to interrupt",
            Self::JaJp => "Esc で中断",
            Self::KoKr => "Esc로 중단",
        }
    }

    pub(crate) fn queue_message_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "Tab 排队消息",
            Self::ZhTw => "Tab 排隊訊息",
            Self::EnUs => "Tab to queue message",
            Self::JaJp => "Tab でメッセージをキューに追加",
            Self::KoKr => "Tab으로 메시지 대기열 추가",
        }
    }

    pub(crate) fn queue_short_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "Tab 排队",
            Self::ZhTw => "Tab 排隊",
            Self::EnUs => "Tab to queue",
            Self::JaJp => "Tab でキューに追加",
            Self::KoKr => "Tab으로 대기열 추가",
        }
    }

    /// 空闲 composer 的快捷键入口提示。
    ///
    /// Codex 在没有草稿或活动回合时仍保留一条可操作的 footer，避免底部区域看起来像
    /// 未渲染。文案由 locale owner 提供，footer 只负责几何布局与截断。
    pub(crate) fn shortcuts_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "? 查看快捷键",
            Self::ZhTw => "? 查看快捷鍵",
            Self::EnUs => "? for shortcuts",
            Self::JaJp => "? ショートカット",
            Self::KoKr => "? 단축키 보기",
        }
    }

    pub(crate) fn history_search_label(self) -> &'static str {
        match self {
            Self::ZhCn => "反向搜索：",
            Self::ZhTw => "反向搜尋：",
            Self::EnUs => "reverse-i-search: ",
            Self::JaJp => "履歴逆検索: ",
            Self::KoKr => "기록 역검색: ",
        }
    }

    pub(crate) fn file_search_loading(self) -> &'static str {
        match self {
            Self::ZhCn => "正在搜索...",
            Self::ZhTw => "正在搜尋...",
            Self::EnUs => "loading...",
            Self::JaJp => "検索中...",
            Self::KoKr => "검색 중...",
        }
    }

    pub(crate) fn file_search_no_matches(self) -> &'static str {
        match self {
            Self::ZhCn => "没有匹配项",
            Self::ZhTw => "沒有符合項目",
            Self::EnUs => "no matches",
            Self::JaJp => "一致する項目がありません",
            Self::KoKr => "일치하는 항목이 없습니다",
        }
    }

    pub(crate) fn skill_popup_no_matches(self) -> &'static str {
        match self {
            Self::ZhCn => "没有匹配的技能",
            Self::ZhTw => "沒有符合的技能",
            Self::EnUs => "no matching skills",
            Self::JaJp => "一致するスキルがありません",
            Self::KoKr => "일치하는 기술이 없습니다",
        }
    }

    pub(crate) fn vim_mode_message(self, enabled: bool) -> &'static str {
        match (self, enabled) {
            (Self::ZhCn, true) => "已启用 Vim 编辑模式",
            (Self::ZhCn, false) => "已关闭 Vim 编辑模式",
            (Self::ZhTw, true) => "已啟用 Vim 編輯模式",
            (Self::ZhTw, false) => "已關閉 Vim 編輯模式",
            (Self::EnUs, true) => "Vim composer mode enabled",
            (Self::EnUs, false) => "Vim composer mode disabled",
            (Self::JaJp, true) => "Vim 編集モードを有効にしました",
            (Self::JaJp, false) => "Vim 編集モードを無効にしました",
            (Self::KoKr, true) => "Vim 편집 모드를 켰습니다",
            (Self::KoKr, false) => "Vim 편집 모드를 껐습니다",
        }
    }

    pub(crate) fn raw_output_mode_message(self, enabled: bool) -> &'static str {
        match (self, enabled) {
            (Self::ZhCn, true) => "已启用原始输出模式",
            (Self::ZhCn, false) => "已恢复富文本输出模式",
            (Self::ZhTw, true) => "已啟用原始輸出模式",
            (Self::ZhTw, false) => "已恢復富文字輸出模式",
            (Self::EnUs, true) => "Raw output mode enabled",
            (Self::EnUs, false) => "Rich output mode restored",
            (Self::JaJp, true) => "RAW 出力モードを有効にしました",
            (Self::JaJp, false) => "リッチ出力モードに戻しました",
            (Self::KoKr, true) => "원시 출력 모드를 켰습니다",
            (Self::KoKr, false) => "리치 출력 모드로 복원했습니다",
        }
    }

    pub(crate) fn slash_command_description(self, command: SlashCommand) -> &'static str {
        match (self, command) {
            (Self::ZhCn, SlashCommand::Statusline) => "配置状态栏",
            (Self::ZhTw, SlashCommand::Statusline) => "設定狀態列",
            (Self::EnUs, SlashCommand::Statusline) => "configure the status line",
            (Self::JaJp, SlashCommand::Statusline) => "ステータス行を設定",
            (Self::KoKr, SlashCommand::Statusline) => "상태 표시줄 설정",
            (Self::ZhCn, SlashCommand::Title) => "配置终端标题",
            (Self::ZhTw, SlashCommand::Title) => "設定終端標題",
            (Self::EnUs, SlashCommand::Title) => "configure the terminal title",
            (Self::JaJp, SlashCommand::Title) => "ターミナルタイトルを設定",
            (Self::KoKr, SlashCommand::Title) => "터미널 제목 설정",
            (Self::ZhCn, SlashCommand::Model) => "选择模型",
            (Self::ZhTw, SlashCommand::Model) => "選擇模型",
            (Self::EnUs, SlashCommand::Model) => "choose a model",
            (Self::JaJp, SlashCommand::Model) => "モデルを選択",
            (Self::KoKr, SlashCommand::Model) => "모델 선택",
            (Self::ZhCn, SlashCommand::Plan) => "切换到计划模式",
            (Self::ZhTw, SlashCommand::Plan) => "切換至計畫模式",
            (Self::EnUs, SlashCommand::Plan) => "switch to Plan mode",
            (Self::JaJp, SlashCommand::Plan) => "計画モードに切り替え",
            (Self::KoKr, SlashCommand::Plan) => "계획 모드로 전환",
            (Self::ZhCn, SlashCommand::Effort) => "设置推理强度",
            (Self::ZhTw, SlashCommand::Effort) => "設定推理強度",
            (Self::EnUs, SlashCommand::Effort) => "set the reasoning effort",
            (Self::JaJp, SlashCommand::Effort) => "推論強度を設定",
            (Self::KoKr, SlashCommand::Effort) => "추론 강도 설정",
            (Self::ZhCn, SlashCommand::Permissions) => "设置权限配置",
            (Self::ZhTw, SlashCommand::Permissions) => "設定權限設定檔",
            (Self::EnUs, SlashCommand::Permissions) => "set the permission profile",
            (Self::JaJp, SlashCommand::Permissions) => "権限プロファイルを設定",
            (Self::KoKr, SlashCommand::Permissions) => "권한 프로필 설정",
            (Self::ZhCn, SlashCommand::Status) => "查看当前会话状态",
            (Self::ZhTw, SlashCommand::Status) => "檢視目前工作階段狀態",
            (Self::EnUs, SlashCommand::Status) => "show the current session status",
            (Self::JaJp, SlashCommand::Status) => "現在のセッション状態を表示",
            (Self::KoKr, SlashCommand::Status) => "현재 세션 상태 보기",
            (Self::ZhCn, SlashCommand::Copy) => "复制最后一条回复",
            (Self::ZhTw, SlashCommand::Copy) => "複製最後一則回覆",
            (Self::EnUs, SlashCommand::Copy) => "copy the last response",
            (Self::JaJp, SlashCommand::Copy) => "最後の応答をコピー",
            (Self::KoKr, SlashCommand::Copy) => "마지막 응답 복사",
            (Self::ZhCn, SlashCommand::Export) => "导出完整对话",
            (Self::ZhTw, SlashCommand::Export) => "匯出完整對話",
            (Self::EnUs, SlashCommand::Export) => "export the complete conversation",
            (Self::JaJp, SlashCommand::Export) => "完全な会話をエクスポート",
            (Self::KoKr, SlashCommand::Export) => "전체 대화 내보내기",
            (Self::ZhCn, SlashCommand::Agents) => "查看和切换所有活跃 Agent 会话",
            (Self::ZhTw, SlashCommand::Agents) => "檢視和切換所有活躍 Agent 工作階段",
            (Self::EnUs, SlashCommand::Agents) => {
                "view and switch between all active agent sessions"
            }
            (Self::JaJp, SlashCommand::Agents) => {
                "すべてのアクティブな Agent セッションを表示して切り替え"
            }
            (Self::KoKr, SlashCommand::Agents) => "모든 활성 에이전트 세션 보기 및 전환",
            (Self::ZhCn, SlashCommand::MultiAgents) => "切换子 Agent 会话",
            (Self::ZhTw, SlashCommand::MultiAgents) => "切換子 Agent 工作階段",
            (Self::EnUs, SlashCommand::MultiAgents) => "switch between sub-agent threads",
            (Self::JaJp, SlashCommand::MultiAgents) => "サブ Agent スレッドを切り替え",
            (Self::KoKr, SlashCommand::MultiAgents) => "하위 에이전트 스레드 전환",
            (Self::ZhCn, SlashCommand::Resume) => "恢复之前的会话",
            (Self::ZhTw, SlashCommand::Resume) => "恢復先前的工作階段",
            (Self::EnUs, SlashCommand::Resume) => "resume a previous session",
            (Self::JaJp, SlashCommand::Resume) => "以前のセッションを再開",
            (Self::KoKr, SlashCommand::Resume) => "이전 세션 재개",
            (Self::ZhCn, SlashCommand::Mcp) => "查看 MCP 服务器和工具",
            (Self::ZhTw, SlashCommand::Mcp) => "檢視 MCP 伺服器與工具",
            (Self::EnUs, SlashCommand::Mcp) => "show MCP servers and tools",
            (Self::JaJp, SlashCommand::Mcp) => "MCP サーバーとツールを表示",
            (Self::KoKr, SlashCommand::Mcp) => "MCP 서버 및 도구 보기",
            (Self::ZhCn, SlashCommand::Raw) => "切换便于复制的原始输出模式",
            (Self::ZhTw, SlashCommand::Raw) => "切換便於複製的原始輸出模式",
            (Self::EnUs, SlashCommand::Raw) => "toggle copy-friendly raw output",
            (Self::JaJp, SlashCommand::Raw) => "コピーしやすい RAW 出力を切り替え",
            (Self::KoKr, SlashCommand::Raw) => "복사하기 쉬운 원시 출력 전환",
            (Self::ZhCn, SlashCommand::Vim) => "切换 Vim 编辑模式",
            (Self::ZhTw, SlashCommand::Vim) => "切換 Vim 編輯模式",
            (Self::EnUs, SlashCommand::Vim) => "toggle Vim composer mode",
            (Self::JaJp, SlashCommand::Vim) => "Vim 編集モードを切り替え",
            (Self::KoKr, SlashCommand::Vim) => "Vim 편집 모드 전환",
            (Self::ZhCn, SlashCommand::Pwd) => "显示当前工作目录",
            (Self::ZhTw, SlashCommand::Pwd) => "顯示目前工作目錄",
            (Self::EnUs, SlashCommand::Pwd) => "show the current working directory",
            (Self::JaJp, SlashCommand::Pwd) => "現在の作業ディレクトリを表示",
            (Self::KoKr, SlashCommand::Pwd) => "현재 작업 디렉터리 표시",
        }
    }

    pub(crate) fn current_working_directory_message(self, cwd: &str) -> String {
        match self {
            Self::ZhCn => format!("当前工作目录：{cwd}"),
            Self::ZhTw => format!("目前工作目錄：{cwd}"),
            Self::EnUs => format!("Current working directory: {cwd}"),
            Self::JaJp => format!("現在の作業ディレクトリ：{cwd}"),
            Self::KoKr => format!("현재 작업 디렉터리: {cwd}"),
        }
    }

    pub(crate) fn pwd_usage(self) -> &'static str {
        match self {
            Self::ZhCn => "用法：/pwd",
            Self::ZhTw => "用法：/pwd",
            Self::EnUs => "Usage: /pwd",
            Self::JaJp => "使い方：/pwd",
            Self::KoKr => "사용법: /pwd",
        }
    }

    pub(crate) fn skipped_skills_message(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("由于 SKILL.md 无效，已跳过加载 {count} 个技能。"),
            Self::ZhTw => format!("由於 SKILL.md 無效，已略過載入 {count} 個技能。"),
            Self::EnUs => {
                format!("Skipped loading {count} skill(s) due to invalid SKILL.md files.")
            }
            Self::JaJp => {
                format!("無効な SKILL.md のため、{count} 件のスキルをスキップしました。")
            }
            Self::KoKr => format!("잘못된 SKILL.md로 인해 기술 {count}개를 건너뛰었습니다."),
        }
    }

    pub(crate) fn skill_load_error_message(self, path: &str, message: &str) -> String {
        match self {
            Self::ZhCn => format!("技能加载错误：{path}：{message}"),
            Self::ZhTw => format!("技能載入錯誤：{path}：{message}"),
            Self::EnUs => format!("{path}: {message}"),
            Self::JaJp => format!("スキル読み込みエラー：{path}：{message}"),
            Self::KoKr => format!("기술 로드 오류: {path}: {message}"),
        }
    }

    pub(crate) fn status_title(self) -> &'static str {
        match self {
            Self::ZhCn => "状态",
            Self::ZhTw => "狀態",
            Self::EnUs => "STATUS",
            Self::JaJp => "状態",
            Self::KoKr => "상태",
        }
    }

    pub(crate) fn action_required_label(self) -> &'static str {
        match self {
            Self::ZhCn => "需要操作",
            Self::ZhTw => "需要操作",
            Self::EnUs => "Action required",
            Self::JaJp => "操作が必要",
            Self::KoKr => "조치 필요",
        }
    }

    pub(crate) fn transcript_title(self) -> &'static str {
        match self {
            Self::ZhCn => "对话记录",
            Self::ZhTw => "對話記錄",
            Self::EnUs => "T R A N S C R I P T",
            Self::JaJp => "会話履歴",
            Self::KoKr => "대화 기록",
        }
    }

    pub(crate) fn export_title(self) -> &'static str {
        match self {
            Self::ZhCn => "导出对话",
            Self::ZhTw => "匯出對話",
            Self::EnUs => "Export conversation",
            Self::JaJp => "会話をエクスポート",
            Self::KoKr => "대화 내보내기",
        }
    }

    pub(crate) fn export_subtitle(self) -> &'static str {
        match self {
            Self::ZhCn => "将完整对话保存为 Markdown",
            Self::ZhTw => "將完整對話儲存為 Markdown",
            Self::EnUs => "Save the complete conversation as Markdown",
            Self::JaJp => "完全な会話を Markdown として保存",
            Self::KoKr => "전체 대화를 Markdown으로 저장",
        }
    }

    pub(crate) fn export_copy_label(self) -> &'static str {
        match self {
            Self::ZhCn => "复制到剪贴板",
            Self::ZhTw => "複製到剪貼簿",
            Self::EnUs => "Copy to clipboard",
            Self::JaJp => "クリップボードにコピー",
            Self::KoKr => "클립보드에 복사",
        }
    }

    pub(crate) fn export_copy_description(self) -> &'static str {
        match self {
            Self::ZhCn => "复制完整 Markdown 对话记录",
            Self::ZhTw => "複製完整 Markdown 對話記錄",
            Self::EnUs => "Copy the complete Markdown transcript",
            Self::JaJp => "完全な Markdown 会話履歴をコピー",
            Self::KoKr => "전체 Markdown 대화 기록 복사",
        }
    }

    pub(crate) fn export_file_label(self) -> &'static str {
        match self {
            Self::ZhCn => "保存到文件",
            Self::ZhTw => "儲存到檔案",
            Self::EnUs => "Save to file",
            Self::JaJp => "ファイルに保存",
            Self::KoKr => "파일에 저장",
        }
    }

    pub(crate) fn export_file_description(self) -> &'static str {
        match self {
            Self::ZhCn => "选择 Markdown 文件名",
            Self::ZhTw => "選擇 Markdown 檔名",
            Self::EnUs => "Choose a Markdown filename",
            Self::JaJp => "Markdown ファイル名を選択",
            Self::KoKr => "Markdown 파일 이름 선택",
        }
    }

    pub(crate) fn export_prompt_title(self) -> &'static str {
        match self {
            Self::ZhCn => "保存对话",
            Self::ZhTw => "儲存對話",
            Self::EnUs => "Save conversation",
            Self::JaJp => "会話を保存",
            Self::KoKr => "대화 저장",
        }
    }

    pub(crate) fn thread_label(self) -> &'static str {
        match self {
            Self::ZhCn => "会话",
            Self::ZhTw => "工作階段",
            Self::EnUs => "thread",
            Self::JaJp => "スレッド",
            Self::KoKr => "스레드",
        }
    }

    pub(crate) fn provider_label(self) -> &'static str {
        match self {
            Self::ZhCn | Self::ZhTw => "Provider",
            Self::EnUs => "provider",
            Self::JaJp => "プロバイダー",
            Self::KoKr => "프로바이더",
        }
    }

    pub(crate) fn cwd_label(self) -> &'static str {
        match self {
            Self::ZhCn => "工作目录",
            Self::ZhTw => "工作目錄",
            Self::EnUs => "working directory",
            Self::JaJp => "作業ディレクトリ",
            Self::KoKr => "작업 디렉터리",
        }
    }

    pub(crate) fn state_label(self) -> &'static str {
        match self {
            Self::ZhCn => "状态",
            Self::ZhTw => "狀態",
            Self::EnUs => "status",
            Self::JaJp => "状態",
            Self::KoKr => "상태",
        }
    }

    pub(crate) fn not_set_label(self) -> &'static str {
        match self {
            Self::ZhCn => "未设置",
            Self::ZhTw => "未設定",
            Self::EnUs => "not set",
            Self::JaJp => "未設定",
            Self::KoKr => "설정되지 않음",
        }
    }

    pub(crate) fn image_label(self) -> &'static str {
        match self {
            Self::ZhCn => "图片",
            Self::ZhTw => "圖片",
            Self::EnUs => "image",
            Self::JaJp => "画像",
            Self::KoKr => "이미지",
        }
    }

    pub(crate) fn numbered_image_label(self, index: &str) -> String {
        let label = match self {
            Self::EnUs => "Image",
            _ => self.image_label(),
        };
        format!("[{label} #{index}]")
    }

    pub(crate) fn transcript_attachments_label(self) -> &'static str {
        match self {
            Self::ZhCn => "[附件]",
            Self::ZhTw => "[附件]",
            Self::EnUs => "[attachments]",
            Self::JaJp => "[添付ファイル]",
            Self::KoKr => "[첨부 파일]",
        }
    }

    pub(crate) fn edit_queued_input_hint(self, shortcut: &str) -> String {
        match self {
            Self::ZhCn => format!("{shortcut} 编辑最后一条排队输入"),
            Self::ZhTw => format!("{shortcut} 編輯最後一則排隊輸入"),
            Self::EnUs => format!("{shortcut} edit last queued input"),
            Self::JaJp => format!("{shortcut} 最後のキュー入力を編集"),
            Self::KoKr => format!("{shortcut} 마지막 대기 입력 편집"),
        }
    }

    pub(crate) fn pager_footer(self) -> &'static str {
        match self {
            Self::ZhCn => "上下滚动  PgUp/PgDn 翻页  Home/End 跳转  Esc/Q 关闭",
            Self::ZhTw => "上下捲動  PgUp/PgDn 翻頁  Home/End 跳轉  Esc/Q 關閉",
            Self::EnUs => "Up/Down scroll  PgUp/PgDn page  Home/End jump  Esc/Q close",
            Self::JaJp => "上下スクロール  PgUp/PgDn ページ  Home/End 移動  Esc/Q 閉じる",
            Self::KoKr => "위/아래 스크롤  PgUp/PgDn 페이지  Home/End 이동  Esc/Q 닫기",
        }
    }

    pub(crate) fn mcp_inventory_title(self) -> &'static str {
        match self {
            Self::ZhCn => "MCP 工具",
            Self::ZhTw => "MCP 工具",
            Self::EnUs => "MCP Tools",
            Self::JaJp => "MCP ツール",
            Self::KoKr => "MCP 도구",
        }
    }

    pub(crate) fn mcp_no_servers(self) -> &'static str {
        match self {
            Self::ZhCn => "未配置 MCP 服务器。",
            Self::ZhTw => "未設定 MCP 伺服器。",
            Self::EnUs => "No MCP servers configured.",
            Self::JaJp => "MCP サーバーが設定されていません。",
            Self::KoKr => "구성된 MCP 서버가 없습니다.",
        }
    }

    pub(crate) fn mcp_tools_label(self) -> &'static str {
        match self {
            Self::ZhCn => "工具",
            Self::ZhTw => "工具",
            Self::EnUs => "Tools",
            Self::JaJp => "ツール",
            Self::KoKr => "도구",
        }
    }

    pub(crate) fn mcp_none(self) -> &'static str {
        match self {
            Self::ZhCn => "(无)",
            Self::ZhTw => "(無)",
            Self::EnUs => "(none)",
            Self::JaJp => "(なし)",
            Self::KoKr => "(없음)",
        }
    }

    pub(crate) fn mcp_no_tools_available(self) -> &'static str {
        match self {
            Self::ZhCn => "没有可用的 MCP 工具。",
            Self::ZhTw => "沒有可用的 MCP 工具。",
            Self::EnUs => "No MCP tools available.",
            Self::JaJp => "利用可能な MCP ツールがありません。",
            Self::KoKr => "사용 가능한 MCP 도구가 없습니다.",
        }
    }

    pub(crate) fn mcp_tool_unit(self, count: usize) -> &'static str {
        match self {
            Self::ZhCn => "工具",
            Self::ZhTw => "工具",
            Self::EnUs => {
                if count == 1 {
                    "tool"
                } else {
                    "tools"
                }
            }
            Self::JaJp => "ツール",
            Self::KoKr => "도구",
        }
    }

    pub(crate) fn mcp_resources_label(self) -> &'static str {
        match self {
            Self::ZhCn => "资源",
            Self::ZhTw => "資源",
            Self::EnUs => "Resources",
            Self::JaJp => "リソース",
            Self::KoKr => "리소스",
        }
    }

    pub(crate) fn mcp_resource_templates_label(self) -> &'static str {
        match self {
            Self::ZhCn => "资源模板",
            Self::ZhTw => "資源範本",
            Self::EnUs => "Resource templates",
            Self::JaJp => "リソーステンプレート",
            Self::KoKr => "리소스 템플릿",
        }
    }

    pub(crate) fn mcp_status(self, status: &str) -> &'static str {
        match (self, status) {
            (_, "connected") => match self {
                Self::ZhCn => "已连接",
                Self::ZhTw => "已連線",
                Self::EnUs => "connected",
                Self::JaJp => "接続済み",
                Self::KoKr => "연결됨",
            },
            (_, "starting") => match self {
                Self::ZhCn => "启动中",
                Self::ZhTw => "啟動中",
                Self::EnUs => "starting",
                Self::JaJp => "起動中",
                Self::KoKr => "시작 중",
            },
            (_, "authentication required") => match self {
                Self::ZhCn => "需要认证",
                Self::ZhTw => "需要驗證",
                Self::EnUs => "authentication required",
                Self::JaJp => "認証が必要",
                Self::KoKr => "인증 필요",
            },
            (_, "failed") => match self {
                Self::ZhCn => "失败",
                Self::ZhTw => "失敗",
                Self::EnUs => "failed",
                Self::JaJp => "失敗",
                Self::KoKr => "실패",
            },
            (_, "not started") => match self {
                Self::ZhCn => "未启动",
                Self::ZhTw => "未啟動",
                Self::EnUs => "not started",
                Self::JaJp => "未起動",
                Self::KoKr => "시작되지 않음",
            },
            (_, "disabled") => match self {
                Self::ZhCn => "已禁用",
                Self::ZhTw => "已停用",
                Self::EnUs => "disabled",
                Self::JaJp => "無効",
                Self::KoKr => "비활성화됨",
            },
            (_, "cancelled") => match self {
                Self::ZhCn => "已取消",
                Self::ZhTw => "已取消",
                Self::EnUs => "cancelled",
                Self::JaJp => "キャンセル済み",
                Self::KoKr => "취소됨",
            },
            (_, _) => match self {
                Self::ZhCn => "未知",
                Self::ZhTw => "未知",
                Self::EnUs => "unknown",
                Self::JaJp => "不明",
                Self::KoKr => "알 수 없음",
            },
        }
    }

    pub(crate) fn mcp_auth_status(self, status: &str) -> &'static str {
        match (self, status) {
            (_, "unsupported") => match self {
                Self::ZhCn => "不支持",
                Self::ZhTw => "不支援",
                Self::EnUs => "Unsupported",
                Self::JaJp => "未対応",
                Self::KoKr => "지원되지 않음",
            },
            (_, "not logged in") => match self {
                Self::ZhCn => "未登录",
                Self::ZhTw => "未登入",
                Self::EnUs => "Not logged in",
                Self::JaJp => "未ログイン",
                Self::KoKr => "로그인되지 않음",
            },
            (_, "bearer token") => match self {
                Self::ZhCn => "Bearer 令牌",
                Self::ZhTw => "Bearer 權杖",
                Self::EnUs => "Bearer token",
                Self::JaJp => "Bearer トークン",
                Self::KoKr => "Bearer 토큰",
            },
            (_, "OAuth") => "OAuth",
            (_, _) => match self {
                Self::ZhCn => "未知",
                Self::ZhTw => "未知",
                Self::EnUs => "Unknown",
                Self::JaJp => "不明",
                Self::KoKr => "알 수 없음",
            },
        }
    }

    pub(crate) fn mcp_auth_label(self) -> &'static str {
        match self {
            Self::ZhCn => "认证",
            Self::ZhTw => "驗證",
            Self::EnUs => "Auth",
            Self::JaJp => "認証",
            Self::KoKr => "인증",
        }
    }

    pub(crate) fn mcp_use_verbose(self) -> &'static str {
        match self {
            Self::ZhCn => "使用 /mcp verbose 查看工具和资源。",
            Self::ZhTw => "使用 /mcp verbose 查看工具與資源。",
            Self::EnUs => "Use /mcp verbose for tools and resources.",
            Self::JaJp => "/mcp verbose でツールとリソースを表示します。",
            Self::KoKr => "도구와 리소스를 보려면 /mcp verbose를 사용하세요.",
        }
    }

    pub(crate) fn mcp_usage(self) -> &'static str {
        match self {
            Self::ZhCn => "用法：/mcp [verbose | login <名称>]",
            Self::ZhTw => "用法：/mcp [verbose | login <名稱>]",
            Self::EnUs => "Usage: /mcp [verbose | login <name>]",
            Self::JaJp => "使い方：/mcp [verbose | login <名前>]",
            Self::KoKr => "사용법: /mcp [verbose | login <이름>]",
        }
    }

    pub(crate) fn mcp_login_requires_session(self) -> &'static str {
        match self {
            Self::ZhCn => "MCP 登录需要先启动会话。",
            Self::ZhTw => "MCP 登入需要先啟動工作階段。",
            Self::EnUs => "MCP sign-in requires an active session.",
            Self::JaJp => "MCP ログインにはアクティブなセッションが必要です。",
            Self::KoKr => "MCP 로그인에는 활성 세션이 필요합니다.",
        }
    }

    pub(crate) fn mcp_login_in_progress(self, name: &str) -> String {
        match self {
            Self::ZhCn => format!("MCP 服务器“{name}”正在登录，请稍候。"),
            Self::ZhTw => format!("MCP 伺服器「{name}」正在登入，請稍候。"),
            Self::EnUs => format!("MCP server '{name}' sign-in is already in progress."),
            Self::JaJp => format!("MCP サーバー「{name}」はログイン処理中です。"),
            Self::KoKr => format!("MCP 서버 '{name}' 로그인 진행 중입니다."),
        }
    }

    pub(crate) fn mcp_login_opened(self, name: &str) -> String {
        match self {
            Self::ZhCn => format!("已为 MCP 服务器“{name}”打开登录页面。"),
            Self::ZhTw => format!("已為 MCP 伺服器「{name}」開啟登入頁面。"),
            Self::EnUs => format!("Opened the MCP sign-in page for '{name}'."),
            Self::JaJp => format!("MCP サーバー「{name}」のログインページを開きました。"),
            Self::KoKr => format!("MCP 서버 '{name}' 로그인 페이지를 열었습니다."),
        }
    }

    pub(crate) fn mcp_login_open_failed(self, name: &str, error: &str) -> String {
        match self {
            Self::ZhCn => format!("无法打开 MCP 服务器“{name}”的登录页面：{error}"),
            Self::ZhTw => format!("無法開啟 MCP 伺服器「{name}」的登入頁面：{error}"),
            Self::EnUs => format!("Could not open MCP sign-in for '{name}': {error}"),
            Self::JaJp => {
                format!("MCP サーバー「{name}」のログインページを開けませんでした: {error}")
            }
            Self::KoKr => format!("MCP 서버 '{name}' 로그인 페이지를 열 수 없습니다: {error}"),
        }
    }

    pub(crate) fn mcp_login_succeeded(self, name: &str) -> String {
        match self {
            Self::ZhCn => format!("已登录 MCP 服务器“{name}”。"),
            Self::ZhTw => format!("已登入 MCP 伺服器「{name}」。"),
            Self::EnUs => format!("Signed in to MCP server '{name}'."),
            Self::JaJp => format!("MCP サーバー「{name}」にログインしました。"),
            Self::KoKr => format!("MCP 서버 '{name}'에 로그인했습니다."),
        }
    }

    pub(crate) fn mcp_login_failed_completion(self, name: &str, error: Option<&str>) -> String {
        let detail = error.unwrap_or("unknown error");
        match self {
            Self::ZhCn => format!("MCP 服务器“{name}”登录失败：{detail}"),
            Self::ZhTw => format!("MCP 伺服器「{name}」登入失敗：{detail}"),
            Self::EnUs => format!("MCP server '{name}' sign-in failed: {detail}"),
            Self::JaJp => format!("MCP サーバー「{name}」のログインに失敗しました: {detail}"),
            Self::KoKr => format!("MCP 서버 '{name}' 로그인 실패: {detail}"),
        }
    }

    pub(crate) fn transcript_pager_footer(
        self,
        page_down_hint: &str,
        find_hint: &str,
        close_hint: &str,
    ) -> String {
        match self {
            Self::ZhCn => format!(
                "上下滚动  PgUp/{page_down_hint} 翻页  {find_hint} 查找  Home/End 跳转  {close_hint} 关闭"
            ),
            Self::ZhTw => format!(
                "上下捲動  PgUp/{page_down_hint} 翻頁  {find_hint} 尋找  Home/End 跳轉  {close_hint} 關閉"
            ),
            Self::EnUs => format!(
                "Up/Down scroll  PgUp/{page_down_hint} page  {find_hint} find  Home/End jump  {close_hint} close"
            ),
            Self::JaJp => format!(
                "上下スクロール  PgUp/{page_down_hint} ページ  {find_hint} 検索  Home/End 移動  {close_hint} 閉じる"
            ),
            Self::KoKr => format!(
                "위/아래 스크롤  PgUp/{page_down_hint} 페이지  {find_hint} 찾기  Home/End 이동  {close_hint} 닫기"
            ),
        }
    }

    pub(crate) fn transcript_follow_labels(self, unseen_activity: bool) -> [&'static str; 5] {
        match (self, unseen_activity) {
            (Self::ZhCn, false) => [
                " ↓ 返回底部 · esc ",
                " ↓ 返回底部 ",
                " ↓ 底部 · esc ",
                " ↓ 底部 ",
                " ↓ ",
            ],
            (Self::ZhCn, true) => [
                " 有新动态 · ↓ 返回底部 · esc ",
                " 有新动态 · ↓ 底部 ",
                " 新动态 · ↓ 底部 ",
                " ↓ 底部 ",
                " ↓ ",
            ],
            (Self::ZhTw, false) => [
                " ↓ 返回底部 · esc ",
                " ↓ 返回底部 ",
                " ↓ 底部 · esc ",
                " ↓ 底部 ",
                " ↓ ",
            ],
            (Self::ZhTw, true) => [
                " 有新動態 · ↓ 返回底部 · esc ",
                " 有新動態 · ↓ 底部 ",
                " 新動態 · ↓ 底部 ",
                " ↓ 底部 ",
                " ↓ ",
            ],
            (Self::EnUs, false) => [
                " ↓ Back to bottom · esc ",
                " ↓ Back to bottom ",
                " ↓ Bottom · esc ",
                " ↓ Bottom ",
                " ↓ ",
            ],
            (Self::EnUs, true) => [
                " New activity · ↓ Back to bottom · esc ",
                " New activity · ↓ Bottom ",
                " New · ↓ Bottom ",
                " ↓ Bottom ",
                " ↓ ",
            ],
            (Self::JaJp, false) => [
                " ↓ 最新位置へ · esc ",
                " ↓ 最新位置へ ",
                " ↓ 末尾 · esc ",
                " ↓ 末尾 ",
                " ↓ ",
            ],
            (Self::JaJp, true) => [
                " 新しい動き · ↓ 最新位置へ · esc ",
                " 新しい動き · ↓ 末尾 ",
                " 新着 · ↓ 末尾 ",
                " ↓ 末尾 ",
                " ↓ ",
            ],
            (Self::KoKr, false) => [
                " ↓ 맨 아래로 · esc ",
                " ↓ 맨 아래로 ",
                " ↓ 아래 · esc ",
                " ↓ 아래 ",
                " ↓ ",
            ],
            (Self::KoKr, true) => [
                " 새 활동 · ↓ 맨 아래로 · esc ",
                " 새 활동 · ↓ 아래 ",
                " 새로움 · ↓ 아래 ",
                " ↓ 아래 ",
                " ↓ ",
            ],
        }
    }

    pub(crate) fn transcript_pager_activity_footer(self, close_hint: &str) -> String {
        match self {
            Self::ZhCn => format!("上下滚动  F4 查看活动详情  {close_hint} 关闭"),
            Self::ZhTw => format!("上下捲動  F4 查看活動詳情  {close_hint} 關閉"),
            Self::EnUs => format!("Up/Down scroll  F4 inspect activity  {close_hint} close"),
            Self::JaJp => format!("上下スクロール  F4 アクティビティ詳細  {close_hint} 閉じる"),
            Self::KoKr => format!("위/아래 스크롤  F4 활동 세부 정보  {close_hint} 닫기"),
        }
    }

    pub(crate) fn transcript_activity_focus_footer(self) -> &'static str {
        match self {
            Self::ZhCn => "↑/↓ 上一个/下一个  Enter 展开/收起  Esc 返回",
            Self::ZhTw => "↑/↓ 上一個/下一個  Enter 展開/收起  Esc 返回",
            Self::EnUs => "↑/↓ previous/next  Enter details  Esc back",
            Self::JaJp => "↑/↓ 前/次  Enter 詳細  Esc 戻る",
            Self::KoKr => "↑/↓ 이전/다음  Enter 세부 정보  Esc 뒤로",
        }
    }

    pub(crate) fn transcript_exploration_label(self, active: bool) -> &'static str {
        match (self, active) {
            (Self::ZhCn, true) => "正在探索",
            (Self::ZhCn, false) => "已探索",
            (Self::ZhTw, true) => "正在探索",
            (Self::ZhTw, false) => "已探索",
            (Self::EnUs, true) => "Exploring",
            (Self::EnUs, false) => "Explored",
            (Self::JaJp, true) => "探索中",
            (Self::JaJp, false) => "探索済み",
            (Self::KoKr, true) => "탐색 중",
            (Self::KoKr, false) => "탐색함",
        }
    }

    pub(crate) fn transcript_activity_action_label(self, action: &str) -> &'static str {
        match action {
            "read" => match self {
                Self::ZhCn => "读取",
                Self::ZhTw => "讀取",
                Self::EnUs => "Read",
                Self::JaJp => "読取",
                Self::KoKr => "읽기",
            },
            "list" => match self {
                Self::ZhCn => "列出",
                Self::ZhTw => "列出",
                Self::EnUs => "List",
                Self::JaJp => "一覧",
                Self::KoKr => "목록",
            },
            "search" => match self {
                Self::ZhCn => "搜索",
                Self::ZhTw => "搜尋",
                Self::EnUs => "Search",
                Self::JaJp => "検索",
                Self::KoKr => "검색",
            },
            _ => match self {
                Self::ZhCn => "运行",
                Self::ZhTw => "執行",
                Self::EnUs => "Run",
                Self::JaJp => "実行",
                Self::KoKr => "실행",
            },
        }
    }

    pub(crate) fn transcript_activity_search_target(self, query: &str, path: &str) -> String {
        match self {
            Self::ZhCn => format!("{query}，位于 {path}"),
            Self::ZhTw => format!("{query}，位於 {path}"),
            Self::EnUs => format!("{query} in {path}"),
            Self::JaJp => format!("{path} 内の {query}"),
            Self::KoKr => format!("{path}에서 {query}"),
        }
    }

    pub(crate) fn transcript_activity_exit(self, code: i32, compound: bool) -> String {
        match (self, compound) {
            (Self::ZhCn, true) => format!("（命令退出 {code}）"),
            (Self::ZhCn, false) => format!("（退出 {code}）"),
            (Self::ZhTw, true) => format!("（命令結束 {code}）"),
            (Self::ZhTw, false) => format!("（結束 {code}）"),
            (Self::EnUs, true) => format!("(command exit {code})"),
            (Self::EnUs, false) => format!("(exit {code})"),
            (Self::JaJp, true) => format!("（コマンド終了 {code}）"),
            (Self::JaJp, false) => format!("（終了 {code}）"),
            (Self::KoKr, true) => format!("(명령 종료 {code})"),
            (Self::KoKr, false) => format!("(종료 {code})"),
        }
    }

    pub(crate) fn transcript_computer_label(self, active: bool) -> &'static str {
        match (self, active) {
            (Self::ZhCn, true) => "正在操作电脑",
            (Self::ZhCn, false) => "已操作电脑",
            (Self::ZhTw, true) => "正在操作電腦",
            (Self::ZhTw, false) => "已操作電腦",
            (Self::EnUs, true) => "Using computer",
            (Self::EnUs, false) => "Used computer",
            (Self::JaJp, true) => "コンピュータを操作中",
            (Self::JaJp, false) => "コンピュータを操作しました",
            (Self::KoKr, true) => "컴퓨터 사용 중",
            (Self::KoKr, false) => "컴퓨터 사용함",
        }
    }

    pub(crate) fn transcript_activity_count(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("{count} 个操作"),
            Self::ZhTw => format!("{count} 個操作"),
            Self::EnUs if count == 1 => "1 action".to_string(),
            Self::EnUs => format!("{count} actions"),
            Self::JaJp => format!("{count} 件の操作"),
            Self::KoKr => format!("작업 {count}개"),
        }
    }

    pub(crate) fn transcript_activity_failed_count(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("{count} 个失败"),
            Self::ZhTw => format!("{count} 個失敗"),
            Self::EnUs => format!("{count} failed"),
            Self::JaJp => format!("{count} 件失敗"),
            Self::KoKr => format!("실패 {count}개"),
        }
    }

    pub(crate) fn transcript_computer_action_label(self) -> &'static str {
        match self {
            Self::ZhCn => "电脑操作",
            Self::ZhTw => "電腦操作",
            Self::EnUs => "Computer action",
            Self::JaJp => "コンピュータ操作",
            Self::KoKr => "컴퓨터 작업",
        }
    }

    pub(crate) fn transcript_computer_capture(self, title: &str) -> String {
        match self {
            Self::ZhCn => format!("已截图 · {title}"),
            Self::ZhTw => format!("已擷取螢幕截圖 · {title}"),
            Self::EnUs => format!("Captured screenshot · {title}"),
            Self::JaJp => format!("スクリーンショット取得 · {title}"),
            Self::KoKr => format!("스크린샷 캡처 · {title}"),
        }
    }

    pub(crate) fn transcript_computer_failure(self, title: &str, error: Option<&str>) -> String {
        let detail = error.map_or_else(|| title.to_string(), |error| format!("{title} — {error}"));
        match self {
            Self::ZhCn => format!("失败：{detail}"),
            Self::ZhTw => format!("失敗：{detail}"),
            Self::EnUs => format!("Failed: {detail}"),
            Self::JaJp => format!("失敗: {detail}"),
            Self::KoKr => format!("실패: {detail}"),
        }
    }

    pub(crate) fn transcript_copy_confirmed(self, characters: usize) -> String {
        match self {
            Self::ZhCn => format!("已复制 {characters} 个字符到主机剪贴板"),
            Self::ZhTw => format!("已複製 {characters} 個字元到主機剪貼簿"),
            Self::EnUs => format!("Copied {characters} chars to host clipboard"),
            Self::JaJp => format!("ホストのクリップボードに {characters} 文字コピーしました"),
            Self::KoKr => format!("호스트 클립보드에 {characters}자 복사함"),
        }
    }

    pub(crate) fn transcript_copy_unconfirmed(self) -> &'static str {
        match self {
            Self::ZhCn => "已向终端发送复制请求 · 请粘贴确认",
            Self::ZhTw => "已向終端傳送複製要求 · 請貼上確認",
            Self::EnUs => "Copy sent to terminal · paste to verify",
            Self::JaJp => "端末にコピー要求を送信しました · 貼り付けて確認",
            Self::KoKr => "터미널에 복사 요청을 보냄 · 붙여넣어 확인",
        }
    }

    pub(crate) fn transcript_copy_failed(self) -> &'static str {
        match self {
            Self::ZhCn => "复制失败 · 请重试",
            Self::ZhTw => "複製失敗 · 請重試",
            Self::EnUs => "Copy failed · try again",
            Self::JaJp => "コピーに失敗しました · 再試行してください",
            Self::KoKr => "복사 실패 · 다시 시도하세요",
        }
    }

    pub(crate) fn transcript_show_details(self) -> &'static str {
        match self {
            Self::ZhCn => "+ 显示详情",
            Self::ZhTw => "+ 顯示詳情",
            Self::EnUs => "+ Show details",
            Self::JaJp => "+ 詳細を表示",
            Self::KoKr => "+ 세부 정보 보기",
        }
    }

    pub(crate) fn transcript_show_less(self) -> &'static str {
        match self {
            Self::ZhCn => "− 收起详情",
            Self::ZhTw => "− 收起詳情",
            Self::EnUs => "− Show less",
            Self::JaJp => "− 詳細を閉じる",
            Self::KoKr => "− 간략히 보기",
        }
    }

    pub(crate) fn transcript_output_lines(self, count: usize, shortcut: Option<&str>) -> String {
        let label = match self {
            Self::ZhCn => format!("+ {count} 行"),
            Self::ZhTw => format!("+ {count} 行"),
            Self::EnUs => format!("+ {count} {}", if count == 1 { "line" } else { "lines" }),
            Self::JaJp => format!("+ {count} 行"),
            Self::KoKr => format!("+ {count}줄"),
        };
        let Some(shortcut) = shortcut.filter(|shortcut| !shortcut.is_empty()) else {
            return label;
        };
        let hint = match self {
            Self::ZhCn => format!(" ({shortcut} 展开)"),
            Self::ZhTw => format!(" ({shortcut} 展開)"),
            Self::EnUs => format!(" ({shortcut} to expand)"),
            Self::JaJp => format!(" ({shortcut} で展開)"),
            Self::KoKr => format!(" ({shortcut}로 펼치기)"),
        };
        format!("{label}{hint}")
    }

    pub(crate) fn transcript_pager_loading(self) -> &'static str {
        match self {
            Self::ZhCn => "正在加载更早历史…",
            Self::ZhTw => "正在載入較早歷史…",
            Self::EnUs => "Loading older history…",
            Self::JaJp => "古い履歴を読み込み中…",
            Self::KoKr => "이전 기록을 불러오는 중…",
        }
    }

    pub(crate) fn transcript_pager_retry_footer(self) -> &'static str {
        match self {
            Self::ZhCn => "历史加载失败  Home 重试  Ctrl+T/Esc/Q 关闭",
            Self::ZhTw => "歷史載入失敗  Home 重試  Ctrl+T/Esc/Q 關閉",
            Self::EnUs => "History load failed  Home retry  Ctrl+T/Esc/Q close",
            Self::JaJp => "履歴の読み込みに失敗  Home 再試行  Ctrl+T/Esc/Q 閉じる",
            Self::KoKr => "기록 로드 실패  Home 재시도  Ctrl+T/Esc/Q 닫기",
        }
    }

    pub(crate) fn transcript_search_label(self) -> &'static str {
        match self {
            Self::ZhCn => "查找：",
            Self::ZhTw => "尋找：",
            Self::EnUs => "Find: ",
            Self::JaJp => "検索: ",
            Self::KoKr => "찾기: ",
        }
    }

    pub(crate) fn transcript_search_prompt(self) -> &'static str {
        match self {
            Self::ZhCn => "输入查询",
            Self::ZhTw => "輸入查詢",
            Self::EnUs => "Type to search",
            Self::JaJp => "検索語を入力",
            Self::KoKr => "검색어 입력",
        }
    }

    pub(crate) fn transcript_search_searching(self) -> &'static str {
        match self {
            Self::ZhCn => "正在查找…",
            Self::ZhTw => "正在尋找…",
            Self::EnUs => "Searching…",
            Self::JaJp => "検索中…",
            Self::KoKr => "검색 중…",
        }
    }

    pub(crate) fn transcript_search_no_matches(self) -> &'static str {
        match self {
            Self::ZhCn => "无匹配",
            Self::ZhTw => "無匹配",
            Self::EnUs => "No matches",
            Self::JaJp => "一致なし",
            Self::KoKr => "일치 없음",
        }
    }

    pub(crate) fn transcript_search_matches(self) -> &'static str {
        match self {
            Self::ZhCn => "命中",
            Self::ZhTw => "命中",
            Self::EnUs => "Match",
            Self::JaJp => "一致",
            Self::KoKr => "일치",
        }
    }

    pub(crate) fn transcript_search_no_more_matches(self) -> &'static str {
        match self {
            Self::ZhCn => "没有更多命中",
            Self::ZhTw => "沒有更多命中",
            Self::EnUs => "No more matches",
            Self::JaJp => "これ以上一致なし",
            Self::KoKr => "더 이상 일치 없음",
        }
    }

    pub(crate) fn transcript_search_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "Enter 下一个  Shift+Enter/Ctrl+P 上一个  Esc 退出",
            Self::ZhTw => "Enter 下一個  Shift+Enter/Ctrl+P 上一個  Esc 離開",
            Self::EnUs => "Enter next  Shift+Enter/Ctrl+P previous  Esc close",
            Self::JaJp => "Enter 次  Shift+Enter/Ctrl+P 前  Esc 閉じる",
            Self::KoKr => "Enter 다음  Shift+Enter/Ctrl+P 이전  Esc 닫기",
        }
    }

    pub(crate) fn transcript_search_query_limited(self) -> &'static str {
        match self {
            Self::ZhCn => "查询限制为 4 KiB",
            Self::ZhTw => "查詢限制為 4 KiB",
            Self::EnUs => "Query limited to 4 KiB",
            Self::JaJp => "検索語は 4 KiB まで",
            Self::KoKr => "검색어는 4 KiB로 제한됨",
        }
    }

    pub(crate) fn transcript_selection_hint(self) -> &'static str {
        match self {
            Self::ZhCn => "Ctrl+C 复制  Enter 复制并返回底部  Esc 清除选择",
            Self::ZhTw => "Ctrl+C 複製  Enter 複製並返回底部  Esc 清除選取",
            Self::EnUs => "Ctrl+C copy  Enter copy and follow  Esc clear selection",
            Self::JaJp => "Ctrl+C コピー  Enter コピーして末尾へ  Esc 選択解除",
            Self::KoKr => "Ctrl+C 복사  Enter 복사 후 맨 아래로  Esc 선택 해제",
        }
    }

    pub(crate) fn transcript_link_opened(self, destination: &str) -> String {
        match self {
            Self::ZhCn => format!("已在浏览器中打开 {destination}"),
            Self::ZhTw => format!("已在瀏覽器中開啟 {destination}"),
            Self::EnUs => format!("Opened {destination} in browser"),
            Self::JaJp => format!("ブラウザーで {destination} を開きました"),
            Self::KoKr => format!("브라우저에서 {destination} 열림"),
        }
    }

    pub(crate) fn transcript_link_open_failed(self, error: &str) -> String {
        match self {
            Self::ZhCn => format!("无法打开链接：{error}"),
            Self::ZhTw => format!("無法開啟連結：{error}"),
            Self::EnUs => format!("Failed to open link: {error}"),
            Self::JaJp => format!("リンクを開けませんでした: {error}"),
            Self::KoKr => format!("링크를 열지 못했습니다: {error}"),
        }
    }

    pub(crate) fn status(self, status: &str) -> String {
        if let Some(characters) = status
            .strip_prefix("copy confirmed: ")
            .and_then(|characters| characters.parse().ok())
        {
            return self.transcript_copy_confirmed(characters);
        }
        if status == "copy unconfirmed" {
            return self.transcript_copy_unconfirmed().to_string();
        }
        let (prefix, rest) = status
            .split_once(':')
            .map_or((status, None), |(prefix, rest)| {
                (prefix, Some(rest.trim_start()))
            });
        let label = match prefix {
            "" => return String::new(),
            "ready" => self.ready_label(),
            "running" => match self {
                Self::ZhCn => "运行中",
                Self::ZhTw => "執行中",
                Self::EnUs => "running",
                Self::JaJp => "実行中",
                Self::KoKr => "실행 중",
            },
            "running hook" => match self {
                Self::ZhCn => "正在运行 Hook",
                Self::ZhTw => "正在執行 Hook",
                Self::EnUs => "running hook",
                Self::JaJp => "Hook を実行中",
                Self::KoKr => "Hook 실행 중",
            },
            "running hooks" => match self {
                Self::ZhCn => "正在运行多个 Hook",
                Self::ZhTw => "正在執行多個 Hook",
                Self::EnUs => "running hooks",
                Self::JaJp => "複数の Hook を実行中",
                Self::KoKr => "여러 Hook 실행 중",
            },
            "MCP startup issue" => match self {
                Self::ZhCn => "MCP 启动问题",
                Self::ZhTw => "MCP 啟動問題",
                Self::EnUs => "MCP startup issue",
                Self::JaJp => "MCP 起動の問題",
                Self::KoKr => "MCP 시작 문제",
            },
            "MCP startup issues" => match self {
                Self::ZhCn => "MCP 启动问题",
                Self::ZhTw => "MCP 啟動問題",
                Self::EnUs => "MCP startup issues",
                Self::JaJp => "MCP 起動の問題",
                Self::KoKr => "MCP 시작 문제",
            },
            "completed" => match self {
                Self::ZhCn | Self::ZhTw => "已完成",
                Self::EnUs => "completed",
                Self::JaJp => "完了",
                Self::KoKr => "완료",
            },
            "failed" => match self {
                Self::ZhCn => "失败",
                Self::ZhTw => "失敗",
                Self::EnUs => "failed",
                Self::JaJp => "失敗",
                Self::KoKr => "실패",
            },
            "closed" => match self {
                Self::ZhCn => "已关闭",
                Self::ZhTw => "已關閉",
                Self::EnUs => "closed",
                Self::JaJp => "終了",
                Self::KoKr => "닫힘",
            },
            "interrupted" => match self {
                Self::ZhCn => "已中断",
                Self::ZhTw => "已中斷",
                Self::EnUs => "interrupted",
                Self::JaJp => "中断",
                Self::KoKr => "중단됨",
            },
            "background task started" => match self {
                Self::ZhCn => "后台任务已启动",
                Self::ZhTw => "背景工作已啟動",
                Self::EnUs => "background task started",
                Self::JaJp => "バックグラウンドタスクを開始しました",
                Self::KoKr => "백그라운드 작업 시작됨",
            },
            "background task failed" => match self {
                Self::ZhCn => "后台任务失败",
                Self::ZhTw => "背景工作失敗",
                Self::EnUs => "background task failed",
                Self::JaJp => "バックグラウンドタスクに失敗しました",
                Self::KoKr => "백그라운드 작업 실패",
            },
            "background task is idle" => match self {
                Self::ZhCn => "后台任务未运行",
                Self::ZhTw => "背景工作未執行",
                Self::EnUs => "background task is idle",
                Self::JaJp => "バックグラウンドタスクは待機中です",
                Self::KoKr => "백그라운드 작업 대기 중",
            },
            "stopping background turn" => match self {
                Self::ZhCn => "正在停止后台回合",
                Self::ZhTw => "正在停止背景回合",
                Self::EnUs => "stopping background turn",
                Self::JaJp => "バックグラウンドターンを停止中",
                Self::KoKr => "백그라운드 턴 중지 중",
            },
            "agent renamed" => match self {
                Self::ZhCn => "Agent 已改名",
                Self::ZhTw => "Agent 已改名",
                Self::EnUs => "agent renamed",
                Self::JaJp => "Agent の名前を変更しました",
                Self::KoKr => "에이전트 이름 변경됨",
            },
            "resume picker is available from /resume" => match self {
                Self::ZhCn => "请使用 /resume 打开会话选择器",
                Self::ZhTw => "請使用 /resume 開啟工作階段選擇器",
                Self::EnUs => "resume picker is available from /resume",
                Self::JaJp => "/resume から再開ピッカーを開けます",
                Self::KoKr => "/resume에서 재개 선택기를 열 수 있음",
            },
            "declined" => match self {
                Self::ZhCn => "已拒绝",
                Self::ZhTw => "已拒絕",
                Self::EnUs => "declined",
                Self::JaJp => "拒否",
                Self::KoKr => "거부됨",
            },
            "settings updated" => match self {
                Self::ZhCn => "设置已更新",
                Self::ZhTw => "設定已更新",
                Self::EnUs => "settings updated",
                Self::JaJp => "設定を更新しました",
                Self::KoKr => "설정이 업데이트됨",
            },
            "collaboration mode updated" => match self {
                Self::ZhCn => "协作模式已更新",
                Self::ZhTw => "協作模式已更新",
                Self::EnUs => "collaboration mode updated",
                Self::JaJp => "コラボレーションモードを更新しました",
                Self::KoKr => "협업 모드가 업데이트됨",
            },
            "plan mode" => match self {
                Self::ZhCn => "计划模式",
                Self::ZhTw => "計畫模式",
                Self::EnUs => "plan mode",
                Self::JaJp => "計画モード",
                Self::KoKr => "계획 모드",
            },
            "plan mode unavailable on this server" => match self {
                Self::ZhCn => "此服务器不支持计划模式",
                Self::ZhTw => "此伺服器不支援計畫模式",
                Self::EnUs => "plan mode unavailable on this server",
                Self::JaJp => "このサーバーでは計画モードを利用できません",
                Self::KoKr => "이 서버에서는 계획 모드를 사용할 수 없음",
            },
            "switched agent" => match self {
                Self::ZhCn => "已切换 Agent",
                Self::ZhTw => "已切換 Agent",
                Self::EnUs => "switched agent",
                Self::JaJp => "Agent を切り替えました",
                Self::KoKr => "에이전트 전환됨",
            },
            "sub-agent thread is parent-owned" => match self {
                Self::ZhCn => "子 Agent 会话由父会话控制",
                Self::ZhTw => "子 Agent 工作階段由父工作階段控制",
                Self::EnUs => "sub-agent thread is parent-owned",
                Self::JaJp => "サブ Agent スレッドは親が管理します",
                Self::KoKr => "하위 에이전트 스레드는 부모가 제어함",
            },
            "agent switch failed" => match self {
                Self::ZhCn => "切换 Agent 失败",
                Self::ZhTw => "切換 Agent 失敗",
                Self::EnUs => "agent switch failed",
                Self::JaJp => "Agent の切り替えに失敗しました",
                Self::KoKr => "에이전트 전환 실패",
            },
            "no sub-agents available" => match self {
                Self::ZhCn => "暂无可用的子 Agent",
                Self::ZhTw => "目前沒有可用的子 Agent",
                Self::EnUs => "no sub-agents available",
                Self::JaJp => "利用可能なサブ Agent がありません",
                Self::KoKr => "사용 가능한 하위 에이전트가 없음",
            },
            "choose model" => match self {
                Self::ZhCn => "请选择模型",
                Self::ZhTw => "請選擇模型",
                Self::EnUs => "choose model",
                Self::JaJp => "モデルを選択",
                Self::KoKr => "모델 선택",
            },
            "steering" => match self {
                Self::ZhCn => "正在引导",
                Self::ZhTw => "正在引導",
                Self::EnUs => "steering",
                Self::JaJp => "ステアリング中",
                Self::KoKr => "조정 중",
            },
            "queued" => match self {
                Self::ZhCn => "已排队",
                Self::ZhTw => "已排隊",
                Self::EnUs => "queued",
                Self::JaJp => "キューに追加済み",
                Self::KoKr => "대기열에 추가됨",
            },
            "queue unavailable" => match self {
                Self::ZhCn => "队列不可用",
                Self::ZhTw => "佇列無法使用",
                Self::EnUs => "queue unavailable",
                Self::JaJp => "キューを利用できません",
                Self::KoKr => "대기열을 사용할 수 없음",
            },
            "queued input editing" => match self {
                Self::ZhCn => "正在编辑排队输入",
                Self::ZhTw => "正在編輯排隊輸入",
                Self::EnUs => "editing queued input",
                Self::JaJp => "キュー入力を編集中",
                Self::KoKr => "대기 입력 편집 중",
            },
            "queued input unavailable" => match self {
                Self::ZhCn => "排队输入已不可用",
                Self::ZhTw => "排隊輸入已無法使用",
                Self::EnUs => "queued input unavailable",
                Self::JaJp => "キュー入力を利用できません",
                Self::KoKr => "대기 입력을 사용할 수 없음",
            },
            "queue edit failed" => match self {
                Self::ZhCn => "编辑排队输入失败",
                Self::ZhTw => "編輯排隊輸入失敗",
                Self::EnUs => "queue edit failed",
                Self::JaJp => "キュー入力の編集に失敗しました",
                Self::KoKr => "대기 입력 편집 실패",
            },
            "interrupting" => match self {
                Self::ZhCn => "正在中断",
                Self::ZhTw => "正在中斷",
                Self::EnUs => "interrupting",
                Self::JaJp => "中断中",
                Self::KoKr => "중단 중",
            },
            "copied last response" => match self {
                Self::ZhCn => "已复制上一条回复",
                Self::ZhTw => "已複製上一則回覆",
                Self::EnUs => "copied last response",
                Self::JaJp => "前回の応答をコピーしました",
                Self::KoKr => "마지막 응답을 복사함",
            },
            "no agent response to copy" => match self {
                Self::ZhCn => "没有可复制的 Agent 回复",
                Self::ZhTw => "沒有可複製的 Agent 回覆",
                Self::EnUs => "no agent response to copy",
                Self::JaJp => "コピーできる Agent 応答がありません",
                Self::KoKr => "복사할 Agent 응답이 없음",
            },
            "copy failed" => match self {
                Self::ZhCn => "复制失败",
                Self::ZhTw => "複製失敗",
                Self::EnUs => "copy failed",
                Self::JaJp => "コピーに失敗しました",
                Self::KoKr => "복사 실패",
            },
            "exported conversation to clipboard" => match self {
                Self::ZhCn => "已将完整对话复制到剪贴板",
                Self::ZhTw => "已將完整對話複製到剪貼簿",
                Self::EnUs => "exported conversation to clipboard",
                Self::JaJp => "完全な会話をクリップボードにコピーしました",
                Self::KoKr => "전체 대화를 클립보드에 복사함",
            },
            "exported conversation to" => match self {
                Self::ZhCn => "完整对话已导出到",
                Self::ZhTw => "完整對話已匯出到",
                Self::EnUs => "exported conversation to",
                Self::JaJp => "完全な会話をエクスポートしました",
                Self::KoKr => "전체 대화를 내보냄",
            },
            "export failed" => match self {
                Self::ZhCn => "导出失败",
                Self::ZhTw => "匯出失敗",
                Self::EnUs => "export failed",
                Self::JaJp => "エクスポートに失敗しました",
                Self::KoKr => "내보내기 실패",
            },
            "image attached" => match self {
                Self::ZhCn => "已附加图片",
                Self::ZhTw => "已附加圖片",
                Self::EnUs => "image attached",
                Self::JaJp => "画像を添付しました",
                Self::KoKr => "이미지 첨부됨",
            },
            "image paste failed" => match self {
                Self::ZhCn => "粘贴图片失败",
                Self::ZhTw => "貼上圖片失敗",
                Self::EnUs => "image paste failed",
                Self::JaJp => "画像の貼り付けに失敗しました",
                Self::KoKr => "이미지 붙여넣기 실패",
            },
            "clipboard paste failed" => match self {
                Self::ZhCn => "粘贴剪贴板内容失败",
                Self::ZhTw => "貼上剪貼簿內容失敗",
                Self::EnUs => "clipboard paste failed",
                Self::JaJp => "クリップボードの貼り付けに失敗しました",
                Self::KoKr => "클립보드 붙여넣기 실패",
            },
            "clipboard is busy" => match self {
                Self::ZhCn => "剪贴板正忙",
                Self::ZhTw => "剪貼簿忙碌中",
                Self::EnUs => "clipboard is busy",
                Self::JaJp => "クリップボードは使用中です",
                Self::KoKr => "클립보드가 사용 중임",
            },
            "reconnecting" => match self {
                Self::ZhCn => "正在重连",
                Self::ZhTw => "正在重新連線",
                Self::EnUs => "reconnecting",
                Self::JaJp => "再接続中",
                Self::KoKr => "재연결 중",
            },
            "reconnected" => match self {
                Self::ZhCn => "已重新连接",
                Self::ZhTw => "已重新連線",
                Self::EnUs => "reconnected",
                Self::JaJp => "再接続しました",
                Self::KoKr => "재연결됨",
            },
            "reconnect failed" => match self {
                Self::ZhCn => "重连失败",
                Self::ZhTw => "重新連線失敗",
                Self::EnUs => "reconnect failed",
                Self::JaJp => "再接続に失敗しました",
                Self::KoKr => "재연결 실패",
            },
            "effort" => self.effort_label(),
            "permissions" => self.permissions_label(),
            "prompt history unavailable" => match self {
                Self::ZhCn => "提示历史不可用",
                Self::ZhTw => "提示歷史不可用",
                Self::EnUs => "prompt history unavailable",
                Self::JaJp => "プロンプト履歴を利用できません",
                Self::KoKr => "프롬프트 기록을 사용할 수 없음",
            },
            _ => return status.to_string(),
        };
        rest.map_or_else(|| label.to_string(), |rest| format!("{label}: {rest}"))
    }

    pub(crate) fn multi_agent(self, text: &str) -> String {
        if text == "Finished waiting" {
            return match self {
                Self::ZhCn => "等待完成".to_string(),
                Self::ZhTw => "等待完成".to_string(),
                Self::EnUs => text.to_string(),
                Self::JaJp => "待機が完了しました".to_string(),
                Self::KoKr => "대기 완료".to_string(),
            };
        }

        const PREFIXES: &[(&str, &str, &str, &str, &str)] = &[
            ("Spawned ", "已启动 ", "已啟動 ", "起動: ", "생성됨 "),
            (
                "Sent input to ",
                "已向其发送输入 ",
                "已向其傳送輸入 ",
                "入力送信: ",
                "입력 전송: ",
            ),
            (
                "Resuming ",
                "正在恢复 ",
                "正在恢復 ",
                "再開中: ",
                "재개 중: ",
            ),
            ("Resumed ", "已恢复 ", "已恢復 ", "再開済み: ", "재개됨 "),
            (
                "Waiting for ",
                "正在等待 ",
                "正在等待 ",
                "待機中: ",
                "대기 중: ",
            ),
            ("Closed ", "已关闭 ", "已關閉 ", "終了: ", "닫힘 "),
            ("Started ", "已开始 ", "已開始 ", "開始: ", "시작됨 "),
            (
                "Interacted with ",
                "已与其交互 ",
                "已與其互動 ",
                "操作: ",
                "상호작용: ",
            ),
            ("Interrupted ", "已中断 ", "已中斷 ", "中断: ", "중단됨 "),
        ];
        PREFIXES
            .iter()
            .find_map(|(prefix, zh_cn, zh_tw, ja, ko)| {
                text.strip_prefix(prefix).map(|rest| {
                    let label = match self {
                        Self::ZhCn => zh_cn,
                        Self::ZhTw => zh_tw,
                        Self::EnUs => prefix,
                        Self::JaJp => ja,
                        Self::KoKr => ko,
                    };
                    format!("{label}{rest}")
                })
            })
            .unwrap_or_else(|| text.to_string())
    }

    pub(crate) fn detail(self, detail: &str) -> String {
        const PREFIXES: &[(&str, &str, &str, &str, &str)] = &[
            ("exit ", "退出 ", "退出 ", "exit ", "종료 "),
            ("duration ", "耗时 ", "耗時 ", "所要時間 ", "소요 시간 "),
            (
                "files: ",
                "文件数：",
                "檔案數：",
                "ファイル数: ",
                "파일 수: ",
            ),
            ("added: ", "新增：", "新增：", "追加: ", "추가: "),
            ("deleted: ", "删除：", "刪除：", "削除: ", "삭제: "),
            ("updated: ", "更新：", "更新：", "更新: ", "업데이트: "),
            (
                "result items: ",
                "结果项：",
                "結果項：",
                "結果項目: ",
                "결과 항목: ",
            ),
            (
                "content types: ",
                "内容类型：",
                "內容類型：",
                "コンテンツ種別: ",
                "콘텐츠 유형: ",
            ),
            ("output: ", "输出：", "輸出：", "出力: ", "출력: "),
            (
                "computer action: ",
                "电脑操作：",
                "電腦操作：",
                "コンピュータ操作: ",
                "컴퓨터 작업: ",
            ),
            (
                "computer error: ",
                "电脑错误：",
                "電腦錯誤：",
                "コンピュータ エラー: ",
                "컴퓨터 오류: ",
            ),
            (
                "computer screenshot: ",
                "电脑截图：",
                "電腦螢幕截圖：",
                "コンピュータ スクリーンショット: ",
                "컴퓨터 스크린샷: ",
            ),
            (
                "structured content: ",
                "结构化内容：",
                "結構化內容：",
                "構造化コンテンツ: ",
                "구조화 콘텐츠: ",
            ),
            ("truncated", "已截断", "已截斷", "切り詰め済み", "잘림"),
            (
                "output available",
                "可获取输出",
                "可取得輸出",
                "出力を取得可能",
                "출력 사용 가능",
            ),
            ("error: ", "错误：", "錯誤：", "エラー: ", "오류: "),
            ("success: ", "成功：", "成功：", "成功: ", "성공: "),
            (
                "content items: ",
                "内容项：",
                "內容項：",
                "内容項目: ",
                "콘텐츠 항목: ",
            ),
            (
                "agents: ",
                "Agent 数：",
                "Agent 數：",
                "Agent 数: ",
                "에이전트 수: ",
            ),
            ("model: ", "模型：", "模型：", "モデル: ", "모델: "),
            (
                "effort: ",
                "思考强度：",
                "思考強度：",
                "推論強度: ",
                "추론 강도: ",
            ),
            (
                "prompt: ",
                "提示词：",
                "提示詞：",
                "プロンプト: ",
                "프롬프트: ",
            ),
            (
                "web search: ",
                "网页搜索：",
                "網頁搜尋：",
                "ウェブ検索: ",
                "웹 검색: ",
            ),
            (
                "hook completed",
                "Hook 已完成",
                "Hook 已完成",
                "Hook 完了",
                "Hook 완료",
            ),
            (
                "hook failed",
                "Hook 失败",
                "Hook 失敗",
                "Hook 失敗",
                "Hook 실패",
            ),
            (
                "hook blocked",
                "Hook 已阻断",
                "Hook 已封鎖",
                "Hook がブロックされました",
                "Hook 차단됨",
            ),
            (
                "hook stopped",
                "Hook 已停止",
                "Hook 已停止",
                "Hook 停止",
                "Hook 중지됨",
            ),
            (
                "hook output: ",
                "Hook 输出：",
                "Hook 輸出：",
                "Hook 出力: ",
                "Hook 출력: ",
            ),
            (
                "searching the web",
                "正在搜索网页",
                "正在搜尋網頁",
                "ウェブを検索中",
                "웹 검색 중",
            ),
            (
                "searched the web for ",
                "已搜索网页：",
                "已搜尋網頁：",
                "ウェブ検索済み：",
                "웹 검색 완료: ",
            ),
            (
                "searched the web",
                "已搜索网页",
                "已搜尋網頁",
                "ウェブ検索済み",
                "웹 검색 완료",
            ),
            (
                "view image: ",
                "查看图片：",
                "檢視圖片：",
                "画像を表示: ",
                "이미지 보기: ",
            ),
            ("result: ", "结果：", "結果：", "結果: ", "결과: "),
            ("saved: ", "已保存：", "已儲存：", "保存済み: ", "저장됨: "),
            (
                "revised prompt: ",
                "修订提示：",
                "修訂提示：",
                "修正プロンプト: ",
                "수정된 프롬프트: ",
            ),
            (
                "review started: ",
                "审查开始：",
                "審查開始：",
                "レビュー開始: ",
                "검토 시작: ",
            ),
            (
                "review completed: ",
                "审查完成：",
                "審查完成：",
                "レビュー完成: ",
                "검토 완료: ",
            ),
            (
                "context compacted",
                "上下文已压缩",
                "內容已壓縮",
                "コンテキストを圧縮しました",
                "컨텍스트가 압축됨",
            ),
            (
                "image generation",
                "图片生成",
                "圖片生成",
                "画像生成",
                "이미지 생성",
            ),
            (
                "unsupported item: ",
                "不支持的条目：",
                "不支援的項目：",
                "未対応項目: ",
                "지원되지 않는 항목: ",
            ),
            ("pending: ", "待处理：", "待處理：", "保留中: ", "대기 중: "),
            ("running: ", "运行中：", "執行中：", "実行中: ", "실행 중: "),
            (
                "interrupted: ",
                "已中断：",
                "已中斷：",
                "中断: ",
                "중단됨: ",
            ),
            ("completed: ", "已完成：", "已完成：", "完了: ", "완료: "),
            ("errored: ", "出错：", "發生錯誤：", "エラー: ", "오류: "),
            (
                "shutdown: ",
                "已关闭：",
                "已關閉：",
                "シャットダウン: ",
                "종료됨: ",
            ),
            (
                "not-found: ",
                "未找到：",
                "找不到：",
                "見つかりません: ",
                "찾을 수 없음: ",
            ),
        ];
        PREFIXES
            .iter()
            .find_map(|(prefix, zh_cn, zh_tw, ja, ko)| {
                detail.strip_prefix(prefix).map(|rest| {
                    let label = match self {
                        Self::ZhCn => zh_cn,
                        Self::ZhTw => zh_tw,
                        Self::EnUs => prefix,
                        Self::JaJp => ja,
                        Self::KoKr => ko,
                    };
                    format!("{label}{rest}")
                })
            })
            .unwrap_or_else(|| detail.to_string())
    }

    pub(crate) fn output_omitted_lines(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("… 已省略 {count} 行 …"),
            Self::ZhTw => format!("… 已省略 {count} 行 …"),
            Self::EnUs => format!("… {count} lines omitted …"),
            Self::JaJp => format!("… {count} 行を省略 …"),
            Self::KoKr => format!("… {count}줄 생략 …"),
        }
    }

    pub(crate) fn output_omitted_bytes(self, count: usize) -> String {
        match self {
            Self::ZhCn => format!("… 已省略 {count} 字节 …"),
            Self::ZhTw => format!("… 已省略 {count} 位元組 …"),
            Self::EnUs => format!("… {count} bytes omitted …"),
            Self::JaJp => format!("… {count} バイトを省略 …"),
            Self::KoKr => format!("… {count}바이트 생략 …"),
        }
    }

    pub(crate) fn approval_title(self, kind: &str) -> &'static str {
        match (self, kind) {
            (Self::ZhCn, "command") => "批准命令？",
            (Self::ZhTw, "command") => "核准命令？",
            (Self::JaJp, "command") => "コマンドを承認しますか？",
            (Self::KoKr, "command") => "명령을 승인할까요?",
            (Self::ZhCn, "file") => "批准文件更改？",
            (Self::ZhTw, "file") => "核准檔案變更？",
            (Self::JaJp, "file") => "ファイル変更を承認しますか？",
            (Self::KoKr, "file") => "파일 변경을 승인할까요?",
            (Self::ZhCn, "permissions") => "授予额外权限？",
            (Self::ZhTw, "permissions") => "授予額外權限？",
            (Self::JaJp, "permissions") => "追加権限を付与しますか？",
            (Self::KoKr, "permissions") => "추가 권한을 부여할까요?",
            (_, "command") => "Approve command?",
            (_, "file") => "Approve file changes?",
            _ => "Grant additional permissions?",
        }
    }

    pub(crate) fn request_input_action_label(self) -> &'static str {
        match self {
            Self::ZhCn => "需要回答",
            Self::ZhTw => "需要回答",
            Self::EnUs => "Input required",
            Self::JaJp => "入力が必要",
            Self::KoKr => "입력 필요",
        }
    }

    pub(crate) fn approval_option(self, label: &str) -> String {
        match (self, label) {
            (Self::ZhCn, "Accept") => "批准".to_string(),
            (Self::ZhTw, "Accept") => "核准".to_string(),
            (Self::JaJp, "Accept") => "承認".to_string(),
            (Self::KoKr, "Accept") => "승인".to_string(),
            (Self::ZhCn, "Decline") => "拒绝".to_string(),
            (Self::ZhTw, "Decline") => "拒絕".to_string(),
            (Self::JaJp, "Decline") => "拒否".to_string(),
            (Self::KoKr, "Decline") => "거부".to_string(),
            (Self::ZhCn, "Cancel") => "取消".to_string(),
            (Self::ZhTw, "Cancel") => "取消".to_string(),
            (Self::JaJp, "Cancel") => "キャンセル".to_string(),
            (Self::KoKr, "Cancel") => "취소".to_string(),
            (Self::ZhCn, "Allow once") => "允许一次".to_string(),
            (Self::ZhTw, "Allow once") => "允許一次".to_string(),
            (Self::JaJp, "Allow once") => "一度だけ許可".to_string(),
            (Self::KoKr, "Allow once") => "한 번 허용".to_string(),
            (Self::ZhCn, "Allow for this session") => "允许本会话".to_string(),
            (Self::ZhTw, "Allow for this session") => "允許本工作階段".to_string(),
            (Self::JaJp, "Allow for this session") => "このセッションで許可".to_string(),
            (Self::KoKr, "Allow for this session") => "이 세션에 허용".to_string(),
            (Self::ZhCn, "Cancel turn") => "取消本回合".to_string(),
            (Self::ZhTw, "Cancel turn") => "取消本回合".to_string(),
            (Self::JaJp, "Cancel turn") => "ターンをキャンセル".to_string(),
            (Self::KoKr, "Cancel turn") => "턴 취소".to_string(),
            (Self::ZhCn, "Grant for this turn") => "仅授予本回合".to_string(),
            (Self::ZhTw, "Grant for this turn") => "僅授予本回合".to_string(),
            (Self::JaJp, "Grant for this turn") => "このターンのみ許可".to_string(),
            (Self::KoKr, "Grant for this turn") => "이 턴에만 허용".to_string(),
            (Self::ZhCn, "Grant for this session") => "授予本会话".to_string(),
            (Self::ZhTw, "Grant for this session") => "授予本工作階段".to_string(),
            (Self::JaJp, "Grant for this session") => "このセッションで許可".to_string(),
            (Self::KoKr, "Grant for this session") => "이 세션에 허용".to_string(),
            _ => label.to_string(),
        }
    }

    pub(crate) fn approval_confirm_hint(&self, key: &str) -> String {
        format!(
            "{} {}",
            display_key_label(key),
            self.approval_confirm_label()
        )
    }

    fn approval_confirm_label(&self) -> &'static str {
        match self {
            Self::ZhCn => "确认",
            Self::ZhTw => "確認",
            Self::EnUs => "confirm",
            Self::JaJp => "確定",
            Self::KoKr => "확인",
        }
    }

    pub(crate) fn approval_cancel_hint(&self, key: &str) -> String {
        format!(
            "{} {}",
            display_key_label(key),
            self.approval_cancel_label()
        )
    }

    fn approval_cancel_label(&self) -> &'static str {
        match self {
            Self::ZhCn => "取消",
            Self::ZhTw => "取消",
            Self::EnUs => "cancel",
            Self::JaJp => "キャンセル",
            Self::KoKr => "취소",
        }
    }

    pub(crate) fn request_submit_hint(self, key: &str) -> String {
        format!("{} {}", display_key_label(key), self.request_submit_label())
    }

    fn request_submit_label(self) -> &'static str {
        match self {
            Self::ZhCn => "提交",
            Self::ZhTw => "提交",
            Self::EnUs => "submit",
            Self::JaJp => "送信",
            Self::KoKr => "제출",
        }
    }

    pub(crate) fn request_cancel_hint(self, key: &str) -> String {
        format!("{} {}", display_key_label(key), self.request_cancel_label())
    }

    fn request_cancel_label(self) -> &'static str {
        match self {
            Self::ZhCn => "取消",
            Self::ZhTw => "取消",
            Self::EnUs => "cancel",
            Self::JaJp => "キャンセル",
            Self::KoKr => "취소",
        }
    }

    pub(crate) fn request_notes_hint(self, key: &str) -> String {
        format!("{} {}", display_key_label(key), self.request_notes_label())
    }

    fn request_notes_label(self) -> &'static str {
        match self {
            Self::ZhCn => "备注",
            Self::ZhTw => "備註",
            Self::EnUs => "notes",
            Self::JaJp => "メモ",
            Self::KoKr => "메모",
        }
    }

    pub(crate) fn request_select_hint(self, up: &str, down: &str) -> String {
        format!(
            "{}/{} {}",
            display_key_label(up),
            display_key_label(down),
            self.request_select_label()
        )
    }

    fn request_select_label(self) -> &'static str {
        match self {
            Self::ZhCn => "选择",
            Self::ZhTw => "選擇",
            Self::EnUs => "select",
            Self::JaJp => "選択",
            Self::KoKr => "선택",
        }
    }

    pub(crate) fn request_question_nav_hint(self, left: &str, right: &str) -> String {
        format!(
            "{}/{} {}",
            display_key_label(left),
            display_key_label(right),
            self.request_question_nav_label()
        )
    }

    fn request_question_nav_label(self) -> &'static str {
        match self {
            Self::ZhCn => "切换问题",
            Self::ZhTw => "切換問題",
            Self::EnUs => "questions",
            Self::JaJp => "質問",
            Self::KoKr => "질문",
        }
    }

    pub(crate) fn request_option_position_hint(self, current: usize, total: usize) -> String {
        match self {
            Self::ZhCn => format!("选项 {current}/{total}"),
            Self::ZhTw => format!("選項 {current}/{total}"),
            Self::EnUs => format!("option {current}/{total}"),
            Self::JaJp => format!("選択肢 {current}/{total}"),
            Self::KoKr => format!("옵션 {current}/{total}"),
        }
    }

    pub(crate) fn mcp_elicitation_title(self, server_name: &str) -> String {
        match self {
            Self::ZhCn => format!("MCP 请求：{server_name}"),
            Self::ZhTw => format!("MCP 要求：{server_name}"),
            Self::EnUs => format!("MCP request: {server_name}"),
            Self::JaJp => format!("MCP リクエスト：{server_name}"),
            Self::KoKr => format!("MCP 요청: {server_name}"),
        }
    }

    pub(crate) fn mcp_elicitation_progress(self, current: usize, total: usize) -> String {
        match self {
            Self::ZhCn => format!("字段 {current}/{total}"),
            Self::ZhTw => format!("欄位 {current}/{total}"),
            Self::EnUs => format!("Field {current}/{total}"),
            Self::JaJp => format!("フィールド {current}/{total}"),
            Self::KoKr => format!("필드 {current}/{total}"),
        }
    }

    pub(crate) fn mcp_elicitation_text_placeholder(self, required: bool) -> &'static str {
        match (self, required) {
            (Self::ZhCn, true) => "请输入答案",
            (Self::ZhCn, false) => "请输入答案（可选）",
            (Self::ZhTw, true) => "請輸入答案",
            (Self::ZhTw, false) => "請輸入答案（選填）",
            (Self::EnUs, true) => "Type an answer",
            (Self::EnUs, false) => "Type an answer (optional)",
            (Self::JaJp, true) => "回答を入力",
            (Self::JaJp, false) => "回答を入力（任意）",
            (Self::KoKr, true) => "답변 입력",
            (Self::KoKr, false) => "답변 입력 (선택 사항)",
        }
    }

    pub(crate) fn mcp_elicitation_boolean_option(self, value: bool) -> &'static str {
        match (self, value) {
            (Self::ZhCn, true) => "是",
            (Self::ZhCn, false) => "否",
            (Self::ZhTw, true) => "是",
            (Self::ZhTw, false) => "否",
            (Self::EnUs, true) => "True",
            (Self::EnUs, false) => "False",
            (Self::JaJp, true) => "はい",
            (Self::JaJp, false) => "いいえ",
            (Self::KoKr, true) => "예",
            (Self::KoKr, false) => "아니요",
        }
    }

    pub(crate) fn mcp_elicitation_approval_option(self, value: &str) -> &'static str {
        match (self, value) {
            (Self::ZhCn, "accept") => "允许",
            (Self::ZhCn, "accept_session") => "允许本次会话",
            (Self::ZhCn, "accept_always") => "始终允许",
            (Self::ZhCn, "decline") => "拒绝",
            (Self::ZhCn, "cancel") => "取消",
            (Self::ZhTw, "accept") => "允許",
            (Self::ZhTw, "accept_session") => "允許此工作階段",
            (Self::ZhTw, "accept_always") => "一律允許",
            (Self::ZhTw, "decline") => "拒絕",
            (Self::ZhTw, "cancel") => "取消",
            (Self::EnUs, "accept") => "Allow",
            (Self::EnUs, "accept_session") => "Allow for this session",
            (Self::EnUs, "accept_always") => "Always allow",
            (Self::EnUs, "decline") => "Deny",
            (Self::EnUs, "cancel") => "Cancel",
            (Self::JaJp, "accept") => "許可",
            (Self::JaJp, "accept_session") => "このセッションで許可",
            (Self::JaJp, "accept_always") => "常に許可",
            (Self::JaJp, "decline") => "拒否",
            (Self::JaJp, "cancel") => "キャンセル",
            (Self::KoKr, "accept") => "허용",
            (Self::KoKr, "accept_session") => "이 세션에서 허용",
            (Self::KoKr, "accept_always") => "항상 허용",
            (Self::KoKr, "decline") => "거부",
            (Self::KoKr, "cancel") => "취소",
            (_, _) => "",
        }
    }

    pub(crate) fn mcp_confirm_hint(self, key: &str) -> String {
        format!("{} {}", display_key_label(key), self.mcp_confirm_label())
    }

    fn mcp_confirm_label(self) -> &'static str {
        match self {
            Self::ZhCn => "确认",
            Self::ZhTw => "確認",
            Self::EnUs => "confirm",
            Self::JaJp => "確定",
            Self::KoKr => "확인",
        }
    }

    pub(crate) fn mcp_cancel_hint(self, key: &str) -> String {
        format!("{} {}", display_key_label(key), self.mcp_cancel_label())
    }

    fn mcp_cancel_label(self) -> &'static str {
        match self {
            Self::ZhCn => "取消",
            Self::ZhTw => "取消",
            Self::EnUs => "cancel",
            Self::JaJp => "キャンセル",
            Self::KoKr => "취소",
        }
    }

    pub(crate) fn mcp_select_hint(self, up: &str, down: &str) -> String {
        format!(
            "{}/{} {}",
            display_key_label(up),
            display_key_label(down),
            self.mcp_select_label()
        )
    }

    fn mcp_select_label(self) -> &'static str {
        match self {
            Self::ZhCn => "选择",
            Self::ZhTw => "選擇",
            Self::EnUs => "select",
            Self::JaJp => "選択",
            Self::KoKr => "선택",
        }
    }

    pub(crate) fn mcp_field_hint(
        self,
        tab: &str,
        left: Option<&str>,
        right: Option<&str>,
    ) -> String {
        let keys = [Some(tab), left, right]
            .into_iter()
            .flatten()
            .map(display_key_label)
            .collect::<Vec<_>>()
            .join("/");
        format!("{keys} {}", self.mcp_field_label())
    }

    fn mcp_field_label(self) -> &'static str {
        match self {
            Self::ZhCn => "切换字段",
            Self::ZhTw => "切換欄位",
            Self::EnUs => "switch field",
            Self::JaJp => "フィールド切替",
            Self::KoKr => "필드 전환",
        }
    }

    pub(crate) fn mcp_elicitation_required_error(self) -> &'static str {
        match self {
            Self::ZhCn => "请先填写必填字段。",
            Self::ZhTw => "請先填寫必填欄位。",
            Self::EnUs => "Answer all required fields first.",
            Self::JaJp => "必須フィールドを先に入力してください。",
            Self::KoKr => "필수 필드를 먼저 입력하세요.",
        }
    }

    pub(crate) fn mcp_elicitation_invalid(self) -> &'static str {
        match self {
            Self::ZhCn => "无法显示此 MCP 请求",
            Self::ZhTw => "無法顯示此 MCP 要求",
            Self::EnUs => "Unable to display this MCP request",
            Self::JaJp => "この MCP リクエストを表示できません",
            Self::KoKr => "이 MCP 요청을 표시할 수 없습니다",
        }
    }

    #[allow(dead_code)]
    pub(crate) fn resume_title(self) -> &'static str {
        match self {
            Self::ZhCn => "选择会话",
            Self::ZhTw => "選擇工作階段",
            Self::EnUs => "Select a conversation",
            Self::JaJp => "会話を選択",
            Self::KoKr => "대화 선택",
        }
    }

    pub(crate) fn untitled_conversation(self) -> &'static str {
        match self {
            Self::ZhCn => "未命名会话",
            Self::ZhTw => "未命名工作階段",
            Self::EnUs => "Untitled conversation",
            Self::JaJp => "無題の会話",
            Self::KoKr => "제목 없는 대화",
        }
    }

    #[allow(dead_code)]
    pub(crate) fn resume_label(self) -> &'static str {
        match self {
            Self::ZhCn => "恢复",
            Self::ZhTw => "恢復",
            Self::EnUs => "Resume",
            Self::JaJp => "再開",
            Self::KoKr => "재개",
        }
    }

    pub(crate) fn thread_state(self, state: &str) -> Cow<'static, str> {
        match (self, state) {
            (Self::ZhCn, "active") => Cow::Borrowed("活动"),
            (Self::ZhTw, "active") => Cow::Borrowed("使用中"),
            (Self::JaJp, "active") => Cow::Borrowed("アクティブ"),
            (Self::KoKr, "active") => Cow::Borrowed("활성"),
            (Self::ZhCn, "idle") => Cow::Borrowed("空闲"),
            (Self::ZhTw, "idle") => Cow::Borrowed("閒置"),
            (Self::JaJp, "idle") => Cow::Borrowed("アイドル"),
            (Self::KoKr, "idle") => Cow::Borrowed("유휴"),
            (Self::ZhCn, "not loaded") => Cow::Borrowed("未加载"),
            (Self::ZhTw, "not loaded") => Cow::Borrowed("未載入"),
            (Self::JaJp, "not loaded") => Cow::Borrowed("未読込"),
            (Self::KoKr, "not loaded") => Cow::Borrowed("로드되지 않음"),
            (Self::ZhCn, "error") => Cow::Borrowed("错误"),
            (Self::ZhTw, "error") => Cow::Borrowed("錯誤"),
            (Self::JaJp, "error") => Cow::Borrowed("エラー"),
            (Self::KoKr, "error") => Cow::Borrowed("오류"),
            (_, state) => Cow::Owned(state.to_string()),
        }
    }

    pub(crate) fn resume_empty(self) -> &'static str {
        match self {
            Self::ZhCn => "没有可恢复的会话。按 Esc 取消。",
            Self::ZhTw => "沒有可恢復的工作階段。按 Esc 取消。",
            Self::EnUs => "No resumable conversations. Press Esc to cancel.",
            Self::JaJp => "再開できる会話がありません。Esc でキャンセル。",
            Self::KoKr => "재개할 수 있는 대화가 없습니다. Esc로 취소.",
        }
    }

    pub(crate) fn resume_loading(self) -> &'static str {
        match self {
            Self::ZhCn => "正在加载会话…",
            Self::ZhTw => "正在載入工作階段…",
            Self::EnUs => "Loading conversations…",
            Self::JaJp => "会話を読み込み中…",
            Self::KoKr => "대화 로드 중…",
        }
    }

    pub(crate) fn resume_status_label(self, archived: bool) -> &'static str {
        match (self, archived) {
            (Self::ZhCn, false) => "活动",
            (Self::ZhCn, true) => "已归档",
            (Self::ZhTw, false) => "使用中",
            (Self::ZhTw, true) => "已封存",
            (Self::EnUs, false) => "Active",
            (Self::EnUs, true) => "Archived",
            (Self::JaJp, false) => "アクティブ",
            (Self::JaJp, true) => "アーカイブ済み",
            (Self::KoKr, false) => "활성",
            (Self::KoKr, true) => "보관됨",
        }
    }

    pub(crate) fn resume_filter_label(self, show_all: bool) -> &'static str {
        match (self, show_all) {
            (Self::ZhCn, false) => "当前目录",
            (Self::ZhCn, true) => "全部目录",
            (Self::ZhTw, false) => "目前目錄",
            (Self::ZhTw, true) => "所有目錄",
            (Self::EnUs, false) => "Current cwd",
            (Self::EnUs, true) => "All directories",
            (Self::JaJp, false) => "現在のディレクトリ",
            (Self::JaJp, true) => "すべてのディレクトリ",
            (Self::KoKr, false) => "현재 디렉터리",
            (Self::KoKr, true) => "모든 디렉터리",
        }
    }

    pub(crate) fn resume_sort_label(self, created: bool) -> &'static str {
        match (self, created) {
            (Self::ZhCn, false) => "按更新时间",
            (Self::ZhCn, true) => "按创建时间",
            (Self::ZhTw, false) => "依更新時間",
            (Self::ZhTw, true) => "依建立時間",
            (Self::EnUs, false) => "Updated",
            (Self::EnUs, true) => "Created",
            (Self::JaJp, false) => "更新日時順",
            (Self::JaJp, true) => "作成日時順",
            (Self::KoKr, false) => "업데이트순",
            (Self::KoKr, true) => "생성순",
        }
    }

    pub(crate) fn resume_density_label(self, dense: bool) -> &'static str {
        match (self, dense) {
            (Self::ZhCn, false) => "紧凑视图",
            (Self::ZhCn, true) => "舒适视图",
            (Self::ZhTw, false) => "緊湊檢視",
            (Self::ZhTw, true) => "舒適檢視",
            (Self::EnUs, false) => "Dense view",
            (Self::EnUs, true) => "Comfortable view",
            (Self::JaJp, false) => "コンパクト表示",
            (Self::JaJp, true) => "標準表示",
            (Self::KoKr, false) => "밀집 보기",
            (Self::KoKr, true) => "편안한 보기",
        }
    }

    pub(crate) fn resume_search_placeholder(self) -> &'static str {
        match self {
            Self::ZhCn => "输入以搜索会话",
            Self::ZhTw => "輸入以搜尋工作階段",
            Self::EnUs => "Type to search conversations",
            Self::JaJp => "入力して会話を検索",
            Self::KoKr => "입력하여 대화 검색",
        }
    }

    pub(crate) fn resume_picker_title(self, fork: bool) -> &'static str {
        match (self, fork) {
            (Self::ZhCn, false) => "恢复之前的会话",
            (Self::ZhCn, true) => "从之前的会话分叉",
            (Self::ZhTw, false) => "恢復先前的工作階段",
            (Self::ZhTw, true) => "從先前的工作階段分支",
            (Self::EnUs, false) => "Resume a previous session",
            (Self::EnUs, true) => "Fork a previous session",
            (Self::JaJp, false) => "以前のセッションを再開",
            (Self::JaJp, true) => "以前のセッションを分岐",
            (Self::KoKr, false) => "이전 세션 재개",
            (Self::KoKr, true) => "이전 세션에서 분기",
        }
    }

    pub(crate) fn resume_expand_label(self) -> &'static str {
        match self {
            Self::ZhCn => "展开记录",
            Self::ZhTw => "展開記錄",
            Self::EnUs => "expand transcript",
            Self::JaJp => "履歴を展開",
            Self::KoKr => "대화 기록 펼치기",
        }
    }

    pub(crate) fn resume_transcript_label(self) -> &'static str {
        match self {
            Self::ZhCn => "查看完整记录",
            Self::ZhTw => "檢視完整記錄",
            Self::EnUs => "view full transcript",
            Self::JaJp => "完全な履歴を表示",
            Self::KoKr => "전체 대화 기록 보기",
        }
    }

    pub(crate) fn created_label(self) -> &'static str {
        match self {
            Self::ZhCn => "创建时间",
            Self::ZhTw => "建立時間",
            Self::EnUs => "created",
            Self::JaJp => "作成日時",
            Self::KoKr => "생성 시간",
        }
    }

    pub(crate) fn updated_label(self) -> &'static str {
        match self {
            Self::ZhCn => "更新时间",
            Self::ZhTw => "更新時間",
            Self::EnUs => "updated",
            Self::JaJp => "更新日時",
            Self::KoKr => "업데이트 시간",
        }
    }

    pub(crate) fn resume_transcript_loading(self) -> &'static str {
        match self {
            Self::ZhCn => "正在加载对话记录…",
            Self::ZhTw => "正在載入對話記錄…",
            Self::EnUs => "Loading transcript…",
            Self::JaJp => "会話履歴を読み込み中…",
            Self::KoKr => "대화 기록 로드 중…",
        }
    }

    pub(crate) fn resume_transcript_failed(self) -> &'static str {
        match self {
            Self::ZhCn => "无法加载对话记录",
            Self::ZhTw => "無法載入對話記錄",
            Self::EnUs => "Could not load transcript",
            Self::JaJp => "会話履歴を読み込めません",
            Self::KoKr => "대화 기록을 불러올 수 없음",
        }
    }

    pub(crate) fn resume_transcript_empty(self) -> &'static str {
        match self {
            Self::ZhCn => "没有对话内容",
            Self::ZhTw => "沒有對話內容",
            Self::EnUs => "No transcript content",
            Self::JaJp => "会話内容がありません",
            Self::KoKr => "대화 내용 없음",
        }
    }

    pub(crate) fn no_questions(self) -> &'static str {
        match self {
            Self::ZhCn => "没有问题",
            Self::ZhTw => "沒有問題",
            Self::EnUs => "No questions",
            Self::JaJp => "質問はありません",
            Self::KoKr => "질문 없음",
        }
    }

    pub(crate) fn auto_resolution_countdown(self, remaining: &str) -> String {
        match self {
            Self::ZhCn => format!("将在 {remaining} 后自动继续"),
            Self::ZhTw => format!("將在 {remaining} 後自動繼續"),
            Self::EnUs => format!("auto-resolves in {remaining}"),
            Self::JaJp => format!("{remaining}後に自動処理します"),
            Self::KoKr => format!("{remaining} 후 자동으로 계속합니다"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Locale;
    use crate::slash_command::SlashCommand;

    #[test]
    fn parses_supported_locale_families_and_falls_back_to_english() {
        assert_eq!(Locale::parse("zh_CN"), Some(Locale::ZhCn));
        assert_eq!(Locale::parse("zh-Hant-TW"), Some(Locale::ZhTw));
        assert_eq!(Locale::parse("ja"), Some(Locale::JaJp));
        assert_eq!(Locale::parse("ko-KR"), Some(Locale::KoKr));
        assert_eq!(Locale::parse("en-GB"), Some(Locale::EnUs));
        assert_eq!(Locale::parse("fr-FR"), None);
    }

    #[test]
    fn translates_statuses_and_dynamic_detail_labels_without_changing_unknown_text() {
        assert_eq!(Locale::ZhCn.status("ready"), "就绪");
        assert_eq!(Locale::ZhCn.status("reconnecting"), "正在重连");
        assert_eq!(Locale::ZhTw.status("reconnected"), "已重新連線");
        assert_eq!(Locale::EnUs.status("reconnect failed"), "reconnect failed");
        assert_eq!(Locale::JaJp.status("reconnecting"), "再接続中");
        assert_eq!(Locale::KoKr.status("reconnected"), "재연결됨");
        assert_eq!(Locale::JaJp.status("effort: high"), "推論: high");
        assert_eq!(
            Locale::ZhTw.status("image attached: 20x10"),
            "已附加圖片: 20x10"
        );
        assert_eq!(
            Locale::KoKr.status("image paste failed: unavailable"),
            "이미지 붙여넣기 실패: unavailable"
        );
        assert_eq!(Locale::KoKr.detail("files: 2"), "파일 수: 2");
        assert_eq!(Locale::ZhCn.detail("model: fixture"), "模型：fixture");
        assert_eq!(Locale::ZhTw.detail("effort: high"), "思考強度：high");
        assert_eq!(Locale::EnUs.detail("prompt: inspect"), "prompt: inspect");
        assert_eq!(Locale::JaJp.detail("model: fixture"), "モデル: fixture");
        assert_eq!(Locale::KoKr.detail("effort: high"), "추론 강도: high");
        assert_eq!(Locale::ZhCn.detail("output: ok"), "输出：ok");
        assert_eq!(Locale::ZhTw.detail("output: ok"), "輸出：ok");
        assert_eq!(Locale::EnUs.detail("output: ok"), "output: ok");
        assert_eq!(Locale::JaJp.detail("output: ok"), "出力: ok");
        assert_eq!(Locale::KoKr.detail("output: ok"), "출력: ok");
        assert_eq!(
            Locale::ZhCn.detail("structured content: {\"matches\":1}"),
            "结构化内容：{\"matches\":1}"
        );
        assert_eq!(
            Locale::ZhTw.detail("structured content: {\"matches\":1}"),
            "結構化內容：{\"matches\":1}"
        );
        assert_eq!(
            Locale::EnUs.detail("structured content: {\"matches\":1}"),
            "structured content: {\"matches\":1}"
        );
        assert_eq!(
            Locale::JaJp.detail("structured content: {\"matches\":1}"),
            "構造化コンテンツ: {\"matches\":1}"
        );
        assert_eq!(
            Locale::KoKr.detail("structured content: {\"matches\":1}"),
            "구조화 콘텐츠: {\"matches\":1}"
        );
        assert_eq!(
            Locale::ZhCn.detail("computer screenshot: captured"),
            "电脑截图：captured"
        );
        assert_eq!(
            Locale::ZhTw.detail("computer action: Capture"),
            "電腦操作：Capture"
        );
        assert_eq!(
            Locale::EnUs.detail("computer error: failed"),
            "computer error: failed"
        );
        assert_eq!(
            Locale::JaJp.detail("computer screenshot: captured"),
            "コンピュータ スクリーンショット: captured"
        );
        assert_eq!(
            Locale::KoKr.detail("computer action: Capture"),
            "컴퓨터 작업: Capture"
        );
        assert_eq!(Locale::ZhTw.detail("custom: value"), "custom: value");
        assert_eq!(Locale::ZhCn.status("running hook"), "正在运行 Hook");
        assert_eq!(Locale::ZhTw.status("running hooks"), "正在執行多個 Hook");
        assert_eq!(Locale::EnUs.status("running hook"), "running hook");
        assert_eq!(Locale::JaJp.status("running hooks"), "複数の Hook を実行中");
        assert_eq!(Locale::KoKr.status("running hook"), "Hook 실행 중");
        assert_eq!(
            Locale::ZhCn.status("MCP startup issue: docs: offline"),
            "MCP 启动问题: docs: offline"
        );
        assert_eq!(
            Locale::ZhTw.status("MCP startup issues: 2"),
            "MCP 啟動問題: 2"
        );
        assert_eq!(
            Locale::JaJp.status("MCP startup issue: docs: offline"),
            "MCP 起動の問題: docs: offline"
        );
        assert_eq!(
            Locale::KoKr.status("MCP startup issue: docs: offline"),
            "MCP 시작 문제: docs: offline"
        );
        assert_eq!(Locale::ZhCn.detail("hook completed"), "Hook 已完成");
        assert_eq!(Locale::ZhTw.detail("hook failed"), "Hook 失敗");
        assert_eq!(Locale::EnUs.detail("hook blocked"), "hook blocked");
        assert_eq!(Locale::JaJp.detail("hook stopped"), "Hook 停止");
        assert_eq!(Locale::KoKr.detail("hook output: ok"), "Hook 출력: ok");
        assert_eq!(Locale::ZhCn.approval_option("Allow once"), "允许一次");
        assert_eq!(
            Locale::JaJp.approval_option("Cancel turn"),
            "ターンをキャンセル"
        );
    }

    #[test]
    fn collaboration_mode_statuses_cover_all_product_locales() {
        let cases = [
            (
                Locale::ZhCn,
                "协作模式已更新",
                "计划模式",
                "此服务器不支持计划模式",
            ),
            (
                Locale::ZhTw,
                "協作模式已更新",
                "計畫模式",
                "此伺服器不支援計畫模式",
            ),
            (
                Locale::EnUs,
                "collaboration mode updated",
                "plan mode",
                "plan mode unavailable on this server",
            ),
            (
                Locale::JaJp,
                "コラボレーションモードを更新しました",
                "計画モード",
                "このサーバーでは計画モードを利用できません",
            ),
            (
                Locale::KoKr,
                "협업 모드가 업데이트됨",
                "계획 모드",
                "이 서버에서는 계획 모드를 사용할 수 없음",
            ),
        ];

        for (locale, updated, plan, unavailable) in cases {
            assert_eq!(locale.status("collaboration mode updated"), updated);
            assert_eq!(locale.status("plan mode"), plan);
            assert_eq!(
                locale.status("plan mode unavailable on this server"),
                unavailable
            );
        }
    }

    #[test]
    fn plan_mode_footer_hints_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.plan_mode_label().is_empty());
            assert!(!locale.plan_mode_cycle_hint().is_empty());
        }
    }

    #[test]
    fn multi_agent_titles_cover_all_product_locales() {
        let cases = [
            (
                Locale::ZhCn,
                "已启动 agent-1",
                "等待完成",
                "已中断 `agent-1`",
            ),
            (
                Locale::ZhTw,
                "已啟動 agent-1",
                "等待完成",
                "已中斷 `agent-1`",
            ),
            (
                Locale::EnUs,
                "Spawned agent-1",
                "Finished waiting",
                "Interrupted `agent-1`",
            ),
            (
                Locale::JaJp,
                "起動: agent-1",
                "待機が完了しました",
                "中断: `agent-1`",
            ),
            (
                Locale::KoKr,
                "생성됨 agent-1",
                "대기 완료",
                "중단됨 `agent-1`",
            ),
        ];
        for (locale, spawned, waiting, interrupted) in cases {
            assert_eq!(locale.multi_agent("Spawned agent-1"), spawned);
            assert_eq!(locale.multi_agent("Finished waiting"), waiting);
            assert_eq!(locale.multi_agent("Interrupted `agent-1`"), interrupted);
        }
        assert_eq!(Locale::EnUs.multi_agent("unknown event"), "unknown event");
    }

    #[test]
    fn command_output_omission_markers_cover_all_product_locales() {
        let line_markers = [
            (Locale::ZhCn, "已省略 2 行"),
            (Locale::ZhTw, "已省略 2 行"),
            (Locale::EnUs, "2 lines omitted"),
            (Locale::JaJp, "2 行を省略"),
            (Locale::KoKr, "2줄 생략"),
        ];
        let byte_markers = [
            (Locale::ZhCn, "已省略 3 字节"),
            (Locale::ZhTw, "已省略 3 位元組"),
            (Locale::EnUs, "3 bytes omitted"),
            (Locale::JaJp, "3 バイトを省略"),
            (Locale::KoKr, "3바이트 생략"),
        ];

        for (locale, marker) in line_markers {
            assert!(locale.output_omitted_lines(2).contains(marker));
        }
        for (locale, marker) in byte_markers {
            assert!(locale.output_omitted_bytes(3).contains(marker));
        }
    }

    #[test]
    fn agents_overview_controls_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for label in [
                "Agent command center",
                "Search",
                "Needs input",
                "Show more",
                "Loading more…",
                "Show more (retry)",
            ] {
                assert!(!locale.agent_center_label(label).is_empty());
            }
        }
    }

    #[test]
    fn agents_overview_task_statuses_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.agent_center_label("New task").is_empty());
            assert!(!locale.agent_center_label("Rename").is_empty());
            assert!(!locale
                .status("background task started: thread-1")
                .is_empty());
            assert!(!locale.status("background task failed: offline").is_empty());
            assert!(!locale.status("agent renamed").is_empty());
            assert!(!locale
                .status("resume picker is available from /resume")
                .is_empty());
        }
    }

    #[test]
    fn image_clipboard_statuses_cover_all_product_locales() {
        let cases = [
            (
                Locale::ZhCn,
                "已附加图片: 20x10",
                "粘贴图片失败: unavailable",
            ),
            (
                Locale::ZhTw,
                "已附加圖片: 20x10",
                "貼上圖片失敗: unavailable",
            ),
            (
                Locale::EnUs,
                "image attached: 20x10",
                "image paste failed: unavailable",
            ),
            (
                Locale::JaJp,
                "画像を添付しました: 20x10",
                "画像の貼り付けに失敗しました: unavailable",
            ),
            (
                Locale::KoKr,
                "이미지 첨부됨: 20x10",
                "이미지 붙여넣기 실패: unavailable",
            ),
        ];

        for (locale, attached, failed) in cases {
            assert_eq!(locale.status("image attached: 20x10"), attached);
            assert_eq!(locale.status("image paste failed: unavailable"), failed);
        }
    }

    #[test]
    fn text_clipboard_statuses_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.status("clipboard is busy").is_empty());
            assert!(!locale
                .status("clipboard paste failed: unavailable")
                .is_empty());
        }
    }

    #[test]
    fn queue_unavailable_status_covers_all_product_locales() {
        let cases = [
            (
                Locale::ZhCn,
                "队列不可用: offline",
                "正在编辑排队输入",
                "排队输入已不可用",
                "编辑排队输入失败: offline",
                "编辑最后一条排队输入",
            ),
            (
                Locale::ZhTw,
                "佇列無法使用: offline",
                "正在編輯排隊輸入",
                "排隊輸入已無法使用",
                "編輯排隊輸入失敗: offline",
                "編輯最後一則排隊輸入",
            ),
            (
                Locale::EnUs,
                "queue unavailable: offline",
                "editing queued input",
                "queued input unavailable",
                "queue edit failed: offline",
                "edit last queued input",
            ),
            (
                Locale::JaJp,
                "キューを利用できません: offline",
                "キュー入力を編集中",
                "キュー入力を利用できません",
                "キュー入力の編集に失敗しました: offline",
                "最後のキュー入力を編集",
            ),
            (
                Locale::KoKr,
                "대기열을 사용할 수 없음: offline",
                "대기 입력 편집 중",
                "대기 입력을 사용할 수 없음",
                "대기 입력 편집 실패: offline",
                "마지막 대기 입력 편집",
            ),
        ];
        let shortcut = crate::keymap::queued_input_edit_shortcut_label();
        for (locale, unavailable, editing, input_unavailable, failed, hint) in cases {
            assert_eq!(locale.status("queue unavailable: offline"), unavailable);
            assert_eq!(locale.status("queued input editing"), editing);
            assert_eq!(locale.status("queued input unavailable"), input_unavailable);
            assert_eq!(locale.status("queue edit failed: offline"), failed);
            assert_eq!(
                locale.edit_queued_input_hint(&shortcut),
                format!("{shortcut} {hint}")
            );
        }
    }

    #[test]
    fn exposes_all_product_locale_tags() {
        let locales = [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ];
        assert_eq!(
            locales
                .iter()
                .map(|locale| locale.tag())
                .collect::<Vec<_>>(),
            vec!["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]
        );
    }

    #[test]
    fn slash_command_descriptions_cover_all_product_locales() {
        let cases = [
            (Locale::ZhCn, "选择模型"),
            (Locale::ZhTw, "選擇模型"),
            (Locale::EnUs, "choose a model"),
            (Locale::JaJp, "モデルを選択"),
            (Locale::KoKr, "모델 선택"),
        ];
        for (locale, expected) in cases {
            assert_eq!(
                locale.slash_command_description(SlashCommand::Model),
                expected
            );
            for command in SlashCommand::ALL {
                assert!(!locale.slash_command_description(command).is_empty());
            }
        }
    }

    #[test]
    fn raw_output_feedback_covers_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.raw_output_mode_message(true).is_empty());
            assert!(!locale.raw_output_mode_message(false).is_empty());
            assert!(!locale
                .slash_command_description(SlashCommand::Raw)
                .is_empty());
        }
    }

    #[test]
    fn transcript_follow_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for unseen_activity in [false, true] {
                let labels = locale.transcript_follow_labels(unseen_activity);
                assert!(labels.iter().all(|label| !label.is_empty()), "{locale:?}");
                assert_eq!(labels.last(), Some(&" ↓ "), "{locale:?}");
            }
        }
        assert_eq!(
            Locale::EnUs.transcript_follow_labels(false)[0],
            " ↓ Back to bottom · esc "
        );
        assert_eq!(
            Locale::EnUs.transcript_follow_labels(true)[0],
            " New activity · ↓ Back to bottom · esc "
        );
    }

    #[test]
    fn export_picker_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for label in [
                locale.export_title(),
                locale.export_subtitle(),
                locale.export_copy_label(),
                locale.export_copy_description(),
                locale.export_file_label(),
                locale.export_file_description(),
                locale.export_prompt_title(),
            ] {
                assert!(!label.is_empty(), "missing export label for {locale:?}");
            }
        }
    }

    #[test]
    fn mcp_approval_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for value in [
                "accept",
                "accept_session",
                "accept_always",
                "decline",
                "cancel",
            ] {
                assert!(
                    !locale.mcp_elicitation_approval_option(value).is_empty(),
                    "missing MCP approval label for {locale:?}/{value}"
                );
            }
        }
    }

    #[test]
    fn interactive_overlay_controls_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.approval_confirm_hint("enter").is_empty());
            assert!(!locale.approval_cancel_hint("esc").is_empty());
            assert!(!locale.request_submit_hint("enter").is_empty());
            assert!(!locale.request_cancel_hint("esc").is_empty());
            assert!(!locale.request_notes_hint("tab").is_empty());
            assert!(!locale.request_select_hint("↑", "↓").is_empty());
            assert!(!locale.request_question_nav_hint("←", "→").is_empty());
        }
    }

    #[test]
    fn working_directory_messages_cover_all_product_locales() {
        let cwd = "/tmp/project";
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let message = locale.current_working_directory_message(cwd);
            assert!(message.contains(cwd));
            assert!(!locale.pwd_usage().is_empty());
        }
    }

    #[test]
    fn file_search_popup_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.file_search_loading().is_empty());
            assert!(!locale.file_search_no_matches().is_empty());
        }
        assert_eq!(Locale::ZhCn.file_search_loading(), "正在搜索...");
        assert_eq!(Locale::EnUs.file_search_no_matches(), "no matches");
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.skill_popup_no_matches().is_empty());
        }
    }

    #[test]
    fn skill_warning_messages_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let summary = locale.skipped_skills_message(2);
            let detail = locale.skill_load_error_message("/tmp/SKILL.md", "invalid");
            assert!(summary.contains('2'));
            assert!(detail.contains("/tmp/SKILL.md"));
            assert!(detail.contains("invalid"));
        }
    }

    #[test]
    fn status_pager_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let transcript_pager_footer =
                locale.transcript_pager_footer("PgDn·Space·Ctrl+F", "F3·/", "Ctrl+T·Esc·Q");
            for label in [
                locale.status_title(),
                locale.transcript_title(),
                locale.thread_label(),
                locale.provider_label(),
                locale.cwd_label(),
                locale.state_label(),
                locale.not_set_label(),
                locale.history_search_label(),
                locale.pager_footer(),
                transcript_pager_footer.as_str(),
                locale.transcript_pager_loading(),
                locale.transcript_pager_retry_footer(),
                locale.transcript_search_label(),
                locale.transcript_search_prompt(),
                locale.transcript_search_searching(),
                locale.transcript_search_no_matches(),
                locale.transcript_search_matches(),
                locale.transcript_search_no_more_matches(),
                locale.transcript_search_hint(),
                locale.transcript_search_query_limited(),
                locale.transcript_selection_hint(),
            ] {
                assert!(!label.is_empty(), "{locale:?}");
            }
            assert!(locale
                .transcript_link_opened("https://example.com")
                .contains("https://"));
            assert!(locale
                .transcript_link_open_failed("offline")
                .contains("offline"));
            assert!(locale.transcript_copy_confirmed(5).contains('5'));
            assert!(!locale.transcript_copy_unconfirmed().is_empty());
            assert!(!locale.transcript_copy_failed().is_empty());
            assert_eq!(
                locale.status("copy confirmed: 5"),
                locale.transcript_copy_confirmed(5)
            );
            assert_eq!(
                locale.status("copy unconfirmed"),
                locale.transcript_copy_unconfirmed()
            );
        }
        assert_eq!(Locale::ZhCn.status_title(), "状态");
        assert_eq!(Locale::EnUs.transcript_title(), "T R A N S C R I P T");
        assert_eq!(Locale::ZhTw.state_label(), "狀態");
        assert_eq!(Locale::JaJp.not_set_label(), "未設定");
        assert!(Locale::KoKr.pager_footer().contains("Esc/Q"));
        assert!(Locale::ZhCn
            .transcript_pager_footer("PgDn·Space·Ctrl+F", "F3·/", "Ctrl+T·Esc·Q")
            .contains("Ctrl+T"));
        assert!(Locale::EnUs
            .transcript_pager_retry_footer()
            .contains("Home retry"));
    }

    #[test]
    fn transcript_activity_labels_are_stable_in_all_product_locales() {
        let cases = [
            (
                Locale::ZhCn,
                "正在探索",
                "已探索",
                "正在操作电脑",
                "已操作电脑",
                "读取",
                "电脑操作",
                "needle，位于 src",
                "（命令退出 2）",
                "2 个操作",
                "1 个失败",
                "已截图 · Capture",
                "失败：Submit — timed out",
            ),
            (
                Locale::ZhTw,
                "正在探索",
                "已探索",
                "正在操作電腦",
                "已操作電腦",
                "讀取",
                "電腦操作",
                "needle，位於 src",
                "（命令結束 2）",
                "2 個操作",
                "1 個失敗",
                "已擷取螢幕截圖 · Capture",
                "失敗：Submit — timed out",
            ),
            (
                Locale::EnUs,
                "Exploring",
                "Explored",
                "Using computer",
                "Used computer",
                "Read",
                "Computer action",
                "needle in src",
                "(command exit 2)",
                "2 actions",
                "1 failed",
                "Captured screenshot · Capture",
                "Failed: Submit — timed out",
            ),
            (
                Locale::JaJp,
                "探索中",
                "探索済み",
                "コンピュータを操作中",
                "コンピュータを操作しました",
                "読取",
                "コンピュータ操作",
                "src 内の needle",
                "（コマンド終了 2）",
                "2 件の操作",
                "1 件失敗",
                "スクリーンショット取得 · Capture",
                "失敗: Submit — timed out",
            ),
            (
                Locale::KoKr,
                "탐색 중",
                "탐색함",
                "컴퓨터 사용 중",
                "컴퓨터 사용함",
                "읽기",
                "컴퓨터 작업",
                "src에서 needle",
                "(명령 종료 2)",
                "작업 2개",
                "실패 1개",
                "스크린샷 캡처 · Capture",
                "실패: Submit — timed out",
            ),
        ];
        for (
            locale,
            exploring,
            explored,
            using_computer,
            used_computer,
            read,
            computer_action,
            search,
            exit,
            actions,
            failed,
            capture,
            failure,
        ) in cases
        {
            assert_eq!(locale.transcript_exploration_label(true), exploring);
            assert_eq!(locale.transcript_exploration_label(false), explored);
            assert_eq!(locale.transcript_computer_label(true), using_computer);
            assert_eq!(locale.transcript_computer_label(false), used_computer);
            assert_eq!(locale.transcript_activity_action_label("read"), read);
            assert_eq!(locale.transcript_computer_action_label(), computer_action);
            assert_eq!(
                locale.transcript_activity_search_target("needle", "src"),
                search
            );
            assert_eq!(locale.transcript_activity_exit(2, true), exit);
            assert_eq!(locale.transcript_activity_count(2), actions);
            assert_eq!(locale.transcript_activity_failed_count(1), failed);
            assert_eq!(locale.transcript_computer_capture("Capture"), capture);
            assert_eq!(
                locale.transcript_computer_failure("Submit", Some("timed out")),
                failure
            );
        }
    }

    #[test]
    fn mcp_inventory_labels_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.mcp_inventory_title().is_empty());
            assert!(!locale.mcp_no_servers().is_empty());
            assert!(!locale.mcp_usage().is_empty());
            assert!(!locale.mcp_login_requires_session().is_empty());
            assert!(!locale.mcp_login_in_progress("docs").is_empty());
            assert!(!locale.mcp_login_opened("docs").is_empty());
            assert!(!locale.mcp_login_open_failed("docs", "offline").is_empty());
            assert!(!locale.mcp_login_succeeded("docs").is_empty());
            assert!(!locale
                .mcp_login_failed_completion("docs", Some("offline"))
                .is_empty());
        }
        assert_eq!(
            Locale::EnUs.mcp_usage(),
            "Usage: /mcp [verbose | login <name>]"
        );
    }

    #[test]
    fn resume_picker_controls_cover_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(!locale.resume_picker_title(false).is_empty());
            assert!(!locale.resume_picker_title(true).is_empty());
            assert!(!locale.resume_action_label(false, false).is_empty());
            assert!(!locale.resume_action_label(true, false).is_empty());
            assert!(!locale.resume_action_label(false, true).is_empty());
            assert!(!locale.resume_cancel_label(false).is_empty());
            assert!(!locale.resume_cancel_label(true).is_empty());
            assert!(!locale.resume_focus_label().is_empty());
            assert!(!locale.resume_change_label().is_empty());
            assert!(!locale.resume_search_placeholder().is_empty());
            assert!(!locale.resume_loading().is_empty());
            assert!(!locale.resume_status_label(false).is_empty());
            assert!(!locale.resume_status_label(true).is_empty());
            assert!(!locale.resume_filter_label(false).is_empty());
            assert!(!locale.resume_filter_label(true).is_empty());
            assert!(!locale.resume_sort_label(false).is_empty());
            assert!(!locale.resume_sort_label(true).is_empty());
            assert!(!locale.resume_density_label(false).is_empty());
            assert!(!locale.resume_density_label(true).is_empty());
            assert!(!locale.resume_expand_label().is_empty());
            assert!(!locale.resume_transcript_label().is_empty());
            assert!(!locale.created_label().is_empty());
            assert!(!locale.updated_label().is_empty());
            assert!(!locale.resume_transcript_loading().is_empty());
            assert!(!locale.resume_transcript_failed().is_empty());
            assert!(!locale.resume_transcript_empty().is_empty());
        }
    }

    #[test]
    fn auto_resolution_countdown_covers_all_product_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            assert!(locale
                .auto_resolution_countdown("1m 00s")
                .contains("1m 00s"));
        }
        assert_eq!(
            Locale::EnUs.auto_resolution_countdown("59s"),
            "auto-resolves in 59s"
        );
    }
}
