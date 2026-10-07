use super::Locale;
use crate::bottom_pane::title_setup::TerminalTitleItem;

impl Locale {
    fn title_copy(self, values: [&'static str; 5]) -> &'static str {
        values[match self {
            Self::ZhCn => 0,
            Self::ZhTw => 1,
            Self::EnUs => 2,
            Self::JaJp => 3,
            Self::KoKr => 4,
        }]
    }
    pub(crate) fn terminal_title_setup_title(self) -> &'static str {
        self.title_copy([
            "配置终端标题",
            "設定終端標題",
            "Configure terminal title",
            "ターミナルタイトルの設定",
            "터미널 제목 설정",
        ])
    }
    pub(crate) fn terminal_title_search_hint(self) -> &'static str {
        self.title_copy([
            "输入以搜索标题项目",
            "輸入以搜尋標題項目",
            "Type to search title items",
            "入力してタイトル項目を検索",
            "입력하여 제목 항목 검색",
        ])
    }
    pub(crate) fn terminal_title_saved(self) -> &'static str {
        self.title_copy([
            "终端标题已保存",
            "終端標題已儲存",
            "Terminal title saved",
            "ターミナルタイトルを保存しました",
            "터미널 제목을 저장했습니다",
        ])
    }
    pub(crate) fn terminal_title_save_failed(self, error: &str) -> String {
        format!(
            "{}: {error}",
            self.title_copy([
                "终端标题保存失败",
                "終端標題儲存失敗",
                "Could not save terminal title",
                "ターミナルタイトルの保存に失敗",
                "터미널 제목 저장 실패"
            ])
        )
    }
    pub(crate) fn terminal_title_item_name(self, item: TerminalTitleItem) -> &'static str {
        if let Some(item) = item.status_item() {
            return self.status_line_item_name(item);
        }
        match item {
            TerminalTitleItem::AppName => self.title_copy([
                "应用名称",
                "應用程式名稱",
                "App name",
                "アプリ名",
                "앱 이름",
            ]),
            TerminalTitleItem::Project => self.title_copy([
                "项目名称",
                "專案名稱",
                "Project name",
                "プロジェクト名",
                "프로젝트 이름",
            ]),
            TerminalTitleItem::Spinner => self.title_copy([
                "活动指示",
                "活動指示",
                "Activity",
                "アクティビティ",
                "활동 표시",
            ]),
            TerminalTitleItem::Thread => self.title_copy([
                "线程标题",
                "執行緒標題",
                "Thread title",
                "スレッドタイトル",
                "스레드 제목",
            ]),
            _ => unreachable!("status item names delegate to shared labels"),
        }
    }
    pub(crate) fn terminal_title_item_description(self, item: TerminalTitleItem) -> &'static str {
        if let Some(item) = item.status_item() {
            return self.status_line_item_description(item);
        }
        match item {
            TerminalTitleItem::AppName => self.title_copy([
                "当前应用名称",
                "目前應用程式名稱",
                "Application name",
                "アプリケーション名",
                "애플리케이션 이름",
            ]),
            TerminalTitleItem::Project => self.title_copy([
                "当前工作目录的名称",
                "目前工作目錄的名稱",
                "Current working directory name",
                "現在の作業ディレクトリ名",
                "현재 작업 디렉터리 이름",
            ]),
            TerminalTitleItem::Spinner => self.title_copy([
                "运行时显示转动指示，等待操作时显示提醒",
                "執行時顯示活動指示，等待操作時顯示提醒",
                "Spinner while working, action required while blocked",
                "実行中はスピナー、操作待ちは通知",
                "실행 중 활동 표시, 작업 대기 중 알림",
            ]),
            TerminalTitleItem::Thread => self.title_copy([
                "线程名称，未命名时使用线程标识",
                "執行緒名稱，未命名時使用執行緒識別碼",
                "Thread name, or identifier when unnamed",
                "スレッド名、未設定時は ID",
                "스레드 이름, 없으면 식별자",
            ]),
            _ => unreachable!("status item descriptions delegate to shared labels"),
        }
    }
}
