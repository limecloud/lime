//! Localized command-center labels; shortcut keys come from the resolved keymap, not copy.

use super::Locale;

impl Locale {
    pub(crate) fn agent_center_label(self, label: &'static str) -> &'static str {
        let labels = match label {
            "Agent command center" => [
                "Agent 控制中心",
                "Agent 控制中心",
                "Agent コマンドセンター",
                "에이전트 명령 센터",
            ],
            "Group" => ["分组", "分組", "グループ", "그룹"],
            "Project" => ["项目", "專案", "プロジェクト", "프로젝트"],
            "Status" => ["状态", "狀態", "状態", "상태"],
            "All" => ["全部", "全部", "すべて", "전체"],
            "Needs you" => ["需要你", "需要你", "対応待ち", "응답 필요"],
            "Needs input" => ["需要输入", "需要輸入", "入力待ち", "입력 필요"],
            "Working" => ["运行中", "執行中", "実行中", "작업 중"],
            "Ready" => ["就绪", "就緒", "準備完了", "준비됨"],
            "Inactive" => ["未活动", "未活動", "非アクティブ", "비활성"],
            "Error" => ["错误", "錯誤", "エラー", "오류"],
            "Tasks" => ["任务", "工作", "タスク", "작업"],
            "New" => ["新建", "新建", "新規", "새 작업"],
            "Open" => ["打开", "開啟", "開く", "열기"],
            "Filter" => ["筛选", "篩選", "絞り込み", "필터"],
            "Updated" => ["更新于", "更新於", "更新", "업데이트"],
            "New task" => ["新建任务", "新建工作", "新しいタスク", "새 작업"],
            "Rename" => ["改名", "改名", "名前変更", "이름 변경"],
            "Search" => ["搜索", "搜尋", "検索", "검색"],
            "Show more" => ["显示更多", "顯示更多", "さらに表示", "더 보기"],
            "Loading task…" => [
                "正在加载任务…",
                "正在載入工作…",
                "タスクを読み込み中…",
                "작업 불러오는 중…",
            ],
            "Loading more…" => [
                "正在加载更多…",
                "正在載入更多…",
                "さらに読み込み中…",
                "더 불러오는 중…",
            ],
            "Show more (retry)" => [
                "显示更多（重试）",
                "顯示更多（重試）",
                "さらに表示（再試行）",
                "더 보기 (재시도)",
            ],
            "No tasks yet" => [
                "还没有任务",
                "尚無工作",
                "タスクはまだありません",
                "아직 작업이 없습니다",
            ],
            "No matching tasks" => [
                "没有匹配的任务",
                "沒有符合的工作",
                "一致するタスクはありません",
                "일치하는 작업이 없습니다",
            ],
            "Untitled task" => ["未命名任务", "未命名工作", "無題のタスク", "제목 없는 작업"],
            "Task details" => ["任务详情", "工作詳情", "タスク詳細", "작업 세부 정보"],
            "Branch" => ["分支", "分支", "ブランチ", "브랜치"],
            "Prompt" => ["提示词", "提示詞", "プロンプト", "프롬프트"],
            "No prompt available." => [
                "没有可用的提示词。",
                "沒有可用的提示詞。",
                "プロンプトはありません。",
                "사용 가능한 프롬프트가 없습니다.",
            ],
            "Task shortcuts" => [
                "任务快捷键",
                "工作快捷鍵",
                "タスクのショートカット",
                "작업 단축키",
            ],
            "Navigate" => ["导航", "導覽", "ナビゲーション", "탐색"],
            "View" => ["视图", "檢視", "表示", "보기"],
            "Up" => ["上移", "上移", "上へ", "위로"],
            "Down" => ["下移", "下移", "下へ", "아래로"],
            "Page up" => ["上一页", "上一頁", "前のページ", "이전 페이지"],
            "Page down" => ["下一页", "下一頁", "次のページ", "다음 페이지"],
            "Resume" => ["恢复", "繼續", "再開", "재개"],
            "Stop" => ["停止", "停止", "停止", "중지"],
            "Quit" => ["退出", "結束", "終了", "종료"],
            "help" => ["帮助", "說明", "ヘルプ", "도움말"],
            "back" => ["返回", "返回", "戻る", "뒤로"],
            "move" => ["移动", "移動", "移動", "이동"],
            "open" => ["打开", "開啟", "開く", "열기"],
            "new" => ["新建", "新建", "新規", "새 작업"],
            "rename" => ["改名", "改名", "名前変更", "이름 변경"],
            "confirm" => ["确认", "確認", "確認", "확인"],
            "filter" => ["筛选", "篩選", "絞り込み", "필터"],
            "… resize to see all" => [
                "… 调整窗口以查看全部",
                "… 調整視窗以檢視全部",
                "… サイズを変更してすべて表示",
                "… 크기를 조정하여 모두 보기",
            ],
            _ => return label,
        };
        match self {
            Self::ZhCn => labels[0],
            Self::ZhTw => labels[1],
            Self::EnUs => label,
            Self::JaJp => labels[2],
            Self::KoKr => labels[3],
        }
    }

    pub(crate) fn agent_center_count(self, count: usize, total: usize) -> String {
        if count == total {
            return count.to_string();
        }
        match self {
            Self::EnUs => format!("{count} of {total}"),
            _ => format!("{count}/{total}"),
        }
    }

    pub(crate) fn agent_center_age(self, reference: i64, updated: i64) -> String {
        let seconds = reference.saturating_sub(updated).max(0);
        if seconds == 0 {
            return match self {
                Self::ZhCn => "刚刚",
                Self::ZhTw => "剛剛",
                Self::EnUs => "now",
                Self::JaJp => "今",
                Self::KoKr => "지금",
            }
            .to_string();
        }
        let (value, unit) = if seconds < 60 {
            (seconds, 0)
        } else if seconds < 3600 {
            (seconds / 60, 1)
        } else if seconds < 86400 {
            (seconds / 3600, 2)
        } else {
            (seconds / 86400, 3)
        };
        let unit = match self {
            Self::ZhCn => ["秒", "分", "小时", "天"][unit],
            Self::ZhTw => ["秒", "分", "小時", "天"][unit],
            Self::EnUs => ["s", "m", "h", "d"][unit],
            Self::JaJp => ["秒", "分", "時間", "日"][unit],
            Self::KoKr => ["초", "분", "시간", "일"][unit],
        };
        match self {
            Self::ZhCn | Self::ZhTw => format!("{value}{unit}前"),
            Self::EnUs => format!("{value}{unit} ago"),
            Self::JaJp => format!("{value}{unit}前"),
            Self::KoKr => format!("{value}{unit} 전"),
        }
    }
}
