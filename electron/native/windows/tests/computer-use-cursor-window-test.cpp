#include "../windows-computer-use-cursor-window.h"

#include <algorithm>
#include <cstdio>
#include <vector>

static int passed = 0, failed = 0;
static void check(bool result, const char* scenario) {
  if (result) ++passed;
  else { ++failed; std::fprintf(stderr, "FAIL scenario=%s error=%lu\n", scenario, GetLastError()); }
}

static BOOL CALLBACK collectWindow(HWND window, LPARAM context) {
  reinterpret_cast<std::vector<HWND>*>(context)->push_back(window);
  return TRUE;
}

// Read order through EnumWindows, independently of the product's predecessor
// lookup. No pixels, input events or third-party window names are collected.
static bool immediatelyAbove(HWND above, HWND below) {
  std::vector<HWND> windows;
  if (!EnumWindows(collectWindow, reinterpret_cast<LPARAM>(&windows))) return false;
  const auto a = std::find(windows.begin(), windows.end(), above);
  const auto b = std::find(windows.begin(), windows.end(), below);
  return a != windows.end() && b != windows.end() && a + 1 == b;
}

static bool above(HWND first, HWND second) {
  std::vector<HWND> windows;
  if (!EnumWindows(collectWindow, reinterpret_cast<LPARAM>(&windows))) return false;
  const auto a = std::find(windows.begin(), windows.end(), first);
  const auto b = std::find(windows.begin(), windows.end(), second);
  return a != windows.end() && b != windows.end() && a < b;
}

static bool topmost(HWND window) { return (GetWindowLongPtrW(window, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0; }

int main() {
  constexpr wchar_t name[] = L"LimeCursorOrderFixture";
  const HINSTANCE instance = GetModuleHandleW(nullptr);
  WNDCLASSEXW klass{};
  klass.cbSize = sizeof(klass);
  klass.hInstance = instance;
  klass.lpfnWndProc = DefWindowProcW;
  klass.lpszClassName = name;
  if (!RegisterClassExW(&klass)) return 1;
  const HWND foreground = GetForegroundWindow(), active = GetActiveWindow(), focus = GetFocus();
  std::vector<HWND> owned;
  const auto create = [&](DWORD extraStyle = 0) {
    HWND window = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | extraStyle, name, name, WS_POPUP,
        -30000, -30000, 32, 32, nullptr, nullptr, instance, nullptr);
    if (window) owned.push_back(window);
    return window;
  };
  const HWND lower = create(), target = create(), marker = create();
  const HWND cursor = create(WS_EX_LAYERED | WS_EX_TRANSPARENT), upper = create();
  if (!lower || !target || !marker || !cursor || !upper) {
    for (HWND window : owned) DestroyWindow(window);
    UnregisterClassW(name, instance);
    return 1;
  }
  EnableWindow(cursor, FALSE);
  constexpr UINT show = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
  SetWindowPos(lower, HWND_TOP, 0, 0, 0, 0, show);
  SetWindowPos(target, HWND_TOP, 0, 0, 0, 0, show);
  SetWindowPos(marker, HWND_TOP, 0, 0, 0, 0, show);
  SetWindowPos(upper, HWND_TOPMOST, 0, 0, 0, 0, show);

  check(computer_use::presentCursorWindow(cursor, target), "normal target presentation");
  check(immediatelyAbove(cursor, target), "normal cursor immediately above target");
  check(!topmost(cursor), "normal target never promotes cursor to topmost");
  check(above(marker, cursor) && above(upper, cursor), "higher normal and topmost windows stay above cursor");
  check(computer_use::presentCursorWindow(cursor, target) && immediatelyAbove(cursor, target) && above(marker, cursor), "repeated presentation preserves unrelated order");

  SetWindowPos(target, lower, 0, 0, 0, 0, show);
  check(computer_use::presentCursorWindow(cursor, target) && immediatelyAbove(cursor, target) && above(lower, cursor), "cursor follows target moved behind a different window");
  SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, show);
  SetWindowPos(upper, HWND_TOPMOST, 0, 0, 0, 0, show);
  check(computer_use::presentCursorWindow(cursor, target), "topmost target presentation");
  check(topmost(cursor) && immediatelyAbove(cursor, target) && above(upper, cursor), "topmost cursor follows target without covering higher topmost window");

  SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0, show);
  SetWindowPos(marker, HWND_TOP, 0, 0, 0, 0, show);
  check(computer_use::presentCursorWindow(cursor, target) && !topmost(cursor) && immediatelyAbove(cursor, target) && above(marker, cursor), "return to ordinary target demotes cursor");
  SetWindowPos(cursor, HWND_BOTTOM, 0, 0, 0, 0, show);
  SetWindowPos(target, HWND_TOP, 0, 0, 0, 0, show);
  check(computer_use::presentCursorWindow(cursor, target) && !topmost(cursor) && immediatelyAbove(cursor, target) && above(upper, cursor), "ordinary-band boundary does not inherit predecessor topmost flag");

  ShowWindow(cursor, SW_HIDE);
  ShowWindow(target, SW_HIDE);
  check(!computer_use::presentCursorWindow(cursor, target) && !IsWindowVisible(cursor), "hidden target cannot expose cursor");
  check(!computer_use::presentCursorWindow(cursor, nullptr) && !computer_use::presentCursorWindow(nullptr, target) &&
      !computer_use::presentCursorWindow(cursor, cursor), "invalid handles and self-target rejected");
  const HWND minimized = create();
  ShowWindow(minimized, SW_SHOWMINNOACTIVE);
  check(minimized && IsIconic(minimized) && !computer_use::presentCursorWindow(cursor, minimized), "minimized target rejected");
  const HWND removed = create();
  if (removed) { DestroyWindow(removed); owned.pop_back(); }
  check(removed && !computer_use::presentCursorWindow(cursor, removed) && !IsWindowVisible(cursor), "destroyed target cannot expose cursor");
  check(!IsWindowEnabled(cursor), "cursor remains disabled for native hit testing");
  check(GetForegroundWindow() == foreground && GetActiveWindow() == active && GetFocus() == focus, "no foreground activation or focus transfer");

  for (HWND window : owned) DestroyWindow(window);
  UnregisterClassW(name, instance);
  std::printf("{\"passed\":%d,\"failed\":%d,\"win32WindowOrder\":true}\n", passed, failed);
  return failed ? 1 : 0;
}
