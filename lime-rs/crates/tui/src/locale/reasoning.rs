//! Reasoning shortcut feedback is localized; model and effort identities are catalog facts.

use super::Locale;
use crate::model_catalog::ReasoningShortcutDirection;

impl Locale {
    pub(crate) fn reasoning_startup_message(self) -> &'static str {
        match self {
            Self::ZhCn => "启动完成前无法使用推理强度快捷键。",
            Self::ZhTw => "啟動完成前無法使用推理強度快捷鍵。",
            Self::EnUs => "Reasoning shortcuts are disabled until startup completes.",
            Self::JaJp => "起動が完了するまで推論レベルのショートカットは使用できません。",
            Self::KoKr => "시작이 완료될 때까지 추론 수준 단축키를 사용할 수 없습니다.",
        }
    }

    pub(crate) fn reasoning_parent_owned_message(self) -> &'static str {
        match self {
            Self::ZhCn => "子代理线程由父代理控制，无法直接更改推理强度。",
            Self::ZhTw => "子代理執行緒由父代理控制，無法直接變更推理強度。",
            Self::EnUs => "Sub-agent thread is parent-owned; reasoning cannot be changed directly.",
            Self::JaJp => "サブエージェントのスレッドは親が管理しているため、推論レベルを直接変更できません。",
            Self::KoKr => "하위 에이전트 스레드는 상위 에이전트가 관리하므로 추론 수준을 직접 변경할 수 없습니다.",
        }
    }

    pub(crate) fn reasoning_plan_message(self) -> &'static str {
        match self {
            Self::ZhCn => "服务端尚不支持仅修改计划模式的推理强度；请先切回默认模式。",
            Self::ZhTw => "伺服器尚不支援僅變更計畫模式的推理強度；請先切回預設模式。",
            Self::EnUs => "Plan-only reasoning changes are not supported by the server; switch to Default mode first.",
            Self::JaJp => "サーバーはプランモードのみの推論変更に未対応です。先にデフォルトモードに切り替えてください。",
            Self::KoKr => "서버가 계획 모드 전용 추론 변경을 지원하지 않습니다. 먼저 기본 모드로 전환하세요.",
        }
    }

    pub(crate) fn reasoning_unavailable_message(self, model: &str) -> String {
        match self {
            Self::ZhCn => format!("模型 {model} 的推理强度快捷键不可用。"),
            Self::ZhTw => format!("模型 {model} 的推理強度快捷鍵無法使用。"),
            Self::EnUs => format!("Reasoning shortcuts are unavailable for {model}."),
            Self::JaJp => format!("{model} では推論レベルのショートカットを使用できません。"),
            Self::KoKr => format!("{model}에서 추론 수준 단축키를 사용할 수 없습니다."),
        }
    }

    pub(crate) fn reasoning_boundary_message(
        self,
        direction: ReasoningShortcutDirection,
        effort: &str,
    ) -> String {
        let effort = self.reasoning_effort_label(effort);
        match (self, direction) {
            (Self::ZhCn, ReasoningShortcutDirection::Lower) => {
                format!("推理强度已处于最低档位（{effort}）。")
            }
            (Self::ZhCn, ReasoningShortcutDirection::Raise) => {
                format!("推理强度已处于最高档位（{effort}）。")
            }
            (Self::ZhTw, ReasoningShortcutDirection::Lower) => {
                format!("推理強度已處於最低檔位（{effort}）。")
            }
            (Self::ZhTw, ReasoningShortcutDirection::Raise) => {
                format!("推理強度已處於最高檔位（{effort}）。")
            }
            (Self::EnUs, ReasoningShortcutDirection::Lower) => {
                format!("Reasoning is already at the lowest level ({effort}).")
            }
            (Self::EnUs, ReasoningShortcutDirection::Raise) => {
                format!("Reasoning is already at the highest level ({effort}).")
            }
            (Self::JaJp, ReasoningShortcutDirection::Lower) => {
                format!("推論レベルはすでに最低です（{effort}）。")
            }
            (Self::JaJp, ReasoningShortcutDirection::Raise) => {
                format!("推論レベルはすでに最高です（{effort}）。")
            }
            (Self::KoKr, ReasoningShortcutDirection::Lower) => {
                format!("이미 가장 낮은 추론 수준입니다({effort}).")
            }
            (Self::KoKr, ReasoningShortcutDirection::Raise) => {
                format!("이미 가장 높은 추론 수준입니다({effort}).")
            }
        }
    }

    pub(crate) fn reasoning_ultra_message(self, model: &str) -> String {
        let path = format!("/model → {model} → {}", self.more_reasoning_label());
        match self {
            Self::ZhCn => format!("请在 {path} 中明确选择超强推理。"),
            Self::ZhTw => format!("請在 {path} 中明確選擇超強推理。"),
            Self::EnUs => format!("Ultra is available under {path}"),
            Self::JaJp => format!("超高推論は {path} で明示的に選択してください。"),
            Self::KoKr => format!("울트라 추론은 {path}에서 명시적으로 선택하세요."),
        }
    }

    pub(crate) fn reasoning_updated_message(self, effort: &str) -> String {
        let effort = self.reasoning_effort_label(effort);
        match self {
            Self::ZhCn => format!("推理强度：{effort}"),
            Self::ZhTw => format!("推理強度：{effort}"),
            Self::EnUs => format!("Reasoning: {effort}"),
            Self::JaJp => format!("推論レベル：{effort}"),
            Self::KoKr => format!("추론 수준: {effort}"),
        }
    }
}
