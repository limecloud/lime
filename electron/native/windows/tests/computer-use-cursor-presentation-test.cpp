#include "../windows-computer-use-cursor-presentation.h"
#include "../windows-computer-use-cursor-frames.h"

#include <chrono>
#include <cstdio>
#include <limits>

using computer_use::CursorTransition;
using computer_use::blurCursorPixels;
namespace cursor_frames = computer_use::cursor_frames;

static int passed = 0, failed = 0;
static void check(bool result, const char* scenario) {
  if (result) ++passed;
  else { ++failed; std::fprintf(stderr, "FAIL scenario=%s\n", scenario); }
}

static bool near(double actual, double expected) { return std::abs(actual - expected) < 1e-6; }

int main() {
  CursorTransition transition;
  check(!transition.sample(1.0, false).visible, "initially hidden");
  transition.show(1.0, true);
  check(near(transition.sample(1.0, false).opacity, 0.0), "fade in begins transparent");
  const auto quarter = transition.sample(1.11, false);
  check(std::abs(quarter.opacity - 0.1291619) < 1e-6, "quarter uses timing-curve X inversion");
  const auto middle = transition.sample(1.22, false);
  check(near(middle.opacity, 0.5) && near(middle.blur, 3.5), "fade in midpoint alpha and logical blur");
  transition.show(1.22, true);
  check(near(transition.sample(1.44, false).opacity, 1.0), "repeated show does not restart fade in");
  check(near(transition.sample(2.0, false).blur, 0.0), "visible state has no blur");
  transition.finish(2.0, true);
  check(transition.retiring(), "normal finish starts presentation-only exit");
  const auto exiting = transition.sample(2.22, false);
  check(near(exiting.opacity, 0.5) && near(exiting.blur, 3.5), "fade out midpoint");
  transition.finish(2.22, true);
  check(!transition.sample(2.45, false).visible, "repeated finish does not extend exit");

  transition.show(3.0, false);
  transition.finish(3.0, true);
  const auto beforeReverse = transition.sample(3.22, false);
  transition.show(3.22, true);
  check(near(transition.sample(3.22, false).opacity, beforeReverse.opacity), "reversal keeps current alpha");
  check(!transition.retiring() && near(transition.sample(3.67, false).opacity, 1.0), "reversal reaches visible state");
  transition.finish(4.0, true);
  transition.stop();
  check(!transition.sample(4.1, false).visible && !transition.sample(5.0, false).visible, "stop cannot revive after former deadline");
  transition.show(5.0, true);
  transition.stop();
  transition.show(5.1, true);
  check(near(transition.sample(5.1, false).opacity, 0.0), "new presentation starts without old completion");
  check(near(transition.sample(5.55, false).opacity, 1.0), "new presentation survives former deadline");

  transition.stop();
  transition.show(6.0, false);
  check(near(transition.sample(6.0, true).opacity, 1.0), "reduced motion shows immediately");
  transition.finish(6.0, false);
  check(!transition.sample(6.0, true).visible, "reduced motion ends immediately");
  transition.show(7.0, true);
  check(near(transition.sample(7.1, true).opacity, 1.0) && near(transition.sample(7.11, false).opacity, 1.0), "setting change settles fade in without restart");
  transition.finish(7.2, true);
  check(!transition.sample(7.3, true).visible && !transition.sample(7.4, false).visible, "setting change completes fade out");

  const auto nan = std::numeric_limits<double>::quiet_NaN();
  transition.show(nan, true);
  check(!transition.sample(8.0, false).visible, "invalid show cannot expose a window");
  transition.show(8.0, true);
  const auto chronological = transition.sample(8.22, false);
  check(near(transition.sample(8.0, false).opacity, chronological.opacity), "backward clock does not rewind transition");
  check(near(transition.sample(nan, false).opacity, chronological.opacity), "invalid sample keeps finite current state");
  transition.finish(nan, true);
  check(!transition.sample(8.3, false).visible, "invalid finish fails closed");

  const int size = 21, center = size / 2;
  std::vector<uint8_t> source(size * size * 4, 0), destination(source.size(), 0);
  std::vector<double> scratch;
  const size_t offset = size_t(center * size + center) * 4;
  source[offset] = 32; source[offset + 1] = 64; source[offset + 2] = 128; source[offset + 3] = 255;
  const auto original = source;
  check(blurCursorPixels(source.data(), destination.data(), scratch, size, 0.0) && source == destination, "zero blur preserves exact source pixels");
  check(blurCursorPixels(source.data(), destination.data(), scratch, size, 1.0), "Gaussian accepts separate buffers");
  const double normalization = 1.0 + 2.0 * (std::exp(-0.5) + std::exp(-2.0) + std::exp(-4.5));
  const double peak = 255.0 / (normalization * normalization);
  check(destination[offset + 3] == std::lround(peak), "impulse peak matches independent Gaussian reference");
  check(destination[offset + 7] == std::lround(peak * std::exp(-0.5)), "neighbor matches independent Gaussian reference");
  check(source == original, "filter never mutates source");
  bool symmetric = true, premultiplied = true;
  for (int y = 0; y < size; ++y) for (int x = 0; x < size; ++x) {
    const auto a = destination[(size_t(y) * size + x) * 4 + 3];
    symmetric = symmetric && a == destination[(size_t(size - 1 - y) * size + size - 1 - x) * 4 + 3];
    for (int channel = 0; channel < 3; ++channel)
      premultiplied = premultiplied && destination[(size_t(y) * size + x) * 4 + channel] <= a;
  }
  check(symmetric && premultiplied, "Gaussian preserves center and premultiplied alpha");
  check(destination[3] == 0 && destination.back() == 0, "transparent samples outside canvas");
  check(!blurCursorPixels(source.data(), source.data(), scratch, size, 1.0), "in-place filter rejected");
  check(!blurCursorPixels(source.data(), destination.data(), scratch, size, nan), "invalid sigma rejected");
  check(!blurCursorPixels(source.data(), destination.data(), scratch, 257, 1.0), "oversized canvas rejected");

  const auto benchmarkStart = std::chrono::steady_clock::now();
  for (int variant = 0; variant < 3; ++variant) {
    const auto& image = cursor_frames::frames[variant];
    const auto layout = computer_use::cursorCanvas(image.size, image.hotspotX, image.hotspotY);
    const int padding = layout.padding, canvas = layout.size;
    source.assign(size_t(canvas) * canvas * 4, 0);
    destination.resize(source.size());
    for (int y = 0; y < image.size; ++y)
      std::memcpy(source.data() + (size_t(y + padding) * canvas + padding) * 4,
          cursor_frames::pixels + image.offset + size_t(y) * image.size * 4, size_t(image.size) * 4);
    check(blurCursorPixels(source.data(), destination.data(), scratch, canvas, 7.0 * layout.pixelScale), "product DPI frame blur");
    bool borderTransparent = true, validPixels = true;
    for (int y = 0; y < canvas; ++y) for (int x = 0; x < canvas; ++x) {
      const size_t at = (size_t(y) * canvas + x) * 4;
      if (x == 0 || y == 0 || x == canvas - 1 || y == canvas - 1) borderTransparent &= destination[at + 3] == 0;
      for (int channel = 0; channel < 3; ++channel) validPixels &= destination[at + channel] <= destination[at + 3];
    }
    check(borderTransparent && validPixels, "product padded blur has transparent border and valid alpha");
    const int expectedCanvas[] = {74, 112, 148}, expectedHotspot[] = {32, 49, 64};
    check(layout.size == expectedCanvas[variant] && layout.hotspotX == expectedHotspot[variant] &&
        layout.hotspotY == expectedHotspot[variant], "product DPI canvas preserves hotspot with blur padding");
  }
  const auto milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - benchmarkStart).count();
  std::printf("{\"passed\":%d,\"failed\":%d,\"productDpiFrames\":3,\"threeFrameBlurMs\":%.3f}\n", passed, failed, milliseconds);
  return failed ? 1 : 0;
}
