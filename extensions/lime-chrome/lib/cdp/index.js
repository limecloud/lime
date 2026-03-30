/**
 * CDP channel — Chrome DevTools Protocol relay infrastructure.
 *
 *   relay/              — WebSocket connection & state machine
 *   tabs/               — Tab lifecycle, discovery, idle detection, tab groups
 *   commands/           — CDP command routing & Target.* handlers
 *   events/             — CDP event interception (dialogs, security, page lifecycle)
 */

export { TabManager } from './tabs/manager.js'
export { createDispatcher } from './commands/dispatch.js'
export {
  initRelay,
  trySendToRelay,
  isRelayConnected,
  isRelayActive,
  isRelayEnabled,
  isReconnecting,
  getRelayState,
  toggle,
  disconnect,
  connectAndAttach,
  initFromStorage,
  setRelayEnabled,
  getLogBuffer,
  ensureKeepAliveAlarm,
  handleConnectionAlarm,
} from './relay/connection.js'
