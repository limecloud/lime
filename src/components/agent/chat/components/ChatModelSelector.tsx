import React from "react";
import { ModelSelector, type ModelSelectorProps } from "@/components/input-kit";

export type ChatModelSelectorProps = ModelSelectorProps;

export const ChatModelSelector: React.FC<ChatModelSelectorProps> = (props) => {
  return <ModelSelector {...props} />;
};
