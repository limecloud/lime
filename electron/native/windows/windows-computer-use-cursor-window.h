#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace computer_use {

inline bool cursorWindowTopmost(HWND window, bool& topmost) {
  SetLastError(ERROR_SUCCESS);
  const LONG_PTR style = GetWindowLongPtrW(window, GWL_EXSTYLE);
  if (!style && GetLastError() != ERROR_SUCCESS) return false;
  topmost = (style & WS_EX_TOPMOST) != 0;
  return true;
}

// Windows adaptation of target-relative presentation. Only the indicator is
// reordered; the target, its owner and the foreground window are never raised.
inline bool presentCursorWindow(HWND cursor, HWND target) {
  if (!cursor || !target || cursor == target || !IsWindow(cursor) ||
      !IsWindow(target) || GetAncestor(target, GA_ROOT) != target ||
      !IsWindowVisible(target) || IsIconic(target)) return false;
  bool targetTopmost = false, cursorTopmost = false;
  if (!cursorWindowTopmost(target, targetTopmost) ||
      !cursorWindowTopmost(cursor, cursorTopmost)) return false;
  constexpr UINT flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
  if (cursorTopmost != targetTopmost &&
      !SetWindowPos(cursor, targetTopmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, flags)) return false;

  HWND after = GetWindow(target, GW_HWNDPREV);
  UINT showFlags = flags | SWP_SHOWWINDOW;
  if (after == cursor) {
    showFlags |= SWP_NOZORDER;
  } else if (!after) {
    after = HWND_TOP;
  } else if (!targetTopmost) {
    bool previousTopmost = false;
    if (!cursorWindowTopmost(after, previousTopmost)) return false;
    // Inserting after a topmost HWND would promote a regular window. HWND_TOP
    // instead keeps it at the head of its existing non-topmost band.
    if (previousTopmost) after = HWND_TOP;
  }
  if (!SetWindowPos(cursor, after, 0, 0, 0, 0, showFlags)) return false;
  bool actualTargetTopmost = false, actualCursorTopmost = false;
  return IsWindowVisible(cursor) && GetWindow(target, GW_HWNDPREV) == cursor &&
      cursorWindowTopmost(target, actualTargetTopmost) &&
      cursorWindowTopmost(cursor, actualCursorTopmost) &&
      actualTargetTopmost == targetTopmost && actualCursorTopmost == targetTopmost;
}

}  // namespace computer_use
