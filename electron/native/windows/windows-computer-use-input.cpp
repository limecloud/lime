#include "windows-computer-use.h"
#include "windows-computer-use-input.h"

#include <chrono>

namespace computer_use {

struct InputMonitor::Hooks {
  static thread_local InputMonitor* monitor;

  static LRESULT CALLBACK mouse(int code, WPARAM wParam, LPARAM lParam) {
    if (code == HC_ACTION && monitor && lParam) {
      const auto* event = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
      if (!(event->flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED))) monitor->physicalInput();
    }
    return CallNextHookEx(nullptr, code, wParam, lParam);
  }

  static LRESULT CALLBACK keyboard(int code, WPARAM wParam, LPARAM lParam) {
    if (code == HC_ACTION && monitor && lParam) {
      const auto* event = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
      if (!(event->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED))) monitor->physicalInput();
    }
    return CallNextHookEx(nullptr, code, wParam, lParam);
  }
};

thread_local InputMonitor* InputMonitor::Hooks::monitor = nullptr;

InputMonitor::InputMonitor() {
  // The action/COM thread never services low-level hooks or blocks user input.
  std::promise<void> started;
  auto ready = started.get_future();
  thread_ = std::thread([this, started = std::move(started)]() mutable { run(std::move(started)); });
  ready.wait_for(std::chrono::seconds(2));
}

InputMonitor::~InputMonitor() {
  stopped_ = true;
  const auto id = threadId_.load();
  if (id) PostThreadMessageW(id, WM_QUIT, 0, 0);
  if (thread_.joinable()) thread_.join();
}

bool InputMonitor::ready() const {
  const auto heartbeat = heartbeat_.load();
  if (!ready_.load() || stopped_.load() || unhealthy_.load() || !heartbeat) return false;
  if (GetTickCount64() - heartbeat >= 2000) {
    // Do not revive old requests after a stalled message pump starts responding.
    // A fresh helper/session is required to restore intervention monitoring.
    unhealthy_ = true;
    return false;
  }
  return true;
}

uint64_t InputMonitor::epoch() const {
  // Exhaustion or loss of the monitor blocks all current and new input.
  return ready() ? epoch_.load() : UINT64_MAX;
}

void InputMonitor::physicalInput() {
  // The hook thread is the only writer; no callback performs I/O or allocation.
  const auto previous = epoch_.load();
  if (previous != UINT64_MAX) epoch_ = previous + 1;
}

void InputMonitor::run(std::promise<void> started) {
  MSG message{};
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  threadId_ = GetCurrentThreadId();
  Hooks::monitor = this;
  HHOOK mouse = SetWindowsHookExW(WH_MOUSE_LL, &Hooks::mouse, GetModuleHandleW(nullptr), 0);
  HHOOK keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, &Hooks::keyboard, GetModuleHandleW(nullptr), 0);
  const UINT_PTR timer = SetTimer(nullptr, 0, 250, nullptr);
  heartbeat_ = GetTickCount64();
  ready_ = mouse && keyboard && timer;
  started.set_value();
  if (ready_ && !stopped_) {
    while (!stopped_ && GetMessageW(&message, nullptr, 0, 0) > 0) {
      heartbeat_ = GetTickCount64();
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  ready_ = false;
  if (timer) KillTimer(nullptr, timer);
  if (mouse) UnhookWindowsHookEx(mouse);
  if (keyboard) UnhookWindowsHookEx(keyboard);
  Hooks::monitor = nullptr;
}

}  // namespace computer_use
