use super::Locale;
use crate::bottom_pane::status_line_setup::StatusLineItem;

impl Locale {
    fn status_line_copy(self, values: [&'static str; 5]) -> &'static str {
        values[match self {
            Self::ZhCn => 0,
            Self::ZhTw => 1,
            Self::EnUs => 2,
            Self::JaJp => 3,
            Self::KoKr => 4,
        }]
    }
    pub(crate) fn status_line_title(self) -> &'static str {
        self.status_line_copy([
            "配置状态栏",
            "設定狀態列",
            "Configure status line",
            "ステータス行の設定",
            "상태 표시줄 설정",
        ])
    }
    pub(crate) fn status_line_search_hint(self) -> &'static str {
        self.status_line_copy([
            "输入以搜索状态栏项目",
            "輸入以搜尋狀態列項目",
            "Type to search status line items",
            "入力して項目を検索",
            "입력하여 항목 검색",
        ])
    }
    pub(crate) fn status_line_colors_label(self) -> &'static str {
        self.status_line_copy([
            "使用主题颜色",
            "使用佈景主題色彩",
            "Use theme colors",
            "テーマの色を使用",
            "테마 색상 사용",
        ])
    }
    pub(crate) fn status_line_raw_label(self) -> &'static str {
        self.status_line_copy([
            "原始输出",
            "原始輸出",
            "Raw output",
            "生の出力",
            "원시 출력",
        ])
    }

    pub(crate) fn task_progress_value(self, completed: usize, total: usize) -> String {
        format!(
            "{} {completed}/{total}",
            self.status_line_copy(["任务", "任務", "Tasks", "タスク", "작업"])
        )
    }
    pub(crate) fn status_line_saved(self) -> &'static str {
        self.status_line_copy([
            "状态栏已保存",
            "狀態列已儲存",
            "Status line saved",
            "ステータス行を保存しました",
            "상태 표시줄을 저장했습니다",
        ])
    }
    pub(crate) fn status_line_save_failed(self, error: &str) -> String {
        format!(
            "{}: {error}",
            self.status_line_copy([
                "状态栏保存失败",
                "狀態列儲存失敗",
                "Could not save status line",
                "ステータス行の保存に失敗",
                "상태 표시줄 저장 실패"
            ])
        )
    }
    pub(crate) fn status_line_item_name(self, item: StatusLineItem) -> &'static str {
        match item {
            StatusLineItem::ModelName => self.model_label(),
            StatusLineItem::ModelWithReasoning => self.status_line_copy([
                "模型与推理强度",
                "模型與推理強度",
                "Model with reasoning",
                "モデルと推論強度",
                "모델과 추론 강도",
            ]),
            StatusLineItem::Reasoning => self.effort_label(),
            StatusLineItem::CurrentDir => self.cwd_label(),
            StatusLineItem::Status => self.state_label(),
            StatusLineItem::Permissions => self.permissions_label(),
            StatusLineItem::SessionId => self.thread_label(),
            StatusLineItem::ThreadName => self.status_line_copy([
                "线程名称",
                "執行緒名稱",
                "Thread name",
                "スレッド名",
                "스레드 이름",
            ]),
            StatusLineItem::RawOutput => self.status_line_raw_label(),
            StatusLineItem::TaskProgress => self.status_line_copy([
                "任务进度",
                "任務進度",
                "Task progress",
                "タスクの進捗",
                "작업 진행 상황",
            ]),
        }
    }
    pub(crate) fn status_line_item_description(self, item: StatusLineItem) -> &'static str {
        match item {
            StatusLineItem::ModelName => self.status_line_copy([
                "当前模型",
                "目前模型",
                "Current model",
                "現在のモデル",
                "현재 모델",
            ]),
            StatusLineItem::ModelWithReasoning => self.status_line_copy([
                "当前模型及推理强度",
                "目前模型及推理強度",
                "Current model and reasoning effort",
                "現在のモデルと推論強度",
                "현재 모델 및 추론 강도",
            ]),
            StatusLineItem::Reasoning => self.status_line_copy([
                "当前推理强度",
                "目前推理強度",
                "Current reasoning effort",
                "現在の推論強度",
                "현재 추론 강도",
            ]),
            StatusLineItem::CurrentDir => self.status_line_copy([
                "当前工作目录",
                "目前工作目錄",
                "Current working directory",
                "現在の作業ディレクトリ",
                "현재 작업 디렉터리",
            ]),
            StatusLineItem::Status => self.status_line_copy([
                "当前线程的运行状态",
                "目前執行緒的執行狀態",
                "Current thread activity",
                "現在のスレッドの実行状態",
                "현재 스레드 실행 상태",
            ]),
            StatusLineItem::Permissions => self.status_line_copy([
                "当前权限配置",
                "目前權限設定",
                "Current permission profile",
                "現在の権限プロファイル",
                "현재 권한 프로필",
            ]),
            StatusLineItem::SessionId => self.status_line_copy([
                "当前线程标识",
                "目前執行緒識別碼",
                "Current thread identifier",
                "現在のスレッド ID",
                "현재 스레드 식별자",
            ]),
            StatusLineItem::ThreadName => self.status_line_copy([
                "已设置的线程名称",
                "已設定的執行緒名稱",
                "Thread name when set",
                "設定済みのスレッド名",
                "설정된 스레드 이름",
            ]),
            StatusLineItem::RawOutput => self.status_line_copy([
                "启用时显示原始输出模式",
                "啟用時顯示原始輸出模式",
                "Raw output mode when enabled",
                "生の出力モードが有効な場合",
                "원시 출력 모드가 활성화된 경우",
            ]),
            StatusLineItem::TaskProgress => self.status_line_copy([
                "最近计划的完成数与总数",
                "最近計畫的完成數與總數",
                "Completed and total steps in the latest plan",
                "最新の計画の完了数と合計",
                "최근 계획의 완료 단계 및 총 단계",
            ]),
        }
    }
}
