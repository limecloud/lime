#include "windows-computer-use.h"
#include <wintrust.h>
#include <softpub.h>
#include <wincrypt.h>

#include <iomanip>
#include <sstream>

namespace computer_use {

std::string publisher(HANDLE file, const std::wstring& path) {
  WINTRUST_FILE_INFO info{};
  info.cbStruct = sizeof(info);
  info.pcwszFilePath = path.c_str();
  info.hFile = file;
  WINTRUST_DATA data{};
  data.cbStruct = sizeof(data);
  data.dwUIChoice = WTD_UI_NONE;
  data.fdwRevocationChecks = WTD_REVOKE_NONE;
  data.dwUnionChoice = WTD_CHOICE_FILE;
  data.pFile = &info;
  data.dwStateAction = WTD_STATEACTION_VERIFY;
  data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
  GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
  const LONG verified = WinVerifyTrust(nullptr, &policy, &data);
  std::string result;
  if (verified == ERROR_SUCCESS) {
    const auto* provider = WTHelperProvDataFromStateData(data.hWVTStateData);
    const auto* signer = provider ? WTHelperGetProvSignerFromChain(
        const_cast<CRYPT_PROVIDER_DATA*>(provider), 0, FALSE, 0) : nullptr;
    if (signer && signer->csCertChain && signer->pasCertChain[0].pCert) {
      CERT_NAME_BLOB name = signer->pasCertChain[0].pCert->pCertInfo->Subject;
      const DWORD length = CertNameToStrW(X509_ASN_ENCODING, &name, CERT_X500_NAME_STR, nullptr, 0);
      if (length > 1 && length < 32768) {
        std::wstring text(length, L'\0');
        if (CertNameToStrW(X509_ASN_ENCODING, &name, CERT_X500_NAME_STR, text.data(), length)) {
          text.resize(length - 1);
          result = utf8FromWide(text);
        }
      }
    }
  }
  data.dwStateAction = WTD_STATEACTION_CLOSE;
  WinVerifyTrust(nullptr, &policy, &data);
  return result;
}

std::string productName(const std::wstring& path) {
  DWORD ignored = 0;
  const DWORD bytes = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (!bytes || bytes > 1024 * 1024) return {};
  std::vector<BYTE> version(bytes);
  if (!GetFileVersionInfoW(path.c_str(), 0, bytes, version.data())) return {};
  struct Translation { WORD language; WORD codepage; };
  Translation* translations = nullptr;
  UINT count = 0;
  if (!VerQueryValueW(version.data(), L"\\VarFileInfo\\Translation",
                      reinterpret_cast<void**>(&translations), &count)) return {};
  for (UINT i = 0; i < count / sizeof(Translation); ++i) {
    std::wostringstream key;
    key << L"\\StringFileInfo\\" << std::hex << std::setfill(L'0')
        << std::setw(4) << translations[i].language << std::setw(4) << translations[i].codepage << L"\\ProductName";
    wchar_t* text = nullptr;
    UINT length = 0;
    if (VerQueryValueW(version.data(), key.str().c_str(), reinterpret_cast<void**>(&text), &length)
        && text && length > 1 && length < 32768)
      return utf8FromWide(std::wstring(text, length - 1));
  }
  return {};
}

bool isWps(const Application& app) {
  return !app.publisher.empty() && _stricmp(app.product.c_str(), "WPS Office") == 0 &&
      (_stricmp(app.binary.c_str(), "et.exe") == 0 || _stricmp(app.binary.c_str(), "wps.exe") == 0 ||
       _stricmp(app.binary.c_str(), "wpp.exe") == 0);
}

namespace {
std::wstring registeredPath(HKEY hive, const wchar_t* binary, DWORD view) {
  const std::wstring key = std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\") + binary;
  const DWORD flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | view;
  DWORD bytes = 0;
  if (RegGetValueW(hive, key.c_str(), nullptr, flags, nullptr, nullptr, &bytes) != ERROR_SUCCESS ||
      bytes < 2 * sizeof(wchar_t) || bytes > 65536 || bytes % sizeof(wchar_t)) return {};
  std::wstring path(bytes / sizeof(wchar_t), L'\0');
  if (RegGetValueW(hive, key.c_str(), nullptr, flags, nullptr, path.data(), &bytes) != ERROR_SUCCESS ||
      bytes < 2 * sizeof(wchar_t) || bytes > path.size() * sizeof(wchar_t) || bytes % sizeof(wchar_t)) return {};
  path.resize(bytes / sizeof(wchar_t));
  if (path.back() != L'\0' || path.find(L'\0') != path.size() - 1) return {};
  path.pop_back();
  if (path.size() > 2 && path.front() == L'"' && path.back() == L'"')
    path = path.substr(1, path.size() - 2);
  // App Paths, never PATH or guessed installation directories. Reject arguments,
  // relative entries and device paths before opening the registered executable.
  const bool drive = path.size() > 3 && ((path[0] >= L'A' && path[0] <= L'Z') ||
      (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && path[2] == L'\\';
  const bool unc = path.size() > 4 && path.substr(0, 2) == L"\\\\" && path[2] != L'.' && path[2] != L'?';
  return (drive || unc) && path.find(L'"') == std::wstring::npos ? path : std::wstring();
}

bool launchWps(const std::wstring& path, const wchar_t* binary, const Canceled& canceled) {
  // Hold the image open without write/delete sharing across verification/launch.
  Handle image(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL, nullptr));
  BY_HANDLE_FILE_INFORMATION info{};
  if (image.value == INVALID_HANDLE_VALUE || !GetFileInformationByHandle(image.value, &info) ||
      (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return false;
  std::wstring finalPath(32768, L'\0');
  const DWORD length = GetFinalPathNameByHandleW(image.value, finalPath.data(),
      static_cast<DWORD>(finalPath.size()), FILE_NAME_NORMALIZED);
  if (!length || length >= finalPath.size()) return false;
  finalPath.resize(length);
  const auto name = finalPath.substr(finalPath.find_last_of(L"\\/") + 1);
  if (_wcsicmp(name.c_str(), binary) != 0) return false;
  Application app;
  app.publisher = publisher(image.value, finalPath);
  app.product = productName(finalPath);
  app.binary = utf8FromWide(name);
  if (!isWps(app)) return false;
  if (canceled()) throw Error("canceled", "WPS setup was canceled before launch.");
  if (!interactiveDesktop()) throw Error("desktop_locked", "WPS setup requires an unlocked desktop.");
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  const auto directory = finalPath.substr(0, finalPath.find_last_of(L"\\/"));
  // An explicit executable and no arguments bypass shell associations/elevation.
  if (!CreateProcessW(finalPath.c_str(), nullptr, nullptr, nullptr, FALSE, 0, nullptr,
      directory.c_str(), &startup, &process)) return false;
  Handle child(process.hProcess), thread(process.hThread);
  return true;
}
}  // namespace

void openWps(const Canceled& canceled) {
  for (const auto* binary : {L"et.exe", L"wps.exe", L"wpp.exe"})
    for (HKEY hive : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE})
      for (DWORD view : {DWORD(RRF_SUBKEY_WOW6464KEY), DWORD(RRF_SUBKEY_WOW6432KEY)}) {
        if (canceled()) throw Error("canceled", "WPS setup was canceled.");
        const auto path = registeredPath(hive, binary, view);
        if (!path.empty() && launchWps(path, binary, canceled)) return;
      }
  throw Error("operation_failed", "No verified WPS application is registered in Windows App Paths.");
}

}  // namespace computer_use
