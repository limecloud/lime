#include "windows-computer-use.h"
#include "windows-computer-use-cursor.h"
#include <tlhelp32.h>
#include <shlobj.h>
#include <wtsapi32.h>
#include <aclapi.h>
#include <appmodel.h>

#include <algorithm>
#include <iomanip>
#include <sstream>

namespace computer_use {
namespace {

std::string turnOwner(const Json& params) {
  const auto& owner = params.get("owner");
  std::string turn;
  for (const auto* field : {"connection", "thread_id", "turn_id"}) {
    const auto& value = owner.get(field).string();
    if (value.empty() || value.size() > 512) throw Error("invalid_argument", "A trusted turn owner is required.");
    turn += quote(value);
  }
  return turn;
}

uint64_t processCreation(HANDLE process) {
  FILETIME created{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exit, &kernel, &user))
    throw Error("not_granted", "Target process identity is unavailable.");
  return (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}

std::vector<BYTE> tokenInformation(HANDLE process, TOKEN_INFORMATION_CLASS type) {
  HANDLE raw = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &raw)) return {};
  Handle token(raw);
  DWORD bytes = 0;
  GetTokenInformation(raw, type, nullptr, 0, &bytes);
  if (!bytes || bytes > 65536) return {};
  std::vector<BYTE> result(bytes);
  if (!GetTokenInformation(raw, type, result.data(), bytes, &bytes)) return {};
  return result;
}

DWORD integrity(HANDLE process) {
  const auto bytes = tokenInformation(process, TokenIntegrityLevel);
  if (bytes.empty()) throw Error("not_granted", "Process integrity cannot be verified.");
  PSID sid = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(bytes.data())->Label.Sid;
  if (!IsValidSid(sid) || !*GetSidSubAuthorityCount(sid))
    throw Error("not_granted", "Process integrity SID is invalid.");
  return *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
}

HANDLE parentProcess() {
  Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
  if (snapshot.value == INVALID_HANDLE_VALUE) return nullptr;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot.value, &entry)) do {
    if (entry.th32ProcessID == GetCurrentProcessId())
      return OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, entry.th32ParentProcessID);
  } while (Process32NextW(snapshot.value, &entry));
  return nullptr;
}

std::shared_ptr<Application> application(DWORD pid) {
  auto result = std::make_shared<Application>();
  result->pid = pid;
  // Handles retain identity; an inaccessible/elevated/foreign process is never
  // promoted to a target using its displayed name or caller-supplied publisher.
  result->process.value = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid);
  if (!result->process.value || !sameUser(result->process.value) ||
      integrity(result->process.value) > integrity(GetCurrentProcess())) return {};
  result->created = processCreation(result->process.value);
  std::wstring path(32768, L'\0');
  DWORD length = static_cast<DWORD>(path.size());
  if (!QueryFullProcessImageNameW(result->process.value, 0, path.data(), &length)) return {};
  path.resize(length);
  result->image.value = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                   OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (result->image.value == INVALID_HANDLE_VALUE) return {};
  if (!GetFileInformationByHandle(result->image.value, &result->imageInfo)) return {};
  std::wstring finalPath(32768, L'\0');
  length = GetFinalPathNameByHandleW(result->image.value, finalPath.data(), static_cast<DWORD>(finalPath.size()), FILE_NAME_NORMALIZED);
  if (!length || length >= finalPath.size()) return {};
  finalPath.resize(length);
  result->path = finalPath;
  result->publisher = publisher(result->image.value, finalPath);
  result->product = productName(finalPath);
  result->binary = utf8FromWide(finalPath.substr(finalPath.find_last_of(L"\\/") + 1));
  if (result->publisher.empty() || result->product.empty() || result->binary.empty()) return {};
  // A shared frame host does not identify the packaged application it displays.
  if (_stricmp(result->binary.c_str(), "ApplicationFrameHost.exe") == 0) return {};
  UINT32 aumidLength = 0;
  const LONG aumidStatus = GetApplicationUserModelId(result->process.value, &aumidLength, nullptr);
  if (aumidStatus == ERROR_INSUFFICIENT_BUFFER && aumidLength > 1 && aumidLength < 32768) {
    std::wstring aumid(aumidLength, L'\0');
    if (GetApplicationUserModelId(result->process.value, &aumidLength, aumid.data()) != ERROR_SUCCESS) return {};
    aumid.resize(aumidLength - 1);
    result->aumid = utf8FromWide(aumid);
  } else if (aumidStatus != APPMODEL_ERROR_NO_APPLICATION) return {};
  CharLowerBuffW(finalPath.data(), static_cast<DWORD>(finalPath.size()));
  result->appId = "win32:" + utf8FromWide(finalPath);
  return result;
}

std::wstring windowTitle(HWND window) {
  const int length = GetWindowTextLengthW(window);
  if (length < 0 || length > 32768) return {};
  std::wstring title(size_t(length) + 1, L'\0');
  title.resize(GetWindowTextW(window, title.data(), length + 1));
  return title;
}

std::string documentTitle(HWND window) {
  const auto title = utf8FromWide(windowTitle(window));
  const auto start = title.find_first_not_of("* ");
  return start == std::string::npos ? "" : title.substr(start, title.find_last_not_of("* ") - start + 1);
}

struct Consent {
  std::wstring title, message, allow, cancel;
  Canceled canceled;
};

Consent consentText(bool persistent, const Canceled& canceled) {
  const LANGID language = GetUserDefaultUILanguage();
  Consent result;
  result.canceled = canceled;
  result.title = L"Lime";
  const auto primary = PRIMARYLANGID(language);
  if (primary == LANG_CHINESE) {
    const bool simplified = SUBLANGID(language) == SUBLANG_CHINESE_SIMPLIFIED || SUBLANGID(language) == SUBLANG_CHINESE_SINGAPORE;
    result.message = simplified
        ? (persistent ? L"始终允许 Lime 读取和操控此应用？授权将保存，可在设置中撤销。" : L"允许 Lime 在本次连接中读取和操控此应用窗口？你可以随时撤销授权。")
        : (persistent ? L"一律允許 Lime 讀取和操控此應用程式？授權將儲存，可在設定中撤銷。" : L"允許 Lime 在本次連線中讀取和操控此應用程式視窗？你可以隨時撤銷授權。");
    result.allow = simplified ? (persistent ? L"始终允许" : L"允许本次连接") : (persistent ? L"一律允許" : L"允許本次連線");
    result.cancel = simplified ? L"取消" : L"取消";
  } else if (primary == LANG_JAPANESE) {
    result.message = persistent ? L"Lime にこのアプリの読み取りと操作を常に許可しますか？許可は設定で削除できます。" : L"この接続中、Lime にこのアプリのウインドウの読み取りと操作を許可しますか？";
    result.allow = persistent ? L"常に許可" : L"この接続で許可";
    result.cancel = L"キャンセル";
  } else if (primary == LANG_KOREAN) {
    result.message = persistent ? L"Lime이 이 앱을 항상 읽고 제어하도록 허용할까요? 설정에서 권한을 삭제할 수 있습니다." : L"이번 연결에서 Lime이 이 앱 창을 읽고 제어하도록 허용할까요?";
    result.allow = persistent ? L"항상 허용" : L"이번 연결 허용";
    result.cancel = L"취소";
  } else {
    result.message = persistent ? L"Always allow Lime to read and control this application? Approval is saved and can be removed in Settings." : L"Allow Lime to read and control this application window during this connection? You can revoke access at any time.";
    result.allow = persistent ? L"Always allow" : L"Allow this connection";
    result.cancel = L"Cancel";
  }
  return result;
}

INT_PTR CALLBACK consentProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  auto* consent = reinterpret_cast<Consent*>(GetWindowLongPtrW(window, DWLP_USER));
  if (message == WM_INITDIALOG) {
    consent = reinterpret_cast<Consent*>(lParam);
    SetWindowLongPtrW(window, DWLP_USER, lParam);
    RECT client{};
    GetClientRect(window, &client);
    HFONT font = static_cast<HFONT>(GetStockObject(DEFAULT_GUI_FONT));
    auto create = [&](const wchar_t* type, const std::wstring& text, DWORD style, int x, int y, int width, int height, int id) {
      HWND control = CreateWindowExW(0, type, text.c_str(), WS_CHILD | WS_VISIBLE | style,
          x, y, width, height, window, reinterpret_cast<HMENU>(INT_PTR(id)), GetModuleHandleW(nullptr), nullptr);
      SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font), TRUE);
      return control;
    };
    create(L"STATIC", consent->message, SS_NOPREFIX, 16, 14, client.right - 32, client.bottom - 62, 0);
    create(L"BUTTON", consent->allow, WS_TABSTOP | BS_PUSHBUTTON, 16, client.bottom - 40, 166, 28, IDYES);
    HWND cancel = create(L"BUTTON", consent->cancel, WS_TABSTOP | BS_DEFPUSHBUTTON, client.right - 154, client.bottom - 40, 138, 28, IDCANCEL);
    SetFocus(cancel);
    SetForegroundWindow(window);
    SetTimer(window, 1, 50, nullptr);
    return FALSE;
  }
  if (message == WM_TIMER && consent && (consent->canceled() || !interactiveDesktop())) EndDialog(window, IDCANCEL);
  if (message == WM_CLOSE) EndDialog(window, IDCANCEL);
  if (message == WM_COMMAND && (LOWORD(wParam) == IDYES || LOWORD(wParam) == IDCANCEL)) EndDialog(window, LOWORD(wParam));
  return FALSE;
}

bool askConsent(Consent& consent) {
  // DLGTEMPLATE requires DWORD alignment, followed by menu/class/title words.
  struct alignas(DWORD) Dialog { DLGTEMPLATE value; WORD menu; WORD klass; WCHAR title[5]; };
  Dialog dialog{};
  dialog.value.style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_CENTER;
  dialog.value.cx = 330;
  dialog.value.cy = 150;
  std::copy_n(L"Lime", 5, dialog.title);
  return DialogBoxIndirectParamW(GetModuleHandleW(nullptr), &dialog.value, nullptr,
      &consentProc, reinterpret_cast<LPARAM>(&consent)) == IDYES;
}

}  // namespace

std::string jsonEscape(const std::string& value) {
  std::ostringstream out;
  for (unsigned char ch : value) switch (ch) {
    case '"': out << "\\\""; break;
    case '\\': out << "\\\\"; break;
    case '\b': out << "\\b"; break;
    case '\f': out << "\\f"; break;
    case '\n': out << "\\n"; break;
    case '\r': out << "\\r"; break;
    case '\t': out << "\\t"; break;
    default:
      if (ch < 0x20) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(ch) << std::dec;
      else out << char(ch);
  }
  return out.str();
}

std::string utf8FromWide(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), int(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) throw Error("operation_failed", "Invalid Windows Unicode value.");
  std::string result(size, '\0');
  if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), int(value.size()), result.data(), size, nullptr, nullptr))
    throw Error("operation_failed", "Windows Unicode conversion failed.");
  return result;
}

std::wstring wideFromUtf8(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), int(value.size()), nullptr, 0);
  if (size <= 0) throw Error("invalid_argument", "Invalid UTF-8 text.");
  std::wstring result(size, L'\0');
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), int(value.size()), result.data(), size))
    throw Error("invalid_argument", "UTF-8 conversion failed.");
  return result;
}

bool sameUser(HANDLE process) {
  const auto self = tokenInformation(GetCurrentProcess(), TokenUser);
  const auto other = tokenInformation(process, TokenUser);
  DWORD ownSession = 0, otherSession = 0;
  return !self.empty() && !other.empty() &&
      ProcessIdToSessionId(GetCurrentProcessId(), &ownSession) &&
      ProcessIdToSessionId(GetProcessId(process), &otherSession) && ownSession == otherSession &&
      EqualSid(reinterpret_cast<const TOKEN_USER*>(self.data())->User.Sid,
               reinterpret_cast<const TOKEN_USER*>(other.data())->User.Sid);
}

bool interactiveDesktop() {
  HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!desktop) return false;
  wchar_t name[128]{};
  DWORD bytes = 0;
  const bool normal = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &bytes) &&
                      _wcsicmp(name, L"Default") == 0;
  CloseDesktop(desktop);
  DWORD session = 0;
  if (!normal || !ProcessIdToSessionId(GetCurrentProcessId(), &session)) return false;
  WTS_CONNECTSTATE_CLASS* state = nullptr;
  const bool available = WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, session, WTSConnectState,
      reinterpret_cast<LPWSTR*>(&state), &bytes) && bytes >= sizeof(*state) && *state == WTSActive;
  if (state) WTSFreeMemory(state);
  return available;
}

std::string Target::key() const { return app->appId + ":" + std::to_string(app->pid) + ":" + windowId; }
std::string Target::identity() const {
  return "{\"type\":\"native\",\"appId\":" + quote(app->appId) + ",\"processId\":" +
      std::to_string(app->pid) + ",\"windowId\":" + quote(windowId) + ",\"title\":" + quote(title) + "}";
}
std::string Target::fingerprint() const {
  return identity() + ":" + std::to_string(frame.left) + ":" + std::to_string(frame.top) + ":" +
      std::to_string(frame.right) + ":" + std::to_string(frame.bottom) + ":" + std::to_string(dpi) + ":" + utf8FromWide(className);
}

void checkTarget(const Target& target, bool input) {
  DWORD pid = 0;
  RECT frame{};
  wchar_t klass[512]{};
  DWORD affinity = 0;
  BY_HANDLE_FILE_INFORMATION image{};
  Handle current(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, target.app->pid));
  if (!interactiveDesktop() || !current.value || !sameUser(current.value) ||
      WaitForSingleObject(current.value, 0) != WAIT_TIMEOUT || processCreation(current.value) != target.app->created ||
      integrity(current.value) > integrity(GetCurrentProcess()) || !IsWindowVisible(target.window) || IsIconic(target.window) ||
      !GetFileInformationByHandle(target.app->image.value, &image) ||
      image.dwVolumeSerialNumber != target.app->imageInfo.dwVolumeSerialNumber ||
      image.nFileIndexHigh != target.app->imageInfo.nFileIndexHigh || image.nFileIndexLow != target.app->imageInfo.nFileIndexLow ||
      image.nFileSizeHigh != target.app->imageInfo.nFileSizeHigh || image.nFileSizeLow != target.app->imageInfo.nFileSizeLow ||
      CompareFileTime(&image.ftLastWriteTime, &target.app->imageInfo.ftLastWriteTime) != 0 ||
      !GetWindowThreadProcessId(target.window, &pid) || pid != target.app->pid ||
      !GetWindowRect(target.window, &frame) || !EqualRect(&frame, &target.frame) || GetDpiForWindow(target.window) != target.dpi ||
      !GetClassNameW(target.window, klass, 512) || target.className != klass ||
      (GetWindowDisplayAffinity(target.window, &affinity) && affinity != WDA_NONE) ||
      (isWps(*target.app) && documentTitle(target.window) != target.title))
    throw Error("not_granted", "Target identity, document, desktop or geometry changed.");
  if (input && GetForegroundWindow() != target.window)
    throw Error("not_granted", "The approved window is not foreground.");
}

Driver::Driver(bool automationReady, Observe observe)
    : automationReady_(automationReady), observe_(std::move(observe)), parent_(parentProcess()) {
  dpiReady_ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) ||
      AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  if (parent_.value && processCreation(parent_.value) > processCreation(GetCurrentProcess())) {
    CloseHandle(parent_.value);
    parent_.value = nullptr;
  }
  pointer_ = std::make_unique<Pointer>(input_, parent_.value);
}

Driver::~Driver() = default;
void Driver::stopPointer() { pointer_->stop(); }

std::string Driver::snapshot() {
  const bool ready = automationReady_ && dpiReady_ && input_.ready() && parent_.value && sameUser(parent_.value) &&
      WaitForSingleObject(parent_.value, 0) == WAIT_TIMEOUT && interactiveDesktop();
  std::vector<HWND> windows;
  if (ready) EnumWindows([](HWND window, LPARAM context) -> BOOL {
    auto& found = *reinterpret_cast<std::vector<HWND>*>(context);
    if (IsWindowVisible(window) && !IsIconic(window)) found.push_back(window);
    return found.size() < 256;
  }, reinterpret_cast<LPARAM>(&windows));
  std::vector<Target> next;
  for (HWND window : windows) try {
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (!pid || pid == GetCurrentProcessId()) continue;
    auto found = apps_.find(pid);
    std::shared_ptr<Application> app = found == apps_.end() ? nullptr : found->second;
    if (!app || WaitForSingleObject(app->process.value, 0) != WAIT_TIMEOUT) {
      app = application(pid);
      if (!app) continue;
      apps_[pid] = app;
    }
    Target target;
    target.window = window;
    target.app = app;
    target.windowId = std::to_string(reinterpret_cast<uintptr_t>(window)) + ":" + std::to_string(app->created);
    target.dpi = GetDpiForWindow(window);
    wchar_t klass[512]{};
    if (!GetWindowRect(window, &target.frame) || target.frame.right <= target.frame.left ||
        target.frame.bottom <= target.frame.top || !target.dpi || !GetClassNameW(window, klass, 512)) continue;
    target.className = klass;
    const auto previous = std::find_if(targets_.begin(), targets_.end(), [&](const Target& old) { return old.key() == target.key(); });
    target.title = isWps(*app) ? documentTitle(window) : previous == targets_.end() ? utf8FromWide(windowTitle(window)) : previous->title;
    checkTarget(target, false);
    next.push_back(std::move(target));
  } catch (const std::exception&) { /* An unverifiable window is not a target. */ }
  for (auto it = apps_.begin(); it != apps_.end();)
    if (WaitForSingleObject(it->second->process.value, 0) != WAIT_TIMEOUT) it = apps_.erase(it); else ++it;
  std::sort(next.begin(), next.end(), [](const Target& a, const Target& b) { return a.key() < b.key(); });
  std::string payload = "\"readiness\":" + quote(ready ? "ready" : "blocked") + ",\"targets\":[";
  std::string fingerprint;
  std::map<std::string, std::pair<std::string, uint64_t>> revisions;
  std::map<std::string, uint64_t> issued;
  for (const auto& target : next) {
    if (payload.back() != '[') payload += ',';
    const auto fp = target.fingerprint();
    auto old = revisions_.find(target.key());
    uint64_t revision = 0;
    if (old != revisions_.end() && old->second.first == fp) revision = old->second.second;
    else {
      if (revision_ == UINT64_MAX) throw Error("not_granted", "Target revision exhausted.");
      revision = ++revision_;
    }
    revisions[target.key()] = {fp, revision};
    issued[target.key()] = revision;
    payload += "{\"identity\":" + target.identity() + ",\"revision\":" + quote(std::to_string(revision)) +
        ",\"nativeApp\":{\"type\":\"windows\",\"aumid\":" +
        (target.app->aumid ? quote(*target.app->aumid) : "null") + ",\"publisherName\":" +
        quote(target.app->publisher) + ",\"productName\":" + quote(target.app->product) + ",\"binaryName\":" + quote(target.app->binary) +
        "},\"capabilities\":[\"observe\",\"screenshot\",\"click\",\"type\",\"key\",\"scroll\",\"drag\"],\"locked\":false}";
    fingerprint += fp;
  }
  payload += "],\"reason\":" + (ready ? std::string("null") : quote("interactive_desktop_or_driver_unavailable")) +
      ",\"setupSteps\":" + (ready ? "[]" : "[\"unlock_desktop_or_update_helper\"]");
  fingerprint += payload;
  if (fingerprint != fingerprint_) {
    if (generation_ == UINT64_MAX) throw Error("not_granted", "Snapshot generation exhausted.");
    ++generation_;
    fingerprint_ = fingerprint;
  }
  targets_ = std::move(next);
  revisions_ = std::move(revisions);
  issued_[generation_] = std::move(issued);
  while (issued_.size() > 32) issued_.erase(issued_.begin());
  return "{\"generation\":" + std::to_string(generation_) + "," + payload + "}";
}

const Target* Driver::find(const Json& identity) const {
  if (identity.get("type").string() != "native") return nullptr;
  for (const auto& target : targets_)
    if (identity.get("appId").string() == target.app->appId && identity.get("processId").unsignedInteger() == target.app->pid &&
        identity.get("windowId").string() == target.windowId) return &target;
  return nullptr;
}

std::string Driver::setup(const Json& params, const Canceled& canceled) {
  pointer_->stop();
  if (params.get("adapter").string() != "native") throw Error("invalid_argument", "Native setup requires native adapter.");
  const auto scope = params.get("grantScope").string();
  if (scope != "session" && scope != "persistent") throw Error("invalid_argument", "Invalid grant scope.");
  if (const auto* application = params.find("application")) {
    const auto* target = params.find("target");
    if (application->string() != "WPS" || scope != "session" || (target && target->kind != Json::Kind::Null))
      throw Error("invalid_argument", "Application setup requires WPS without a target.");
    if (!parent_.value || WaitForSingleObject(parent_.value, 0) != WAIT_TIMEOUT || !interactiveDesktop())
      throw Error("not_granted", "WPS setup requires an active interactive connection.");
    openWps(canceled);
  }
  std::string status = snapshot();
  std::string approved = "null";
  bool accepted = false;
  const auto* requested = params.find("target");
  if (requested && requested->kind != Json::Kind::Null) {
    if (const auto* selected = find(*requested)) {
      const Target before = *selected;
      const auto revision = revisions_.at(before.key()).second;
      Consent consent = consentText(scope == "persistent", [&] {
        return canceled() || !parent_.value || WaitForSingleObject(parent_.value, 0) != WAIT_TIMEOUT;
      });
      consent.message += L"\n\n" + wideFromUtf8(before.app->product + "\n" + before.app->publisher + "\n" + before.title);
      accepted = !consent.canceled() && askConsent(consent) && !consent.canceled();
      status = snapshot();
      const auto* current = find(*requested);
      accepted = accepted && current && revisions_.at(before.key()).second == revision;
      if (accepted) {
        approved = current->identity();
        SetForegroundWindow(current->window);
      }
    }
  } else accepted = !canceled() && automationReady_ && dpiReady_ && interactiveDesktop();
  return "{\"outcome\":{\"accepted\":" + std::string(accepted ? "true" : "false") + ",\"approvedTarget\":" + approved +
      ",\"generation\":" + std::to_string(generation_) + "},\"snapshot\":" + status + "}";
}

void Driver::checkFence(uint64_t fence) {
  if (!fence || fence < fence_ || !parent_.value || WaitForSingleObject(parent_.value, 0) != WAIT_TIMEOUT)
    throw Error("not_granted", "Control issuer or fence is no longer valid.");
  PWSTR raw = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &raw)))
    throw Error("not_granted", "Local application data directory is unavailable.");
  std::wstring path(raw);
  CoTaskMemFree(raw);
  for (const auto* part : {L"LimeCloud", L"lime", L"computer-use", L"desktop.lock"}) {
    path += L"\\";
    path += part;
    const DWORD attributes = GetFileAttributesW(path.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT))
      throw Error("not_granted", "Control lock path is unavailable or redirected.");
  }
  Handle file(CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  BY_HANDLE_FILE_INFORMATION info{};
  if (file.value == INVALID_HANDLE_VALUE || !GetFileInformationByHandle(file.value, &info) ||
      info.nNumberOfLinks != 1 || info.nFileSizeHigh || info.nFileSizeLow != 8 ||
      (info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)))
    throw Error("not_granted", "Control lock is not a regular fence file.");
  PSID owner = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  const auto user = tokenInformation(GetCurrentProcess(), TokenUser);
  const DWORD security = GetSecurityInfo(file.value, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, &owner, nullptr, nullptr, nullptr, &descriptor);
  const bool owned = security == ERROR_SUCCESS && !user.empty() && owner &&
      EqualSid(owner, reinterpret_cast<const TOKEN_USER*>(user.data())->User.Sid);
  if (descriptor) LocalFree(descriptor);
  if (!owned) throw Error("not_granted", "Control lock owner does not match the OS user.");
  auto locked = [&] {
    OVERLAPPED offset{};
    if (LockFileEx(file.value, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, MAXDWORD, MAXDWORD, &offset)) {
      UnlockFileEx(file.value, 0, MAXDWORD, MAXDWORD, &offset);
      return false;
    }
    return GetLastError() == ERROR_LOCK_VIOLATION;
  };
  if (!locked()) throw Error("not_granted", "Control lease is no longer held.");
  // Windows byte-range locks block ReadFile, but not read-only file mappings.
  // Recheck the live lock on both sides; never take over an available lease.
  Handle mapping(CreateFileMappingW(file.value, nullptr, PAGE_READONLY, 0, 8, nullptr));
  if (!mapping.value) throw Error("not_granted", "Control fence mapping failed.");
  const auto* bytes = static_cast<const BYTE*>(MapViewOfFile(mapping.value, FILE_MAP_READ, 0, 0, 8));
  if (!bytes) throw Error("not_granted", "Control fence is unavailable.");
  uint64_t actual = 0;
  for (int i = 0; i < 8; ++i) actual = (actual << 8) | bytes[i];
  UnmapViewOfFile(bytes);
  if (actual != fence || !locked() || WaitForSingleObject(parent_.value, 0) != WAIT_TIMEOUT)
    throw Error("not_granted", "Control fence or issuer changed.");
}

std::string Driver::execute(const Json& params, const Canceled& canceled) try {
  const auto turn = turnOwner(params);
  const auto generation = params.get("generation").unsignedInteger();
  const auto fence = params.get("fence").unsignedInteger();
  const Json& identity = params.get("target");
  const Json& operation = params.get("operation");
  const auto action = operation.get("action").string();
  snapshot();
  const auto* selected = find(identity);
  if (!selected || !issued_.count(generation) || !issued_.at(generation).count(selected->key()) ||
      issued_.at(generation).at(selected->key()) != revisions_.at(selected->key()).second)
    throw Error("not_granted", "Target or snapshot revision changed.");
  const Target target = *selected;
  auto check = [&](bool input) {
    if (!turnInput_.check(turn, input_.epoch()))
      throw Error(input_.ready() && turnInput_.available() ? "user_intervened" : "input_monitor_unavailable",
          "Manual intervention stopped Computer Use. Observe again before continuing in a new turn.");
    if (canceled()) throw Error("canceled", "Computer Use canceled; outcome may be unknown.");
    if (!interactiveDesktop()) throw Error("desktop_locked", "Computer Use requires an unlocked interactive desktop.");
    checkFence(fence);
    checkTarget(target, input);
  };
  check(false);
  fence_ = fence;
  pointer_->begin(target, turn);
  struct DetachPointer {
    Pointer& pointer;
    ~DetachPointer() { pointer.detach(); }
  } detach{*pointer_};
  if (action == "observe") {
    const auto depth = operation.get("max_depth").unsignedInteger();
    const auto nodes = operation.get("max_nodes").unsignedInteger();
    if (!depth || depth > 8 || !nodes || nodes > 512) throw Error("invalid_argument", "Observation exceeds allowed bounds.");
    const auto result = observe_(target.window, int(depth), int(nodes));
    check(false);
    return result;
  }
  if (action == "screenshot") return capture(target, check);
  executeInput(target, operation, check, [&](POINT point, bool pressed) {
    check(true);
    if (!pointer_->show(target, point, pressed))
      throw Error("unavailable", "The native input indicator or its recovery process is unavailable.");
    check(true);
  });
  return "{\"outcome\":\"submitted\",\"windowId\":" + quote(target.windowId) + ",\"fence\":" + std::to_string(fence) + "}";
} catch (...) {
  pointer_->stop();
  throw;
}

std::string Driver::finishTurn(const Json& params) {
  pointer_->finish(turnOwner(params));
  return "{\"finished\":true}";
}

}  // namespace computer_use
