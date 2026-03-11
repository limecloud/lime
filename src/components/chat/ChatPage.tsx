/**
 * @file 通用对话页面
 * @description 旧版通用对话页面兼容包装层
 * @module components/chat/ChatPage
 */

import React, { memo } from "react";
import { GeneralChatPage } from "@/components/general-chat";

/**
 * 通用对话页面
 *
 * 该组件仅保留兼容入口职责，实际实现统一委托给
 * `components/general-chat/GeneralChatPage`，避免旧页面继续维护独立状态机。
 *
 * @deprecated 遗留通用聊天页面。禁止新增依赖，请优先使用现役聊天入口。
 */
export const ChatPage: React.FC = memo(() => <GeneralChatPage />);

ChatPage.displayName = "ChatPage";
