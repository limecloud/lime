#pragma once

#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

// Shipped activity values; presentation alone never grants input authority.
typedef enum {
  ComputerUseCursorIdle = 0,
  ComputerUseCursorLoading = 1,
  ComputerUseCursorPaused = 2,
} ComputerUseCursorActivity;

// Shared presentation math, consumed directly by Swift and C++. Attachment and
// press scales/spring follow shipped rendering evidence; velocity and the brief
// click pulse remain Lime adaptations (see the cursor attachment execution plan).
typedef struct {
  double a, b, c, d;
} ComputerUseCursorTransform;

typedef struct {
  double x, y, lastTime, lastMoveTime;
  double velocityX, velocityY, pressAmount, pressVelocity, pressUntil;
  double attachmentScaleFrom, attachmentChangedAt;
  bool initialized, isPressed, isAttached;
} ComputerUseCursorMotion;

static inline double computerUseCursorClamp(double value, double low, double high) {
  return fmax(low, fmin(high, value));
}

static inline void computerUseCursorReset(ComputerUseCursorMotion* motion,
                                         double x, double y, double now, bool attached) {
  memset(motion, 0, sizeof(*motion));
  if (!isfinite(x) || !isfinite(y) || !isfinite(now)) return;
  motion->x = x;
  motion->y = y;
  motion->lastTime = motion->lastMoveTime = now;
  motion->isAttached = attached;
  motion->attachmentScaleFrom = attached ? 1.0 : 0.75;
  motion->attachmentChangedAt = now;
  motion->initialized = true;
}

static inline double computerUseCursorAttachmentScale(const ComputerUseCursorMotion* motion,
                                                      double now) {
  const double target = motion->isAttached ? 1.0 : 0.75;
  const double progress = computerUseCursorClamp((now - motion->attachmentChangedAt) / 0.2, 0.0, 1.0);
  if (progress == 0.0) return motion->attachmentScaleFrom;
  if (progress == 1.0) return target;
  // Invert the timing curve's X coordinate before sampling Y: easeInOut has
  // control points (0.42, 0), (0.58, 1), rather than a linear curve parameter.
  double low = 0.0, high = 1.0;
  for (int i = 0; i < 24; ++i) {
    const double t = (low + high) * 0.5, inverse = 1.0 - t;
    const double x = 3.0 * inverse * inverse * t * 0.42 + 3.0 * inverse * t * t * 0.58 + t * t * t;
    if (x < progress) low = t; else high = t;
  }
  const double t = (low + high) * 0.5;
  const double eased = (3.0 - 2.0 * t) * t * t;
  return motion->attachmentScaleFrom + (target - motion->attachmentScaleFrom) * eased;
}

static inline void computerUseCursorAdvancePress(ComputerUseCursorMotion* motion,
                                                double elapsed, double target) {
  // Closed-form damped spring: mass=1, stiffness=400, damping=33. Carry the
  // velocity through a release so a new state never restarts from zero speed.
  if (elapsed >= 2.0) { motion->pressAmount = target; motion->pressVelocity = 0.0; return; }
  const double frequency = sqrt(400.0 - 16.5 * 16.5);
  const double displacement = motion->pressAmount - target;
  const double velocity = motion->pressVelocity;
  const double decay = exp(-16.5 * elapsed);
  const double cosine = cos(frequency * elapsed), sine = sin(frequency * elapsed);
  motion->pressAmount = target + decay * (displacement * cosine + (velocity + 16.5 * displacement) / frequency * sine);
  motion->pressVelocity = decay * (velocity * cosine - (16.5 * velocity + 400.0 * displacement) / frequency * sine);
}

static inline void computerUseCursorAdvance(ComputerUseCursorMotion* motion, double now) {
  if (!motion->initialized || !isfinite(now) || now < motion->lastTime) return;
  const double previousTime = motion->lastTime;
  const double elapsed = now - motion->lastTime;
  motion->lastTime = now;
  const double decay = exp(-elapsed / 0.085);
  motion->velocityX *= decay;
  motion->velocityY *= decay;
  if (!motion->isPressed && previousTime < motion->pressUntil && now >= motion->pressUntil) {
    computerUseCursorAdvancePress(motion, motion->pressUntil - previousTime, 1.0);
    computerUseCursorAdvancePress(motion, now - motion->pressUntil, 0.0);
  } else {
    computerUseCursorAdvancePress(motion, elapsed, motion->isPressed || now < motion->pressUntil ? 1.0 : 0.0);
  }
}

// Positions use logical screen points on both platforms. Rendering alone uses
// physical pixels, so the same motion has the same response at each Windows DPI.
static inline void computerUseCursorMove(ComputerUseCursorMotion* motion,
                                        double x, double y, double now) {
  if (!isfinite(x) || !isfinite(y) || !isfinite(now)) return;
  if (!motion->initialized) { computerUseCursorReset(motion, x, y, now, false); return; }
  if (now < motion->lastTime) return;
  computerUseCursorAdvance(motion, now);
  if (motion->x != x || motion->y != y) {
    const double elapsed = computerUseCursorClamp(now - motion->lastMoveTime, 1.0 / 120.0, 0.08);
    motion->velocityX = computerUseCursorClamp((x - motion->x) / elapsed, -4000.0, 4000.0);
    motion->velocityY = computerUseCursorClamp((y - motion->y) / elapsed, -4000.0, 4000.0);
    motion->x = x;
    motion->y = y;
    motion->lastMoveTime = now;
  }
}

static inline void computerUseCursorAttach(ComputerUseCursorMotion* motion,
                                          bool attached, double now) {
  if (!motion->initialized || !isfinite(now) || now < motion->lastTime ||
      motion->isAttached == attached) return;
  motion->attachmentScaleFrom = computerUseCursorAttachmentScale(motion, now);
  motion->attachmentChangedAt = now;
  motion->isAttached = attached;
  computerUseCursorAdvance(motion, now);
}

static inline void computerUseCursorPress(ComputerUseCursorMotion* motion,
                                         bool pressed, double now) {
  if (!motion->initialized || !isfinite(now) || now < motion->lastTime) return;
  computerUseCursorAdvance(motion, now);
  motion->isPressed = pressed;
  // A down/up pair may complete between display frames. Retain its visual pulse
  // without delaying, repeating, or holding the actual OS mouse button.
  if (pressed) motion->pressUntil = fmax(motion->pressUntil, now + 0.09);
}

static inline ComputerUseCursorTransform computerUseCursorSample(
    ComputerUseCursorMotion* motion, double now, bool reducedMotion) {
  computerUseCursorAdvance(motion, now);
  ComputerUseCursorTransform transform = {1.0, 0.0, 0.0, 1.0};
  if (!motion->initialized) return transform;
  if (reducedMotion) {
    // Preserve the state cue without a moving or pulsing transition.
    transform.a = transform.d = (motion->isAttached ? 1.0 : 0.75) * (motion->isPressed ? 0.7 : 1.0);
    return transform;
  }
  const double speed = hypot(motion->velocityX, motion->velocityY);
  const double stretch = 1.0 + fmin(speed / 12000.0, 0.12);
  const double scale = computerUseCursorAttachmentScale(motion, motion->lastTime) * (1.0 - 0.3 * motion->pressAmount);
  const double angle = computerUseCursorClamp(motion->velocityX / 18000.0, -0.16, 0.16);
  const double cosine = cos(angle), sine = sin(angle);
  const double ux = speed > 0.001 ? motion->velocityX / speed : 1.0;
  const double uy = speed > 0.001 ? motion->velocityY / speed : 0.0;
  const double inverse = 1.0 / stretch;
  const double xx = stretch * ux * ux + inverse * uy * uy;
  const double yy = stretch * uy * uy + inverse * ux * ux;
  const double xy = (stretch - inverse) * ux * uy;
  transform.a = scale * (cosine * xx - sine * xy);
  transform.b = scale * (sine * xx + cosine * xy);
  transform.c = scale * (cosine * xy - sine * yy);
  transform.d = scale * (sine * xy + cosine * yy);
  return transform;
}

// Inverse-map about the existing hotspot, preserving premultiplied BGRA and a
// transparent border. Source/destination must be separate size*size*4 buffers.
static inline void computerUseCursorTransformPixels(
    const uint8_t* source, uint8_t* destination, int size, int hotspotX, int hotspotY,
    ComputerUseCursorTransform transform) {
  const double determinant = transform.a * transform.d - transform.b * transform.c;
  if (size <= 0 || !isfinite(determinant) || determinant < 0.1 ||
      !isfinite(transform.a) || !isfinite(transform.b) ||
      !isfinite(transform.c) || !isfinite(transform.d)) return;
  if (transform.a == 1.0 && transform.b == 0.0 && transform.c == 0.0 && transform.d == 1.0) {
    memcpy(destination, source, (size_t)size * (size_t)size * 4);
    return;
  }
  for (int y = 0; y < size; ++y) {
    for (int x = 0; x < size; ++x) {
      const double dx = x - hotspotX, dy = y - hotspotY;
      const double sx = (transform.d * dx - transform.c * dy) / determinant + hotspotX;
      const double sy = (-transform.b * dx + transform.a * dy) / determinant + hotspotY;
      const int left = (int)floor(sx), top = (int)floor(sy);
      const double fx = sx - left, fy = sy - top;
      for (int channel = 0; channel < 4; ++channel) {
        double value = 0.0;
        for (int row = 0; row < 2; ++row) {
          for (int col = 0; col < 2; ++col) {
            const int px = left + col, py = top + row;
            if (px >= 0 && px < size && py >= 0 && py < size) {
              const double weight = (col ? fx : 1.0 - fx) * (row ? fy : 1.0 - fy);
              value += source[((size_t)py * size + px) * 4 + channel] * weight;
            }
          }
        }
        destination[((size_t)y * size + x) * 4 + channel] = (uint8_t)floor(value + 0.5);
      }
    }
  }
}
