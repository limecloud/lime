/* eslint-disable @typescript-eslint/no-unused-vars */
/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_OEM_CLOUD_BASE_URL?: string;
  readonly VITE_OEM_GATEWAY_BASE_URL?: string;
  readonly VITE_OEM_HUB_PROVIDER_NAME?: string;
  readonly VITE_OEM_TENANT_ID?: string;
  readonly VITE_OEM_SESSION_TOKEN?: string;
  readonly VITE_OEM_CLOUD_ENABLED?: string;
  readonly VITE_OEM_USER_CENTER_LOGIN_PATH?: string;
  readonly VITE_OEM_DESKTOP_CLIENT_ID?: string;
  readonly VITE_OEM_DESKTOP_OAUTH_REDIRECT_URL?: string;
  readonly VITE_OEM_DESKTOP_OAUTH_NEXT_PATH?: string;
}

// SVG 模块声明 - 支持 ?react 后缀导入为 React 组件
declare module "*.svg?react" {
  import * as React from "react";
  const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;
  export default ReactComponent;
}

// 全局类型声明
declare global {
  type NotificationPermission = "default" | "denied" | "granted";

  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export {};
