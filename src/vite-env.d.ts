/* eslint-disable @typescript-eslint/no-unused-vars */
/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_LIMECORE_ORIGIN?: string;
}

// SVG 模块声明 - 支持 ?react 后缀导入为 React 组件
declare module "*.svg?react" {
  import * as React from "react";
  const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;
  export default ReactComponent;
}

declare module "react-syntax-highlighter/dist/esm/prism" {
  export { Prism as default } from "react-syntax-highlighter";
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export * from "react-syntax-highlighter/dist/cjs/styles/prism";
}

// 全局类型声明
declare global {
  type NotificationPermission = "default" | "denied" | "granted";

  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export {};
