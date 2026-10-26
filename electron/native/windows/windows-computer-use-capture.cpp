#include "windows-computer-use.h"
#include <objidl.h>
#include <wincodec.h>
#include <wincrypt.h>

namespace computer_use {
namespace {
struct Bitmap {
  HDC dc = CreateCompatibleDC(nullptr);
  HBITMAP image = nullptr;
  HGDIOBJ old = nullptr;
  ~Bitmap() {
    if (dc && old) SelectObject(dc, old);
    if (image) DeleteObject(image);
    if (dc) DeleteDC(dc);
  }
};

void require(HRESULT status) {
  if (FAILED(status)) throw Error("operation_failed", "Windows PNG capture encoding failed.");
}
}  // namespace

std::string capture(const Target& target, const std::function<void(bool)>& check) {
  check(false);
  const int width = target.frame.right - target.frame.left;
  const int height = target.frame.bottom - target.frame.top;
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || uint64_t(width) * height > 16 * 1024 * 1024)
    throw Error("invalid_argument", "Window capture exceeds allowed pixel bounds.");
  Bitmap bitmap;
  if (!bitmap.dc) throw Error("operation_failed", "Windows capture DC is unavailable.");
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(info.bmiHeader);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* pixels = nullptr;
  bitmap.image = CreateDIBSection(bitmap.dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
  if (!bitmap.image || !pixels) throw Error("operation_failed", "Windows capture bitmap is unavailable.");
  bitmap.old = SelectObject(bitmap.dc, bitmap.image);
  // Window-only capture: never substitute desktop pixels from an overlapping
  // application. Unsupported/protected windows fail instead of returning a mock.
  if (!PrintWindow(target.window, bitmap.dc, 2)) throw Error("unavailable", "The approved window cannot be captured.");
  GdiFlush();
  check(false);
  for (uint64_t i = 0; i < uint64_t(width) * height; ++i) static_cast<BYTE*>(pixels)[i * 4 + 3] = 255;
  Com<IWICImagingFactory> factory;
  Com<IStream> stream;
  Com<IWICBitmapEncoder> encoder;
  Com<IWICBitmapFrameEncode> frame;
  require(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())));
  require(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));
  require(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
  require(encoder->Initialize(stream.value, WICBitmapEncoderNoCache));
  require(encoder->CreateNewFrame(frame.put(), nullptr));
  require(frame->Initialize(nullptr));
  require(frame->SetSize(width, height));
  WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
  require(frame->SetPixelFormat(&format));
  if (format != GUID_WICPixelFormat32bppBGRA) throw Error("unavailable", "The PNG encoder does not support BGRA capture.");
  require(frame->WritePixels(height, width * 4, width * height * 4, static_cast<BYTE*>(pixels)));
  require(frame->Commit());
  require(encoder->Commit());
  STATSTG stats{};
  require(stream->Stat(&stats, STATFLAG_NONAME));
  if (stats.cbSize.HighPart || !stats.cbSize.LowPart || stats.cbSize.LowPart > 20 * 1024 * 1024)
    throw Error("operation_failed", "PNG capture exceeds the 20 MB response limit.");
  HGLOBAL memory = nullptr;
  require(GetHGlobalFromStream(stream.value, &memory));
  auto* bytes = static_cast<BYTE*>(GlobalLock(memory));
  if (!bytes) throw Error("operation_failed", "PNG capture bytes are unavailable.");
  DWORD count = 0;
  const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  const BOOL measured = CryptBinaryToStringA(bytes, stats.cbSize.LowPart, flags, nullptr, &count);
  std::string encoded(count, '\0');
  const BOOL encodedOk = measured && CryptBinaryToStringA(bytes, stats.cbSize.LowPart, flags, encoded.data(), &count);
  GlobalUnlock(memory);
  if (!encodedOk || !count) throw Error("operation_failed", "PNG base64 encoding failed.");
  if (encoded.back() == '\0') encoded.pop_back();
  check(false);
  return "{\"format\":\"png\",\"source\":\"window\",\"width\":" + std::to_string(width) +
      ",\"height\":" + std::to_string(height) + ",\"data\":" + quote(encoded) + "}";
}
}  // namespace computer_use
