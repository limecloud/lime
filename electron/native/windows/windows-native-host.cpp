#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <ole2.h>
#include <oleauto.h>
#include <UIAutomation.h>

#include "windows-native-protocol.h"
#include "windows-computer-use.h"
#include "windows-computer-use-cursor.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using native_protocol::Json;
using native_protocol::Request;
using native_protocol::RequestQueue;
using computer_use::jsonEscape;
using computer_use::utf8FromWide;

std::mutex outputMutex;

void writeLine(const std::string& line) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout << line << std::endl;
}

void writeSuccess(const std::string& id, const std::string& result) {
  writeLine("{\"id\":\"" + jsonEscape(id) + "\",\"ok\":true,\"result\":" +
            result + "}");
}

void writeError(const std::string& id, const std::string& code,
                const std::string& message, HRESULT status = S_OK) {
  std::ostringstream data;
  data << "{\"code\":\"" << jsonEscape(code) << "\",\"message\":\""
       << jsonEscape(message) << "\"";
  if (status != S_OK) {
    data << ",\"hresult\":" << static_cast<long>(status);
  }
  data << "}";
  writeLine("{\"id\":\"" + jsonEscape(id) + "\",\"ok\":false,\"error\":" +
            data.str() + "}");
}

void writeEvent(const std::string& event, const std::string& payload) {
  writeLine("{\"event\":\"" + jsonEscape(event) + "\",\"payload\":" +
            payload + "}");
}

std::string bstrJson(IUIAutomationElement* element,
                     HRESULT (STDMETHODCALLTYPE IUIAutomationElement::*getter)(BSTR*),
                     const char* key) {
  BSTR raw = nullptr;
  const HRESULT status = (element->*getter)(&raw);
  if (FAILED(status) || !raw) return "\"" + std::string(key) + "\":\"\",";
  const std::string value = jsonEscape(utf8FromWide(raw));
  SysFreeString(raw);
  return "\"" + std::string(key) + "\":\"" + value + "\",";
}

std::string readElement(IUIAutomationElement* element,
                        IUIAutomationTreeWalker* walker, int depth,
                        int maxDepth, int maxNodes, int* nodeCount) {
  if (!element || *nodeCount >= maxNodes) return "null";
  ++*nodeCount;
  std::ostringstream object;
  object << "{";
  object << bstrJson(element, &IUIAutomationElement::get_CurrentName, "name");
  object << bstrJson(element, &IUIAutomationElement::get_CurrentAutomationId,
                     "automationId");
  object << bstrJson(element, &IUIAutomationElement::get_CurrentClassName,
                     "className");
  CONTROLTYPEID controlType = 0;
  if (SUCCEEDED(element->get_CurrentControlType(&controlType))) {
    object << "\"controlType\":" << controlType << ",";
  }
  BOOL enabled = FALSE;
  if (SUCCEEDED(element->get_CurrentIsEnabled(&enabled))) {
    object << "\"isEnabled\":" << (enabled ? "true" : "false") << ",";
  }
  int processId = 0;
  if (SUCCEEDED(element->get_CurrentProcessId(&processId))) {
    object << "\"processId\":" << processId << ",";
  }
  UIA_HWND nativeWindowHandle = nullptr;
  if (SUCCEEDED(element->get_CurrentNativeWindowHandle(&nativeWindowHandle)) &&
      nativeWindowHandle) {
    object << "\"nativeWindowHandle\":"
           << reinterpret_cast<uintptr_t>(nativeWindowHandle) << ",";
  }
  RECT rect{};
  if (SUCCEEDED(element->get_CurrentBoundingRectangle(&rect))) {
    object << "\"bounds\":{" << "\"x\":" << rect.left << ",\"y\":"
           << rect.top << ",\"width\":" << (rect.right - rect.left)
           << ",\"height\":" << (rect.bottom - rect.top) << "},";
  }
  object << "\"children\":[";
  if (depth < maxDepth && *nodeCount < maxNodes) {
    IUIAutomationElement* child = nullptr;
    if (SUCCEEDED(walker->GetFirstChildElement(element, &child)) && child) {
      bool first = true;
      while (child && *nodeCount < maxNodes) {
        if (!first) object << ",";
        first = false;
        object << readElement(child, walker, depth + 1, maxDepth, maxNodes,
                              nodeCount);
        IUIAutomationElement* next = nullptr;
        walker->GetNextSiblingElement(child, &next);
        child->Release();
        child = next;
      }
      if (child) child->Release();
    }
  }
  object << "]}";
  return object.str();
}

struct WindowRecord {
  HWND handle = nullptr;
  DWORD processId = 0;
  std::wstring title;
  std::wstring className;
  RECT bounds{};
  bool minimized = false;
};

BOOL CALLBACK collectWindow(HWND hwnd, LPARAM data) {
  auto* windows = reinterpret_cast<std::vector<WindowRecord>*>(data);
  if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  RECT bounds{};
  if (!GetWindowRect(hwnd, &bounds) || bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top) return TRUE;
  const int titleLength = GetWindowTextLengthW(hwnd);
  std::wstring title(static_cast<size_t>(titleLength + 1), L'\0');
  if (titleLength > 0) GetWindowTextW(hwnd, title.data(), titleLength + 1);
  if (!title.empty() && title.back() == L'\0') title.pop_back();
  std::wstring className(256, L'\0');
  const int classLength = GetClassNameW(hwnd, className.data(),
                                        static_cast<int>(className.size()));
  if (classLength > 0) className.resize(static_cast<size_t>(classLength));
  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  windows->push_back({hwnd, processId, std::move(title), std::move(className),
                      bounds, IsIconic(hwnd) != FALSE});
  return windows->size() < 256 ? TRUE : FALSE;
}

std::string readWindows() {
  std::vector<WindowRecord> windows;
  EnumWindows(&collectWindow, reinterpret_cast<LPARAM>(&windows));
  std::ostringstream result;
  result << "{\"windows\":[";
  for (size_t index = 0; index < windows.size(); ++index) {
    if (index > 0) result << ",";
    const auto& window = windows[index];
    result << "{\"windowHandle\":"
           << reinterpret_cast<uintptr_t>(window.handle)
           << ",\"processId\":" << window.processId << ",\"title\":\""
           << jsonEscape(utf8FromWide(window.title)) << "\",\"className\":\""
           << jsonEscape(utf8FromWide(window.className)) << "\",\"bounds\":{"
           << "\"x\":" << window.bounds.left << ",\"y\":"
           << window.bounds.top << ",\"width\":"
           << (window.bounds.right - window.bounds.left) << ",\"height\":"
           << (window.bounds.bottom - window.bounds.top) << "},\"minimized\":"
           << (window.minimized ? "true" : "false") << "}";
  }
  result << "],\"count\":" << windows.size() << "}";
  return result.str();
}

struct DisplayRecord {
  std::wstring name;
  RECT bounds{};
  RECT workArea{};
  bool primary = false;
};

BOOL CALLBACK collectDisplay(HMONITOR monitor, HDC, LPRECT, LPARAM data) {
  auto* displays = reinterpret_cast<std::vector<DisplayRecord>*>(data);
  MONITORINFOEXW info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(monitor, &info)) return TRUE;
  displays->push_back({info.szDevice, info.rcMonitor, info.rcWork,
                       (info.dwFlags & MONITORINFOF_PRIMARY) != 0});
  return TRUE;
}

std::string readDisplays() {
  std::vector<DisplayRecord> displays;
  EnumDisplayMonitors(nullptr, nullptr, &collectDisplay,
                      reinterpret_cast<LPARAM>(&displays));
  std::ostringstream result;
  result << "{\"displays\":[";
  for (size_t index = 0; index < displays.size(); ++index) {
    if (index > 0) result << ",";
    const auto& display = displays[index];
    result << "{\"name\":\"" << jsonEscape(utf8FromWide(display.name))
           << "\",\"primary\":" << (display.primary ? "true" : "false")
           << ",\"bounds\":{" << "\"x\":" << display.bounds.left
           << ",\"y\":" << display.bounds.top << ",\"width\":"
           << (display.bounds.right - display.bounds.left)
           << ",\"height\":" << (display.bounds.bottom - display.bounds.top)
           << "},\"workArea\":{" << "\"x\":" << display.workArea.left
           << ",\"y\":" << display.workArea.top << ",\"width\":"
           << (display.workArea.right - display.workArea.left)
           << ",\"height\":"
           << (display.workArea.bottom - display.workArea.top) << "}}";
  }
  result << "],\"count\":" << displays.size() << "}";
  return result.str();
}

class RawInputMonitor {
 public:
  ~RawInputMonitor() { stop(); }

  bool start(std::string* error) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (running_) return true;
    running_ = true;
    ready_ = false;
    thread_ = std::thread([this] { run(); });
    readyCondition_.wait_for(lock, std::chrono::seconds(2), [this] {
      return ready_;
    });
    if (!ready_) {
      running_ = false;
      lock.unlock();
      if (thread_.joinable()) thread_.join();
      if (error) *error = "RegisterRawInputDevices could not create a message window";
      return false;
    }
    return true;
  }

  void stop() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!running_) return;
      running_ = false;
      if (threadId_ != 0) PostThreadMessageW(threadId_, WM_QUIT, 0, 0);
    }
    if (thread_.joinable()) thread_.join();
  }

 private:
  static constexpr wchar_t kClassName[] = L"LimeWindowsNativeHostRawInput";
  static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam,
                                     LPARAM lParam) {
    auto* monitor = reinterpret_cast<RawInputMonitor*>(
        GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
      monitor = static_cast<RawInputMonitor*>(create->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(monitor));
    }
    if (monitor && message == WM_INPUT) monitor->handleInput(lParam);
    if (message == WM_CLOSE) DestroyWindow(hwnd);
    if (message == WM_DESTROY) PostQuitMessage(0);
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  void run() {
    threadId_ = GetCurrentThreadId();
    HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW klass{};
    klass.cbSize = sizeof(klass);
    klass.hInstance = instance;
    klass.lpfnWndProc = &RawInputMonitor::windowProc;
    klass.lpszClassName = kClassName;
    RegisterClassExW(&klass);
    hwnd_ = CreateWindowExW(0, kClassName, L"Lime Raw Input", 0, 0, 0, 0, 0,
                            HWND_MESSAGE, nullptr, instance, this);
    RAWINPUTDEVICE device{};
    device.usUsagePage = 0x01;
    device.usUsage = 0x06;
    device.dwFlags = RIDEV_INPUTSINK;
    device.hwndTarget = hwnd_;
    const bool registered = hwnd_ && RegisterRawInputDevices(&device, 1, sizeof(device));
    {
      std::lock_guard<std::mutex> lock(mutex_);
      ready_ = registered;
      readyCondition_.notify_all();
    }
    if (!registered) return;
    MSG message{};
    while (running_ && GetMessageW(&message, nullptr, 0, 0) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    device.dwFlags = RIDEV_REMOVE;
    device.hwndTarget = nullptr;
    RegisterRawInputDevices(&device, 1, sizeof(device));
    if (hwnd_) DestroyWindow(hwnd_);
    UnregisterClassW(kClassName, instance);
    hwnd_ = nullptr;
  }

  void handleInput(LPARAM lParam) {
    UINT size = 0;
    if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, nullptr,
                        &size, sizeof(RAWINPUTHEADER)) == UINT(-1) || size == 0) return;
    std::string buffer(size, '\0');
    if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT,
                        buffer.data(), &size, sizeof(RAWINPUTHEADER)) == UINT(-1)) return;
    const auto* raw = reinterpret_cast<const RAWINPUT*>(buffer.data());
    if (raw->header.dwType != RIM_TYPEKEYBOARD) return;
    const RAWKEYBOARD& key = raw->data.keyboard;
    const char* name = modifierName(key.VKey);
    if (!name) return;
    writeEvent("bareModifier.changed",
               std::string("{\"key\":\"") + name + "\",\"isDown\":" +
                   ((key.Flags & RI_KEY_BREAK) ? "false" : "true") + "}");
  }

  static const char* modifierName(USHORT key) {
    switch (key) {
      case VK_LSHIFT: return "leftShift";
      case VK_RSHIFT: return "rightShift";
      case VK_SHIFT: return "shift";
      case VK_LCONTROL: return "leftControl";
      case VK_RCONTROL: return "rightControl";
      case VK_CONTROL: return "control";
      case VK_LMENU: return "leftAlt";
      case VK_RMENU: return "rightAlt";
      case VK_MENU: return "alt";
      case VK_LWIN: return "leftCommand";
      case VK_RWIN: return "rightCommand";
      default: return nullptr;
    }
  }

  std::mutex mutex_;
  std::condition_variable readyCondition_;
  std::thread thread_;
  std::atomic<bool> running_{false};
  bool ready_ = false;
  DWORD threadId_ = 0;
  HWND hwnd_ = nullptr;
};

constexpr wchar_t RawInputMonitor::kClassName[];

class DisplayWatcher {
 public:
  ~DisplayWatcher() { stop(); }

  bool start(std::string* error) {
    std::unique_lock<std::mutex> lock(mutex_);
    if (running_) return true;
    running_ = true;
    ready_ = false;
    thread_ = std::thread([this] { run(); });
    readyCondition_.wait_for(lock, std::chrono::seconds(2), [this] {
      return ready_;
    });
    if (!ready_) {
      running_ = false;
      lock.unlock();
      if (thread_.joinable()) thread_.join();
      if (error) *error = "Display watcher could not create a hidden window";
      return false;
    }
    return true;
  }

  void stop() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!running_) return;
      running_ = false;
      if (threadId_ != 0) PostThreadMessageW(threadId_, WM_QUIT, 0, 0);
    }
    if (thread_.joinable()) thread_.join();
  }

 private:
  static constexpr wchar_t kClassName[] = L"LimeWindowsNativeHostDisplayWatcher";

  static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam,
                                     LPARAM lParam) {
    auto* watcher = reinterpret_cast<DisplayWatcher*>(
        GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
      watcher = static_cast<DisplayWatcher*>(create->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(watcher));
    }
    if (watcher && message == WM_DISPLAYCHANGE) {
      watcher->handleDisplayChange(wParam, lParam);
    }
    if (message == WM_CLOSE) DestroyWindow(hwnd);
    if (message == WM_DESTROY) PostQuitMessage(0);
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  void run() {
    threadId_ = GetCurrentThreadId();
    HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW klass{};
    klass.cbSize = sizeof(klass);
    klass.hInstance = instance;
    klass.lpfnWndProc = &DisplayWatcher::windowProc;
    klass.lpszClassName = kClassName;
    RegisterClassExW(&klass);
    hwnd_ = CreateWindowExW(0, kClassName, L"Lime Display Watcher", WS_POPUP,
                            0, 0, 1, 1, nullptr, nullptr, instance, this);
    if (hwnd_) ShowWindow(hwnd_, SW_HIDE);
    {
      std::lock_guard<std::mutex> lock(mutex_);
      ready_ = hwnd_ != nullptr;
      readyCondition_.notify_all();
    }
    if (!hwnd_) {
      UnregisterClassW(kClassName, instance);
      return;
    }
    MSG message{};
    while (running_ && GetMessageW(&message, nullptr, 0, 0) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    if (hwnd_) DestroyWindow(hwnd_);
    UnregisterClassW(kClassName, instance);
    hwnd_ = nullptr;
  }

  void handleDisplayChange(WPARAM bitsPerPixel, LPARAM dimensions) {
    std::ostringstream payload;
    payload << "{\"bitsPerPixel\":" << static_cast<unsigned int>(bitsPerPixel)
            << ",\"width\":" << static_cast<unsigned int>(LOWORD(dimensions))
            << ",\"height\":" << static_cast<unsigned int>(HIWORD(dimensions))
            << ",\"snapshot\":" << readDisplays() << "}";
    writeEvent("display.changed", payload.str());
  }

  std::mutex mutex_;
  std::condition_variable readyCondition_;
  std::thread thread_;
  std::atomic<bool> running_{false};
  bool ready_ = false;
  DWORD threadId_ = 0;
  HWND hwnd_ = nullptr;
};

constexpr wchar_t DisplayWatcher::kClassName[];

class NativeHost {
 public:
  NativeHost() {
    const HRESULT status = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    shouldUninitialize_ = SUCCEEDED(status);
    if (SUCCEEDED(status) || status == RPC_E_CHANGED_MODE)
      CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation_));
    computerUse_ = std::make_unique<computer_use::Driver>(automation_ != nullptr,
        [this](HWND window, int depth, int nodes) {
          std::string code, message;
          HRESULT result = S_OK;
          auto value = readAutomationWindow(window, depth, nodes, &code, &message, &result);
          if (!code.empty()) throw computer_use::Error(code, message);
          return value;
        });
  }

  ~NativeHost() {
    displayWatcher_.stop();
    rawInput_.stop();
    if (automation_) automation_->Release();
    if (shouldUninitialize_) CoUninitialize();
  }

  uint64_t physicalInputEpoch() const { return computerUse_->physicalInputEpoch(); }
  void stopPointer() { computerUse_->stopPointer(); }

  std::string dispatch(const std::string& method, const Json& params,
                       const computer_use::Canceled& canceled,
                       std::string* errorCode, std::string* errorMessage,
                       HRESULT* errorStatus) {
    if (method == "computerUse.snapshot") {
      return computerUse_->snapshot();
    }
    if (method == "computerUse.setup") {
      return computerUse_->setup(params, canceled);
    }
    if (method == "computerUse.execute") return computerUse_->execute(params, canceled);
    if (method == "computerUse.finishTurn") return computerUse_->finishTurn(params);
    if (method == "windows.uiAutomation.capabilities") {
      return "{\"uiAutomation\":\"" +
             std::string(automation_ ? "ready" : "unavailable") +
             "\",\"rawInput\":\"ready\",\"windowEnumeration\":\"ready\",\"displayEnumeration\":\"ready\",\"displayWatcher\":\"ready\",\"readOnly\":true}";
    }
    if (method == "windows.uiAutomation.read") {
      return readAutomation(params, errorCode, errorMessage, errorStatus);
    }
    if (method == "windows.window.read") {
      return readWindows();
    }
    if (method == "windows.display.read") {
      return readDisplays();
    }
    if (method == "windows.displayWatcher.start") {
      std::string message;
      if (!displayWatcher_.start(&message)) {
        *errorCode = "unavailable";
        *errorMessage = message;
        return {};
      }
      return "{\"started\":true,\"readOnly\":true}";
    }
    if (method == "windows.displayWatcher.stop") {
      displayWatcher_.stop();
      return "{\"stopped\":true}";
    }
    if (method == "windows.bareModifierMonitor.start") {
      std::string message;
      if (!rawInput_.start(&message)) {
        *errorCode = "unavailable";
        *errorMessage = message;
        return {};
      }
      return "{\"started\":true,\"readOnly\":true}";
    }
    if (method == "windows.bareModifierMonitor.stop") {
      rawInput_.stop();
      return "{\"stopped\":true}";
    }
    *errorCode = "unsupported";
    *errorMessage = "Windows native host method is not supported.";
    return {};
  }

 private:
  std::string readAutomation(const Json& params,
                             std::string* errorCode,
                             std::string* errorMessage, HRESULT* errorStatus) {
    if (!automation_) {
      *errorCode = "unavailable";
      *errorMessage = "UI Automation COM service is unavailable.";
      return {};
    }
    int maxDepth = 4;
    int maxNodes = 128;
    if (const auto* depth = params.find("maxDepth")) {
      const auto value = depth->unsignedInteger();
      maxDepth = static_cast<int>(value > 8 ? 8 : value);
    }
    if (const auto* nodes = params.find("maxNodes")) {
      const auto value = nodes->unsignedInteger();
      maxNodes = static_cast<int>(value > 256 ? 256 : value);
    }
    if (maxDepth < 1 || maxNodes < 1) {
      *errorCode = "invalid_argument";
      *errorMessage = "maxDepth and maxNodes must be positive.";
      return {};
    }
    HWND window = nullptr;
    if (const auto* handle = params.find("windowHandle")) {
      const uint64_t value = handle->unsignedInteger();
      if (!value || value > UINTPTR_MAX) throw native_protocol::InvalidRequest("Invalid windowHandle");
      window = reinterpret_cast<HWND>(static_cast<uintptr_t>(value));
    }
    return readAutomationWindow(window, maxDepth, maxNodes, errorCode, errorMessage, errorStatus);
  }

  std::string readAutomationWindow(HWND window, int maxDepth, int maxNodes,
                                  std::string* errorCode, std::string* errorMessage, HRESULT* errorStatus) {
    if (!automation_) throw computer_use::Error("unavailable", "UI Automation is unavailable.");
    IUIAutomationElement* root = nullptr;
    HRESULT status = S_OK;
    if (window) status = automation_->ElementFromHandle(window, &root);
    else status = automation_->GetFocusedElement(&root);
    if (FAILED(status) || !root) {
      *errorCode = "unavailable";
      *errorMessage = "UI Automation element could not be resolved.";
      *errorStatus = status;
      return {};
    }
    IUIAutomationTreeWalker* walker = nullptr;
    status = automation_->get_ControlViewWalker(&walker);
    if (FAILED(status) || !walker) {
      root->Release();
      *errorCode = "unavailable";
      *errorMessage = "UI Automation control view is unavailable.";
      *errorStatus = status;
      return {};
    }
    int nodeCount = 0;
    const std::string tree = readElement(root, walker, 0, maxDepth, maxNodes, &nodeCount);
    walker->Release();
    root->Release();
    return "{\"tree\":" + tree + ",\"nodeCount\":" + std::to_string(nodeCount) +
           ",\"maxDepth\":" + std::to_string(maxDepth) +
           ",\"maxNodes\":" + std::to_string(maxNodes) +
           ",\"truncated\":" + (nodeCount >= maxNodes ? "true" : "false") + "}";
  }

  IUIAutomation* automation_ = nullptr;
  bool shouldUninitialize_ = false;
  RawInputMonitor rawInput_;
  DisplayWatcher displayWatcher_;
  std::unique_ptr<computer_use::Driver> computerUse_;
};

}  // namespace

int main(int argc, char** argv) {
  std::ios::sync_with_stdio(false);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  try {
    if (auto recovery = computer_use::runPointerRecovery(argc, argv)) return *recovery;
  } catch (const std::exception&) { return 2; }
  NativeHost host;
  native_protocol::serve(
      std::cin,
      [&](const Request& request, const RequestQueue& queue) {
        std::string code;
        std::string message;
        HRESULT status = S_OK;
        try {
          const std::string result = host.dispatch(request.method, request.params,
              [&] {
                if (request.method == "computerUse.execute" && queue.intervened(request))
                  throw computer_use::Error("user_intervened", "The user took control; input stopped.");
                return queue.canceled(request, request.method != "computerUse.setup");
              }, &code, &message, &status);
          if (!code.empty()) writeError(request.id, code, message, status);
          else writeSuccess(request.id, result);
        } catch (const computer_use::Error& error) { writeError(request.id, error.code, error.what()); }
      },
      [](const std::string& id, const std::string& code, const std::string& message) {
        writeError(id, code, message);
      }, [&] { return host.physicalInputEpoch(); }, [&] { host.stopPointer(); });
  return 0;
}
