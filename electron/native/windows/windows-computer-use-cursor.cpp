#include "windows-computer-use-cursor.h"
#include "windows-computer-use-cursor-internal.h"
#include "windows-computer-use-cursor-frames.h"
#include "windows-computer-use-cursor-presentation.h"
#include "windows-computer-use-cursor-window.h"
#include "../computer-use-cursor-motion.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <mutex>

namespace computer_use {

struct Pointer::State {
  struct Request {
    Target target;
    POINT point;
    uint64_t physicalEpoch;
    std::string owner;
    bool attached, pressed;
    double pressUntil;
    ComputerUseCursorActivity activity;
  };
  const InputMonitor& input;
  HANDLE issuer;
  std::mutex mutex;
  std::condition_variable presented;
  std::optional<Request> requested, active;
  uint64_t sequence = 0, completed = 0;
  bool result = false, finishRequested = false;
  std::atomic<bool> cursorHidden{false};
  std::atomic<HWND> window{nullptr};
  std::atomic<bool> visible{false}, stopping{false};
  std::atomic<uint64_t> heartbeat{0};
  std::thread thread;
  std::unique_ptr<CursorVisibility> visibility;
  std::unique_ptr<CursorRecovery> recovery;
  HDC dc = nullptr;
  HBITMAP bitmap = nullptr;
  HGDIOBJ previous = nullptr;
  void* pixels = nullptr;
  int bitmapSize = 0;
  ComputerUseCursorMotion motion{};
  ComputerUseCursorTransform lastTransform{1.0, 0.0, 0.0, 1.0};
  CursorTransition transition;
  std::vector<uint8_t> transformed, padded;
  std::vector<double> blurScratch;
  static constexpr UINT updateMessage = WM_APP + 73;

  State(const InputMonitor& monitor, HANDLE parent) : input(monitor), issuer(parent) {
    std::promise<void> started;
    auto ready = started.get_future();
    thread = std::thread([this, started = std::move(started)]() mutable { run(std::move(started)); });
    ready.wait_for(std::chrono::seconds(2));
  }

  ~State() {
    stopping = true;
    if (HWND hwnd = window.load()) PostMessageW(hwnd, WM_CLOSE, 0, 0);
    if (thread.joinable()) thread.join();
  }

  static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* state = reinterpret_cast<State*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      state = static_cast<State*>(reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
    }
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (state && (message == updateMessage || message == WM_TIMER)) {
      try { state->tick(); }
      catch (...) {
        state->hide();
        std::lock_guard<std::mutex> lock(state->mutex);
        state->requested.reset(); state->finishRequested = false;
        state->completed = state->sequence; state->result = false;
        state->presented.notify_all();
      }
      return 0;
    }
    if (message == WM_CLOSE) { DestroyWindow(hwnd); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  void restoreCursor() {
    if (cursorHidden) {
      // Keep the child armed until visibility restoration succeeds.
      if (visibility && visibility->show(true)) {
        cursorHidden = false;
        if (recovery) recovery->disarm();
      }
    }
  }

  void hide() {
    restoreCursor();
    visible = false;
    if (HWND hwnd = window.load()) ShowWindow(hwnd, SW_HIDE);
    active.reset();
    motion = {};
    transition.stop();
  }

  bool valid() const {
    if (!active || !issuer || WaitForSingleObject(issuer, 0) != WAIT_TIMEOUT ||
        !input.ready() || (input.epoch() != active->physicalEpoch &&
            (active->activity != ComputerUseCursorPaused || active->attached || active->pressed)) || !interactiveDesktop() ||
        GetForegroundWindow() != active->target.window || !IsWindowVisible(active->target.window) ||
        IsIconic(active->target.window)) return false;
    DWORD pid = 0;
    POINT point{};
    RECT frame{};
    return GetWindowThreadProcessId(active->target.window, &pid) && pid == active->target.app->pid &&
        GetWindowRect(active->target.window, &frame) && EqualRect(&frame, &active->target.frame) &&
        (!active->attached || (GetCursorPos(&point) && std::abs(point.x - active->point.x) <= 2 &&
            std::abs(point.y - active->point.y) <= 2));
  }

  void clearBitmap() {
    if (dc && previous && previous != HGDI_ERROR) SelectObject(dc, previous);
    if (bitmap) DeleteObject(bitmap);
    if (dc) DeleteDC(dc);
    dc = nullptr; bitmap = nullptr; previous = nullptr; pixels = nullptr; bitmapSize = 0;
  }

  bool draw(double now, bool animation) {
    const auto appearance = transition.sample(now, !animation);
    if (!appearance.visible) return false;
    const int frame = animation && active->activity == ComputerUseCursorLoading
        ? int((GetTickCount64() % cursor_frames::durationMs) * cursor_frames::count / cursor_frames::durationMs) : 0;
    const int variant = active->target.dpi <= 96 ? 0 : active->target.dpi <= 144 ? 1 : 2;
    const auto& image = cursor_frames::frames[frame * 3 + variant];
    const auto layout = cursorCanvas(image.size, image.hotspotX, image.hotspotY);
    const int canvas = layout.size, padding = layout.padding;
    if (bitmapSize != canvas) {
      clearBitmap();
      dc = CreateCompatibleDC(nullptr);
      BITMAPINFO info{};
      info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
      info.bmiHeader.biWidth = canvas;
      info.bmiHeader.biHeight = -canvas;
      info.bmiHeader.biPlanes = 1;
      info.bmiHeader.biBitCount = 32;
      info.bmiHeader.biCompression = BI_RGB;
      bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
      if (!dc || !bitmap || !pixels) return false;
      previous = SelectObject(dc, bitmap);
      if (!previous || previous == HGDI_ERROR) return false;
      bitmapSize = canvas;
    }
    if (!transition.retiring()) lastTransform = computerUseCursorSample(&motion, now, !animation);
    transformed.resize(size_t(image.size) * image.size * 4);
    computerUseCursorTransformPixels(cursor_frames::pixels + image.offset,
        transformed.data(), image.size, image.hotspotX, image.hotspotY, lastTransform);
    padded.assign(size_t(canvas) * canvas * 4, 0);
    for (int y = 0; y < image.size; ++y)
      std::memcpy(padded.data() + (size_t(y + padding) * canvas + padding) * 4,
          transformed.data() + size_t(y) * image.size * 4, size_t(image.size) * 4);
    if (!blurCursorPixels(padded.data(), static_cast<uint8_t*>(pixels), blurScratch,
            canvas, appearance.blur * layout.pixelScale)) return false;
    POINT position{active->point.x - layout.hotspotX, active->point.y - layout.hotspotY}, source{};
    SIZE size{canvas, canvas};
    const double activityOpacity = active->activity == ComputerUseCursorPaused ? 0.5 : 1.0;
    BLENDFUNCTION blend{AC_SRC_OVER, 0, BYTE(std::lround(appearance.opacity * activityOpacity * 255.0)), AC_SRC_ALPHA};
    return UpdateLayeredWindow(window.load(), nullptr, &position, &size, dc, &source, 0, &blend, ULW_ALPHA) &&
        presentCursorWindow(window.load(), active->target.window);
  }

  void tick() {
    heartbeat = GetTickCount64();
    uint64_t current = 0;
    bool changed = false;
    const double now = double(GetTickCount64()) / 1000.0;
    BOOL setting = FALSE;
    const bool animation = SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &setting, 0) && setting;
    {
      std::lock_guard<std::mutex> lock(mutex);
      if (requested && requested->activity != ComputerUseCursorPaused && input.ready() &&
          requested->physicalEpoch != input.epoch()) {
        // Keep the original epoch invalid. The request becomes presentation
        // only; show()/begin() cannot reattach the interrupted owner.
        if (active && visible.load() && active->owner == requested->owner &&
            active->target.key() == requested->target.key()) {
          requested->activity = ComputerUseCursorPaused;
          requested->attached = requested->pressed = false;
          requested->pressUntil = 0;
        } else {
          // Intervention only updates an existing visible indicator.
          requested.reset();
          finishRequested = false;
        }
        ++sequence;
      }
      current = sequence;
      changed = completed < current;
      if (changed) {
        if (requested) {
          const double scale = 96.0 / (requested->target.dpi ? requested->target.dpi : 96);
          if (!active || active->owner != requested->owner ||
              active->target.key() != requested->target.key() ||
              !EqualRect(&active->target.frame, &requested->target.frame) ||
              active->target.dpi != requested->target.dpi) {
            hide();
            computerUseCursorReset(&motion, requested->point.x * scale, requested->point.y * scale, now, requested->attached);
          } else {
            computerUseCursorMove(&motion, requested->point.x * scale, requested->point.y * scale, now);
          }
          computerUseCursorAttach(&motion, requested->attached, now);
          computerUseCursorPress(&motion, requested->pressed, now);
          // Preserve down/up pairs coalesced between overlay-thread frames.
          motion.pressUntil = std::max(motion.pressUntil, requested->pressUntil);
          if (requested->activity == ComputerUseCursorPaused) {
            motion.pressUntil = motion.pressAmount = motion.pressVelocity = 0;
            motion.velocityX = motion.velocityY = 0;
          }
          active = requested;
          transition.show(now, animation);
        } else if (finishRequested && active && visible.load()) {
          // Ownership/input ends now. Only a validated target snapshot remains
          // for the short visual exit; show() already rejects a missing request.
          active->owner.clear();
          active->attached = active->pressed = false;
          restoreCursor();
          transition.finish(now, animation);
        } else {
          hide();
        }
        finishRequested = false;
      }
    }
    bool success = false;
    if (valid()) {
      if (!active->attached) {
        // Model waiting preserves only the Agent overlay, never an input lease
        // or a hidden system cursor.
        restoreCursor();
        success = !cursorHidden && draw(now, animation);
      } else {
        if (!visibility) visibility = std::make_unique<CursorVisibility>();
        if (!recovery) recovery = std::make_unique<CursorRecovery>();
        CURSORINFO cursor{sizeof(CURSORINFO), 0, nullptr, {0, 0}};
        const bool cursorKnown = GetCursorInfo(&cursor);
        // Never take over a cursor already hidden by another application.
        if (visibility->ready() && recovery->ready() && cursorKnown && valid() &&
            (cursorHidden || (cursor.flags & CURSOR_SHOWING)) && draw(now, animation)) {
          if (recovery->arm(cursorHidden)) {
            if (cursorHidden || visibility->show(false)) { cursorHidden = true; success = true; }
            else if (visibility->show(true)) recovery->disarm();
          }
        }
      }
      if (success) visible = true;
    }
    if (!success) {
      hide();
      std::lock_guard<std::mutex> lock(mutex);
      // Invalid presentation must not be resurrected by a later detach. Do
      // not discard a newer request submitted while this frame was drawing.
      if (sequence == current) { requested.reset(); finishRequested = false; }
    }
    if (changed) {
      std::lock_guard<std::mutex> lock(mutex);
      completed = current;
      result = success;
      presented.notify_all();
    }
  }

  bool update(std::unique_lock<std::mutex>& lock, bool allowAsync = false) {
    HWND hwnd = window.load();
    if (!hwnd || GetTickCount64() - heartbeat.load() >= 2000) return false;
    const auto next = ++sequence;
    if (!PostMessageW(hwnd, updateMessage, 0, 0)) return false;
    // Detached visibility does not prove that recovery/hiding is available.
    // Only an already attached indicator can accept asynchronous drag updates.
    if (allowAsync && visible.load() && cursorHidden.load()) return true;
    return presented.wait_for(lock, std::chrono::milliseconds(2500), [&] { return completed >= next; }) && result;
  }

  void run(std::promise<void> started) {
    constexpr wchar_t name[] = L"LimeComputerUsePointer";
    WNDCLASSEXW klass{};
    klass.cbSize = sizeof(klass);
    klass.hInstance = GetModuleHandleW(nullptr);
    klass.lpfnWndProc = &State::windowProc;
    klass.lpszClassName = name;
    RegisterClassExW(&klass);
    HWND hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        name, L"Lime Computer Use Pointer", WS_POPUP, 0, 0, 64, 64, nullptr, nullptr, klass.hInstance, this);
    window = hwnd;
    // WindowFromPoint must also skip the overlay during native hit testing.
    if (hwnd) EnableWindow(hwnd, FALSE);
    const UINT_PTR timer = hwnd ? SetTimer(hwnd, 1, 16, nullptr) : 0;
    heartbeat = GetTickCount64();
    started.set_value();
    if (hwnd && timer && !stopping) {
      MSG message{};
      while (!stopping && GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
      }
    }
    hide();
    if (timer) KillTimer(hwnd, timer);
    if (IsWindow(hwnd)) DestroyWindow(hwnd);
    window = nullptr;
    clearBitmap();
    recovery.reset();
    visibility.reset();
    UnregisterClassW(name, klass.hInstance);
    std::lock_guard<std::mutex> lock(mutex);
    completed = sequence; result = false;
    presented.notify_all();
  }
};

Pointer::Pointer(const InputMonitor& input, HANDLE issuer) : state_(std::make_unique<State>(input, issuer)) {}
Pointer::~Pointer() = default;

bool Pointer::begin(const Target& target, const std::string& owner) {
  if (!state_->input.ready()) return false;
  std::unique_lock<std::mutex> lock(state_->mutex);
  if (state_->requested && state_->requested->owner == owner &&
      (state_->requested->activity == ComputerUseCursorPaused ||
       state_->requested->physicalEpoch != state_->input.epoch())) return false;
  POINT point{target.frame.left + (target.frame.right - target.frame.left) / 2,
              target.frame.top + (target.frame.bottom - target.frame.top) / 2};
  if (state_->requested && state_->requested->owner == owner && state_->requested->target.key() == target.key() &&
      EqualRect(&state_->requested->target.frame, &target.frame)) point = state_->requested->point;
  state_->requested = State::Request{target, point, state_->input.epoch(), owner, false, false, 0.0, ComputerUseCursorIdle};
  state_->finishRequested = false;
  return state_->update(lock);
}

bool Pointer::show(const Target& target, POINT point, bool pressed) {
  if (!state_->input.ready()) return false;
  std::unique_lock<std::mutex> lock(state_->mutex);
  if (!state_->requested || state_->requested->activity == ComputerUseCursorPaused ||
      state_->requested->physicalEpoch != state_->input.epoch()) return false;
  const double pulse = pressed ? double(GetTickCount64()) / 1000.0 + 0.09 : state_->requested->pressUntil;
  state_->requested = State::Request{target, point, state_->requested->physicalEpoch,
      state_->requested->owner, true, pressed, pulse, ComputerUseCursorIdle};
  // A running indicator receives new drag positions without delaying each step.
  return state_->update(lock, true);
}

void Pointer::detach() {
  std::unique_lock<std::mutex> lock(state_->mutex);
  if (!state_->requested) return;
  state_->requested->attached = false;
  state_->requested->pressed = false;
  if (state_->requested->activity != ComputerUseCursorPaused) state_->requested->activity = ComputerUseCursorLoading;
  state_->update(lock);
}

void Pointer::finish(const std::string& owner) {
  std::unique_lock<std::mutex> lock(state_->mutex);
  if (!state_->requested || state_->requested->owner != owner) return;
  state_->requested.reset();
  state_->finishRequested = true;
  state_->update(lock);
}

void Pointer::stop() {
  std::unique_lock<std::mutex> lock(state_->mutex);
  state_->requested.reset();
  state_->finishRequested = false;
  state_->update(lock);
}

}  // namespace computer_use
