#include "windows-computer-use.h"
#include <UIAutomation.h>
#include <algorithm>
#include <chrono>
#include <thread>

namespace computer_use {
namespace {

INPUT keyInput(WORD key, DWORD flags = 0, WORD unicode = 0) {
  INPUT input{};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = key;
  input.ki.wScan = unicode;
  input.ki.dwFlags = flags;
  return input;
}

INPUT mouseInput(DWORD flags, DWORD data = 0) {
  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = flags;
  input.mi.mouseData = data;
  return input;
}

// Track only keys/buttons this action may press. Releases bypass target/focus
// checks so cancellation or a newly opened dialog cannot leave input held.
class Input {
 public:
  ~Input() { release(); }
  void hold(INPUT up) { releases_.push_back(up); }
  void clear() { releases_.clear(); }
  void release() {
    if (!releases_.empty()) {
      std::reverse(releases_.begin(), releases_.end());
      SendInput(static_cast<UINT>(releases_.size()), releases_.data(), sizeof(INPUT));
      releases_.clear();
    }
  }
  void send(std::vector<INPUT> events) {
    if (SendInput(static_cast<UINT>(events.size()), events.data(), sizeof(INPUT)) != events.size())
      throw Error("operation_failed", "Windows input was only partially submitted; outcome may be unknown.");
  }
 private:
  std::vector<INPUT> releases_;
};

void freeKey(WORD key) {
  if (GetAsyncKeyState(key) & 0x8000)
    throw Error("not_granted", "A physical key or mouse button is already held.");
}

POINT point(const Target& target, const Json& operation, const char* x, const char* y) {
  const double px = operation.get(x).number();
  const double py = operation.get(y).number();
  if (px < 0 || py < 0 || px >= target.frame.right - target.frame.left || py >= target.frame.bottom - target.frame.top)
    throw Error("invalid_argument", "Input coordinates must be inside the approved window.");
  return {target.frame.left + static_cast<LONG>(px), target.frame.top + static_cast<LONG>(py)};
}

void hit(const Target& target, POINT position) {
  if (GetAncestor(WindowFromPoint(position), GA_ROOT) != target.window)
    throw Error("not_granted", "The approved window is not under the input point.");
}

INPUT move(POINT position) {
  const int left = GetSystemMetrics(SM_XVIRTUALSCREEN), top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN), height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (width < 2 || height < 2 || position.x < left || position.y < top ||
      position.x >= int64_t(left) + width || position.y >= int64_t(top) + height)
    throw Error("not_granted", "Pointer position is outside the current virtual desktop.");
  INPUT input = mouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);
  input.mi.dx = static_cast<LONG>(std::llround(double(position.x - left) * 65535.0 / (width - 1)));
  input.mi.dy = static_cast<LONG>(std::llround(double(position.y - top) * 65535.0 / (height - 1)));
  return input;
}

void keyboardTarget(const Target& target) {
  GUITHREADINFO info{};
  info.cbSize = sizeof(info);
  if (!GetGUIThreadInfo(GetWindowThreadProcessId(target.window, nullptr), &info) ||
      !info.hwndFocus || GetAncestor(info.hwndFocus, GA_ROOT) != target.window)
    throw Error("not_granted", "Keyboard focus no longer belongs to the approved window.");
  Com<IUIAutomation> automation;
  Com<IUIAutomationElement> focused;
  BOOL password = TRUE;
  int processId = 0;
  if (FAILED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(automation.put()))) ||
      FAILED(automation->GetFocusedElement(focused.put())) || !focused.value ||
      FAILED(focused->get_CurrentProcessId(&processId)) || DWORD(processId) != target.app->pid ||
      FAILED(focused->get_CurrentIsPassword(&password)) || password)
    throw Error("not_granted", "Protected or unavailable keyboard focus cannot receive computer input.");
}

WORD keyCode(std::string name) {
  std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return char(std::tolower(c)); });
  const std::map<std::string, WORD> keys = {
    {"enter", VK_RETURN}, {"tab", VK_TAB}, {"space", VK_SPACE}, {"backspace", VK_BACK},
    {"escape", VK_ESCAPE}, {"delete", VK_DELETE}, {"home", VK_HOME}, {"end", VK_END},
    {"pageup", VK_PRIOR}, {"pagedown", VK_NEXT}, {"left", VK_LEFT}, {"right", VK_RIGHT},
    {"up", VK_UP}, {"down", VK_DOWN}, {"insert", VK_INSERT},
  };
  const auto found = keys.find(name);
  if (found != keys.end()) return found->second;
  if (name.size() == 1 && name[0] >= 'a' && name[0] <= 'z') return WORD(name[0] - 'a' + 'A');
  if (name.size() == 1 && name[0] >= '0' && name[0] <= '9') return WORD(name[0]);
  if (name.size() == 1) {
    const SHORT key = VkKeyScanW(wchar_t(static_cast<unsigned char>(name[0])));
    if (key != -1 && HIBYTE(key) == 0) return LOBYTE(key);
  }
  throw Error("invalid_argument", "Unsupported key name for the Windows keyboard layout.");
}

int wheel(const Json& value) {
  const double result = value.number();
  if (std::trunc(result) != result || std::abs(result) > 10000)
    throw Error("invalid_argument", "Scroll exceeds allowed bounds.");
  return static_cast<int>(result);
}

}  // namespace

void executeInput(const Target& target, const Json& operation, const std::function<void(bool)>& check,
                  const std::function<void(POINT, bool)>& indicate) {
  const auto action = operation.get("action").string();
  if (action != "click" && action != "type" && action != "key" && action != "scroll" && action != "drag")
    throw Error("invalid_argument", "Unsupported Windows Computer Use action.");
  check(false);
  for (WORD key : {WORD(VK_LBUTTON), WORD(VK_RBUTTON), WORD(VK_MBUTTON)}) freeKey(key);
  if (GetForegroundWindow() != target.window && !SetForegroundWindow(target.window))
    throw Error("not_granted", "Bring the approved window to the foreground before continuing.");
  for (int i = 0; i < 100 && GetForegroundWindow() != target.window; ++i) {
    check(false);
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  check(true);
  Input input;
  if (action == "type") {
    const auto text = wideFromUtf8(operation.get("text").string());
    if (text.empty() || text.size() > 2048 || text.find(L'\0') != std::wstring::npos)
      throw Error("invalid_argument", "Text exceeds allowed bounds.");
    for (WORD key : {WORD(VK_CONTROL), WORD(VK_MENU), WORD(VK_SHIFT), WORD(VK_LWIN), WORD(VK_RWIN)}) freeKey(key);
    for (size_t start = 0; start < text.size();) {
      check(true);
      keyboardTarget(target);
      for (WORD key : {WORD(VK_CONTROL), WORD(VK_MENU), WORD(VK_SHIFT), WORD(VK_LWIN), WORD(VK_RWIN)}) freeKey(key);
      size_t end = std::min(start + 64, text.size());
      if (end < text.size() && text[end - 1] >= 0xd800 && text[end - 1] <= 0xdbff) --end;
      std::vector<INPUT> events;
      for (size_t index = start; index < end; ++index) {
        events.push_back(keyInput(0, KEYEVENTF_UNICODE, text[index]));
        events.push_back(keyInput(0, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, text[index]));
        input.hold(events.back());
      }
      input.send(std::move(events));
      input.clear();
      start = end;
    }
  } else if (action == "key") {
    const WORD key = keyCode(operation.get("key").string());
    const Json& modifiers = operation.get("modifiers");
    if (modifiers.kind != Json::Kind::Array || modifiers.array.size() > 4)
      throw Error("invalid_argument", "Invalid key modifiers.");
    const std::map<std::string, WORD> names = {{"command", VK_LWIN}, {"control", VK_CONTROL}, {"option", VK_MENU}, {"shift", VK_SHIFT}};
    std::vector<WORD> keys;
    for (const auto& modifier : modifiers.array) {
      const auto found = names.find(modifier.string());
      if (found == names.end() || std::find(keys.begin(), keys.end(), found->second) != keys.end())
        throw Error("invalid_argument", "Invalid or duplicate key modifier.");
      keys.push_back(found->second);
    }
    keys.push_back(key);
    for (WORD candidate : keys) freeKey(candidate);
    // Reject unrequested physical modifiers as well; never release user input.
    for (WORD modifier : {WORD(VK_CONTROL), WORD(VK_MENU), WORD(VK_SHIFT), WORD(VK_LWIN), WORD(VK_RWIN)}) freeKey(modifier);
    check(true);
    keyboardTarget(target);
    std::vector<INPUT> events;
    for (WORD candidate : keys) {
      events.push_back(keyInput(candidate));
      input.hold(keyInput(candidate, KEYEVENTF_KEYUP));
    }
    for (auto it = keys.rbegin(); it != keys.rend(); ++it) events.push_back(keyInput(*it, KEYEVENTF_KEYUP));
    input.send(std::move(events));
    input.clear();
  } else if (action == "click") {
    const POINT position = point(target, operation, "x", "y");
    const auto button = operation.get("button").string();
    const auto count = operation.get("count").unsignedInteger();
    if (!count || count > 2) throw Error("invalid_argument", "Click count is outside allowed bounds.");
    DWORD down = 0, up = 0;
    WORD key = 0;
    if (button == "left") { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; key = VK_LBUTTON; }
    else if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; key = VK_RBUTTON; }
    else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; key = VK_MBUTTON; }
    else throw Error("invalid_argument", "Invalid mouse button.");
    freeKey(key);
    for (uint64_t i = 0; i < count; ++i) {
      check(true);
      hit(target, position);
      input.send({move(position)});
      indicate(position, false);
      check(true);
      hit(target, position);
      input.hold(mouseInput(up));
      input.send({mouseInput(down), mouseInput(up)});
      input.clear();
      indicate(position, true);
      indicate(position, false);
    }
  } else if (action == "scroll") {
    const POINT position = point(target, operation, "x", "y");
    const int dx = wheel(operation.get("delta_x")), dy = wheel(operation.get("delta_y"));
    check(true);
    hit(target, position);
    input.send({move(position)});
    indicate(position, false);
    check(true);
    hit(target, position);
    std::vector<INPUT> events;
    if (dy) events.push_back(mouseInput(MOUSEEVENTF_WHEEL, static_cast<DWORD>(dy)));
    if (dx) events.push_back(mouseInput(MOUSEEVENTF_HWHEEL, static_cast<DWORD>(dx)));
    if (!events.empty()) input.send(std::move(events));
  } else {
    const POINT from = point(target, operation, "x", "y"), to = point(target, operation, "to_x", "to_y");
    const auto duration = operation.get("duration_ms").unsignedInteger();
    if (duration < 50 || duration > 2000) throw Error("invalid_argument", "Drag duration exceeds allowed bounds.");
    freeKey(VK_LBUTTON);
    check(true);
    hit(target, from);
    input.send({move(from)});
    indicate(from, false);
    check(true);
    hit(target, from);
    input.hold(mouseInput(MOUSEEVENTF_LEFTUP));
    input.send({mouseInput(MOUSEEVENTF_LEFTDOWN)});
    indicate(from, true);
    const int steps = std::max(2, int(duration / 16));
    for (int i = 1; i <= steps; ++i) {
      check(true);
      POINT position{from.x + LONG((int64_t(to.x) - from.x) * i / steps), from.y + LONG((int64_t(to.y) - from.y) * i / steps)};
      hit(target, position);
      input.send({move(position)});
      indicate(position, true);
      std::this_thread::sleep_for(std::chrono::milliseconds(duration / steps));
    }
    check(true);
    input.release();
    indicate(to, false);
  }
  // A failed readback never causes input replay. The caller observes effects
  // through the canonical next action, including after a dialog opens.
}

}  // namespace computer_use
