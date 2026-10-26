#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include "windows-native-protocol.h"
#include "windows-computer-use-input.h"

#include <functional>
#include <cctype>
#include <memory>
#include <set>

// Lime platform adaptation. Public Codex does not ship this driver's source.
namespace computer_use {

using native_protocol::Json;

struct Error : std::runtime_error {
  std::string code;
  Error(std::string category, const std::string& message)
      : std::runtime_error(message), code(std::move(category)) {}
};

struct Handle {
  HANDLE value = nullptr;
  explicit Handle(HANDLE handle = nullptr) : value(handle) {}
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};

template <typename T> struct Com {
  T* value = nullptr;
  ~Com() { if (value) value->Release(); }
  T** put() { return &value; }
  T* operator->() const { return value; }
};

std::string jsonEscape(const std::string& value);
std::string utf8FromWide(const std::wstring& value);
std::wstring wideFromUtf8(const std::string& value);
inline std::string quote(const std::string& value) { return "\"" + jsonEscape(value) + "\""; }

struct Application {
  Handle process;
  Handle image;
  DWORD pid = 0;
  uint64_t created = 0;
  std::wstring path;
  std::string appId;
  std::string publisher;
  std::string product;
  std::string binary;
  std::optional<std::string> aumid;
  BY_HANDLE_FILE_INFORMATION imageInfo{};
};

std::string publisher(HANDLE file, const std::wstring& path);
std::string productName(const std::wstring& path);
bool isWps(const Application& app);

struct Target {
  std::shared_ptr<Application> app;
  HWND window = nullptr;
  RECT frame{};
  UINT dpi = 0;
  std::wstring className;
  std::string windowId;
  std::string title;
  std::string identity() const;
  std::string key() const;
  std::string fingerprint() const;
};

using Canceled = std::function<bool()>;
using Observe = std::function<std::string(HWND, int, int)>;

void openWps(const Canceled& canceled);
bool interactiveDesktop();
bool sameUser(HANDLE process);
void checkTarget(const Target& target, bool input);
void executeInput(const Target& target, const Json& operation,
                  const std::function<void(bool)>& check,
                  const std::function<void(POINT, bool)>& indicate);
std::string capture(const Target& target, const std::function<void(bool)>& check);

class Pointer;

class Driver {
 public:
  Driver(bool automationReady, Observe observe);
  ~Driver();
  std::string snapshot();
  std::string setup(const Json& params, const Canceled& canceled);
  std::string execute(const Json& params, const Canceled& canceled);
  std::string finishTurn(const Json& params);
  uint64_t physicalInputEpoch() const { return input_.epoch(); }
  void stopPointer();

 private:
  void checkFence(uint64_t fence);
  const Target* find(const Json& identity) const;
  bool automationReady_ = false;
  bool dpiReady_ = false;
  Observe observe_;
  InputMonitor input_;
  TurnInputFence turnInput_;
  Handle parent_;
  std::unique_ptr<Pointer> pointer_;
  uint64_t generation_ = 1;
  uint64_t revision_ = 0;
  uint64_t fence_ = 0;
  std::string fingerprint_;
  std::vector<Target> targets_;
  std::map<DWORD, std::shared_ptr<Application>> apps_;
  std::map<std::string, std::pair<std::string, uint64_t>> revisions_;
  std::map<uint64_t, std::map<std::string, uint64_t>> issued_;
};

}  // namespace computer_use
