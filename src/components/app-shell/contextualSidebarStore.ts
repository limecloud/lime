import type { ReactNode } from "react";

export interface ContextualSidebarState {
  owner: string | null;
  node: ReactNode | null;
}

let state: ContextualSidebarState = { owner: null, node: null };
let outletCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeContextualSidebar(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getContextualSidebarState() {
  return state;
}

export function getContextualSidebarOutletMounted() {
  return outletCount > 0;
}

export function publishContextualSidebar(owner: string, node: ReactNode) {
  state = { owner, node };
  emit();
}

export function clearContextualSidebar(owner: string) {
  if (state.owner !== owner) {
    return;
  }
  state = { owner: null, node: null };
  emit();
}

export function mountContextualSidebarOutlet() {
  outletCount += 1;
  emit();
}

export function unmountContextualSidebarOutlet() {
  outletCount = Math.max(0, outletCount - 1);
  emit();
}
