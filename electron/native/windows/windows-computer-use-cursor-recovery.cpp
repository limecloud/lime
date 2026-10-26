#include "windows-computer-use-cursor.h"
#include "windows-computer-use-cursor-internal.h"

#include <cstring>

namespace computer_use {
namespace {

constexpr char recoveryMode[] = "--restore-computer-use-pointer";

template <typename Function> Function systemFunction(HMODULE library, const char* name) {
  const FARPROC address = GetProcAddress(library, name);
  Function result = nullptr;
  static_assert(sizeof(result) == sizeof(address), "Windows function pointer ABI mismatch");
  std::memcpy(&result, &address, sizeof(result));
  return result;
}

std::wstring executablePath() {
  std::wstring path(32768, L'\0');
  const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
  if (!length || length >= path.size()) throw Error("unavailable", "Native pointer executable is unavailable.");
  path.resize(length);
  return path;
}

std::wstring handleArgument(HANDLE value) { return std::to_wstring(reinterpret_cast<uintptr_t>(value)); }

HANDLE parseHandle(const char* text) {
  if (!text || !*text) return nullptr;
  uintptr_t value = 0;
  for (const char* at = text; *at; ++at) {
    if (*at < '0' || *at > '9' || value > (UINTPTR_MAX - (*at - '0')) / 10) return nullptr;
    value = value * 10 + (*at - '0');
  }
  return reinterpret_cast<HANDLE>(value);
}

bool sameExecutable(HANDLE parent) {
  std::wstring path(32768, L'\0');
  DWORD length = static_cast<DWORD>(path.size());
  if (!QueryFullProcessImageNameW(parent, 0, path.data(), &length)) return false;
  path.resize(length);
  const auto currentPath = executablePath();
  const DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  Handle issuer(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, share, nullptr, OPEN_EXISTING, 0, nullptr));
  Handle current(CreateFileW(currentPath.c_str(), FILE_READ_ATTRIBUTES, share, nullptr, OPEN_EXISTING, 0, nullptr));
  BY_HANDLE_FILE_INFORMATION a{}, b{};
  // Compare OS file identities, including canonical/extended-path invocations.
  return issuer.value != INVALID_HANDLE_VALUE && current.value != INVALID_HANDLE_VALUE &&
      GetFileInformationByHandle(issuer.value, &a) && GetFileInformationByHandle(current.value, &b) &&
      a.dwVolumeSerialNumber == b.dwVolumeSerialNumber &&
      a.nFileIndexHigh == b.nFileIndexHigh && a.nFileIndexLow == b.nFileIndexLow;
}

}  // namespace

CursorVisibility::CursorVisibility() {
  library_ = LoadLibraryExW(L"Magnification.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (!library_) return;
  const auto initialize = systemFunction<Initialize>(library_, "MagInitialize");
  uninitialize_ = systemFunction<Initialize>(library_, "MagUninitialize");
  show_ = systemFunction<Show>(library_, "MagShowSystemCursor");
  initialized_ = initialize && uninitialize_ && show_ && initialize();
}

CursorVisibility::~CursorVisibility() {
  if (initialized_) uninitialize_();
  if (library_) FreeLibrary(library_);
}

CursorRecovery::CursorRecovery() {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  Handle parent;
  if (!DuplicateHandle(GetCurrentProcess(), GetCurrentProcess(), GetCurrentProcess(), &parent.value,
      SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, TRUE, 0)) return;
  mapping_.value = CreateFileMappingW(INVALID_HANDLE_VALUE, &security, PAGE_READWRITE, 0, sizeof(CursorRecoveryState), nullptr);
  wake_.value = CreateEventW(&security, FALSE, FALSE, nullptr);
  started_.value = CreateEventW(&security, TRUE, FALSE, nullptr);
  if (!mapping_.value || !wake_.value || !started_.value) return;
  state_ = static_cast<CursorRecoveryState*>(MapViewOfFile(mapping_.value, FILE_MAP_WRITE | FILE_MAP_READ, 0, 0, sizeof(CursorRecoveryState)));
  if (!state_) return;
  // Page-file mappings start zeroed. Only these four private handles are inherited.
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
  if (!bytes) return;
  std::vector<BYTE> attributes(bytes);
  auto* list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
  if (!InitializeProcThreadAttributeList(list, 1, 0, &bytes)) return;
  struct Attributes { LPPROC_THREAD_ATTRIBUTE_LIST value; ~Attributes() { DeleteProcThreadAttributeList(value); } } owner{list};
  HANDLE handles[]{parent.value, mapping_.value, wake_.value, started_.value};
  const bool configured = UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
      handles, sizeof(handles), nullptr, nullptr);
  if (configured) {
    const auto executable = executablePath();
    std::wstring command = L"\"" + executable + L"\" " + wideFromUtf8(recoveryMode);
    for (HANDLE handle : handles) command += L" " + handleArgument(handle);
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.lpAttributeList = list;
    PROCESS_INFORMATION child{};
    // A watchdog killed with the input host cannot restore a hidden cursor.
    // If the enclosing job forbids breakaway, leave the normal cursor visible.
    const DWORD flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB;
    if (CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE, flags,
        nullptr, nullptr, &startup.StartupInfo, &child)) {
      process_.value = child.hProcess;
      CloseHandle(child.hThread);
      BOOL contained = TRUE;
      if (!IsProcessInJob(child.hProcess, nullptr, &contained) || contained) {
        InterlockedExchange(&state_->active, -1);
        SetEvent(wake_.value);
      } else WaitForSingleObject(started_.value, 2000);
    }
  }
}

CursorRecovery::~CursorRecovery() {
  if (state_) {
    // Leave an armed lease for the child if normal visibility restoration failed.
    if (InterlockedCompareExchange(&state_->active, 0, 0) == 0)
      InterlockedExchange(&state_->active, -1);
    SetEvent(wake_.value);
    UnmapViewOfFile(state_);
  }
}

bool CursorRecovery::ready() const {
  return state_ && process_.value && WaitForSingleObject(process_.value, 0) == WAIT_TIMEOUT &&
      InterlockedCompareExchange(&state_->active, 0, 0) >= 0 &&
      InterlockedCompareExchange(&state_->initialized, 0, 0) == 1;
}

bool CursorRecovery::arm(bool refresh) {
  if (!ready()) return false;
  InterlockedExchange64(&state_->deadline, static_cast<LONG64>(GetTickCount64() + 3000));
  // A stale UI heartbeat must never overwrite the child's completed recovery.
  const bool armed = refresh ? InterlockedCompareExchange(&state_->active, 0, 0) == 1
                            : InterlockedCompareExchange(&state_->active, 1, 0) == 0;
  if (!armed) return false;
  SetEvent(wake_.value);
  return true;
}

void CursorRecovery::disarm() {
  if (state_) InterlockedExchange(&state_->active, 0);
}

std::optional<int> runPointerRecovery(int argc, char** argv) {
  if (argc < 2 || std::strcmp(argv[1], recoveryMode) != 0) return std::nullopt;
  if (argc != 6) return 2;
  Handle parent(parseHandle(argv[2])), mapping(parseHandle(argv[3])), wake(parseHandle(argv[4])), started(parseHandle(argv[5]));
  if (!parent.value || !mapping.value || !wake.value || !started.value || !sameUser(parent.value)) return 2;
  if (!sameExecutable(parent.value)) return 2;
  auto* state = static_cast<CursorRecoveryState*>(MapViewOfFile(mapping.value, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(CursorRecoveryState)));
  if (!state) return 2;
  CursorVisibility visibility;
  InterlockedExchange(&state->initialized, visibility.ready() ? 1 : -1);
  SetEvent(started.value);
  if (!visibility.ready()) { UnmapViewOfFile(state); return 2; }
  HANDLE handles[]{parent.value, wake.value};
  for (;;) {
    const DWORD waited = WaitForMultipleObjects(2, handles, FALSE, 100);
    const bool parentEnded = waited == WAIT_OBJECT_0 || waited == WAIT_FAILED;
    const LONG active = InterlockedCompareExchange(&state->active, 0, 0);
    const auto deadline = static_cast<uint64_t>(InterlockedCompareExchange64(&state->deadline, 0, 0));
    if (active == 1 && (parentEnded || GetTickCount64() >= deadline)) {
      if (visibility.show(true)) InterlockedExchange(&state->active, parentEnded ? -1 : 0);
      else { if (parentEnded) Sleep(50); continue; }
    }
    if (parentEnded || active == -1) break;
  }
  UnmapViewOfFile(state);
  return 0;
}

}  // namespace computer_use
