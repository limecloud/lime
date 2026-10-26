#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace computer_use {

struct CursorCanvas {
  int size, hotspotX, hotspotY, padding;
  double pixelScale;
};

inline CursorCanvas cursorCanvas(int size, int hotspotX, int hotspotY) {
  const double scale = size / 32.0;
  const int padding = int(std::ceil(21.0 * scale));
  return {size + padding * 2, hotspotX + padding, hotspotY + padding, padding, scale};
}

// Windows rendering adaptation of the shipped 0.44s alpha/blur transition.
// This class owns presentation only; it cannot acquire input or restore a turn.
class CursorTransition {
 public:
  struct Frame { double opacity, blur; bool visible; };

  void show(double now, bool animate) {
    if (!std::isfinite(now)) return;
    const auto current = sample(now, false);
    if (visible_ && target_ == 1.0) {
      if (!animate) from_ = 1.0;
      return;
    }
    from_ = animate ? current.opacity : 1.0;
    target_ = 1.0;
    startedAt_ = lastTime_;
    visible_ = true;
  }

  void finish(double now, bool animate) {
    if (!visible_ || target_ == 0.0) return;
    if (!animate || !std::isfinite(now)) { stop(); return; }
    from_ = sample(now, false).opacity;
    target_ = 0.0;
    startedAt_ = lastTime_;
  }

  void stop() { visible_ = false; from_ = target_ = 0.0; }

  bool retiring() const { return visible_ && target_ == 0.0; }

  Frame sample(double now, bool reducedMotion) {
    if (std::isfinite(now)) lastTime_ = std::max(lastTime_, now);
    if (!visible_) return {0.0, 0.0, false};
    const double progress = std::clamp((lastTime_ - startedAt_) / 0.44, 0.0, 1.0);
    double opacity = target_;
    if (!reducedMotion && progress < 1.0 && from_ != target_) {
      // Invert X for cubic-bezier(0.42, 0, 0.58, 1), then evaluate Y.
      double low = 0.0, high = 1.0;
      for (int i = 0; i < 24; ++i) {
        const double t = (low + high) * 0.5, inverse = 1.0 - t;
        const double x = 3.0 * inverse * inverse * t * 0.42 + 3.0 * inverse * t * t * 0.58 + t * t * t;
        if (x < progress) low = t; else high = t;
      }
      const double t = (low + high) * 0.5;
      opacity = from_ + (target_ - from_) * (3.0 - 2.0 * t) * t * t;
    }
    if (reducedMotion) from_ = target_;
    if (target_ == 0.0 && (reducedMotion || progress >= 1.0)) { stop(); return {0.0, 0.0, false}; }
    return {opacity, 7.0 * (1.0 - opacity), true};
  }

 private:
  double from_ = 0.0, target_ = 0.0, startedAt_ = 0.0, lastTime_ = 0.0;
  bool visible_ = false;
};

// Separable Gaussian over premultiplied BGRA, using transparent samples beyond
// the canvas. Source and destination are distinct size*size*4 buffers. Padding
// is supplied by the caller so neither the arrow nor its hotspot is translated.
inline bool blurCursorPixels(const uint8_t* source, uint8_t* destination,
                             std::vector<double>& scratch, int size, double sigma) {
  if (!source || !destination || source == destination || size <= 0 || size > 256 ||
      !std::isfinite(sigma) || sigma < 0.0 || sigma > 32.0) return false;
  const size_t bytes = size_t(size) * size * 4;
  if (sigma < 0.01) { std::memcpy(destination, source, bytes); return true; }
  const int radius = int(std::ceil(3.0 * sigma));
  std::vector<double> weights(size_t(radius) * 2 + 1);
  double total = 0.0;
  for (int k = -radius; k <= radius; ++k) {
    const double value = std::exp(-double(k * k) / (2.0 * sigma * sigma));
    weights[size_t(k + radius)] = value;
    total += value;
  }
  for (double& value : weights) value /= total;
  scratch.assign(bytes, 0.0);
  for (int y = 0; y < size; ++y) for (int x = 0; x < size; ++x) {
    const size_t offset = (size_t(y) * size + x) * 4;
    for (int k = -radius; k <= radius; ++k) {
      if (x + k < 0 || x + k >= size) continue;
      const size_t sample = (size_t(y) * size + x + k) * 4;
      const double weight = weights[size_t(k + radius)];
      for (int channel = 0; channel < 4; ++channel) scratch[offset + channel] += source[sample + channel] * weight;
    }
  }
  for (int y = 0; y < size; ++y) for (int x = 0; x < size; ++x) {
    double value[4]{};
    for (int k = -radius; k <= radius; ++k) {
      if (y + k < 0 || y + k >= size) continue;
      const size_t sample = (size_t(y + k) * size + x) * 4;
      const double weight = weights[size_t(k + radius)];
      for (int channel = 0; channel < 4; ++channel) value[channel] += scratch[sample + channel] * weight;
    }
    const size_t offset = (size_t(y) * size + x) * 4;
    for (int channel = 0; channel < 4; ++channel)
      destination[offset + channel] = uint8_t(std::clamp(std::lround(value[channel]), 0L, 255L));
  }
  return true;
}

}  // namespace computer_use
