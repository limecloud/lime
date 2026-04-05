import React from "react";
import {
  Lightbulb,
  Globe,
  Workflow,
} from "lucide-react";
import { ToolButton } from "../styles";
import { isGeneralResearchTheme } from "../../../utils/generalAgentPrompt";

interface InputbarToolsProps {
  onToolClick: (tool: string) => void;
  activeTools: Record<string, boolean>;
  toolMode?: "default" | "attach-only";
  activeTheme?: string;
}

export const InputbarTools: React.FC<InputbarToolsProps> = ({
  onToolClick,
  activeTools,
  toolMode = "default",
  activeTheme,
}) => {
  const isGeneralTheme = isGeneralResearchTheme(activeTheme);

  return (
    <div className="flex items-center flex-wrap gap-2">
      {toolMode === "default" ? (
        <>
          <ToolButton
            type="button"
            onClick={() => onToolClick("thinking")}
            className={activeTools["thinking"] ? "active" : ""}
            aria-pressed={activeTools["thinking"]}
            title={`深度思考${activeTools["thinking"] ? "已开启" : "已关闭"}`}
          >
            <Lightbulb />
            <span>思考</span>
          </ToolButton>

          <ToolButton
            type="button"
            onClick={() => onToolClick("web_search")}
            className={activeTools["web_search"] ? "active" : ""}
            aria-pressed={activeTools["web_search"]}
            title={`联网搜索${activeTools["web_search"] ? "已开启" : "已关闭"}`}
          >
            <Globe />
            <span>搜索</span>
          </ToolButton>

          {isGeneralTheme ? (
            <>
              <ToolButton
                type="button"
                onClick={() => onToolClick("subagent_mode")}
                className={activeTools["subagent_mode"] ? "active" : ""}
                aria-pressed={activeTools["subagent_mode"]}
                title={`多代理偏好${activeTools["subagent_mode"] ? "已开启" : "已关闭"}`}
              >
                <Workflow />
                <span>多代理</span>
              </ToolButton>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
