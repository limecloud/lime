import { createRoot } from "react-dom/client";
import { BrowserAnnotationEditor } from "@/components/agent/chat/workspace/right-surface/browser/BrowserAnnotationEditor";
import type { BrowserAnnotationEditorBridge } from "@/lib/api/browserAnnotationEditorTypes";
import "./index.css";

const bridge = (
  window as Window & {
    browserAnnotationEditor?: BrowserAnnotationEditorBridge;
  }
).browserAnnotationEditor;
const element = document.getElementById("root");
if (element && bridge)
  createRoot(element).render(<BrowserAnnotationEditor bridge={bridge} />);
