import { createContext, useContext } from "react";
import type { InputbarSendHandler } from "../../../components/Inputbar/inputbarSendPayload";

export interface BrowserAnnotationRuntime {
  sessionId: string;
  threadId: string;
  send: InputbarSendHandler;
  isSending: boolean;
  workspaceId: string | null;
}

export const BrowserAnnotationContext =
  createContext<BrowserAnnotationRuntime | null>(null);
export const useBrowserAnnotationRuntime = () =>
  useContext(BrowserAnnotationContext);
