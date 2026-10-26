#include "../../computer-use-cursor-motion.h"

#include <array>
#include <cassert>
#include <cstdio>
#include <limits>
#include <string>

static double area(ComputerUseCursorTransform value) {
  return value.a * value.d - value.b * value.c;
}

static bool identity(ComputerUseCursorTransform value) {
  return value.a == 1.0 && value.b == 0.0 && value.c == 0.0 && value.d == 1.0;
}

static void trace(ComputerUseCursorTransform value) {
  std::printf("%.17g %.17g %.17g %.17g\n", value.a, value.b, value.c, value.d);
}

int main(int argc, char** argv) {
  ComputerUseCursorMotion motion{};
  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, true);
  if (argc == 2 && std::string(argv[1]) == "--trace") {
    computerUseCursorMove(&motion, 40.0, 42.0, 1.016);
    computerUseCursorPress(&motion, true, 1.020);
    trace(computerUseCursorSample(&motion, 1.050, false));
    computerUseCursorPress(&motion, false, 1.060);
    trace(computerUseCursorSample(&motion, 1.100, false));
    trace(computerUseCursorSample(&motion, 1.400, false));
    trace(computerUseCursorSample(&motion, 1.450, true));
    computerUseCursorPress(&motion, false, 1.500);
    computerUseCursorAttach(&motion, false, 1.500);
    trace(computerUseCursorSample(&motion, 1.600, false));
    computerUseCursorAttach(&motion, true, 1.600);
    trace(computerUseCursorSample(&motion, 1.700, false));
    trace(computerUseCursorSample(&motion, 1.900, false));
    computerUseCursorAttach(&motion, false, 1.900);
    trace(computerUseCursorSample(&motion, 1.950, true));
    return 0;
  }
  assert(identity(computerUseCursorSample(&motion, 1.0, false)));

  computerUseCursorMove(&motion, 50.0, 40.0, 1.016);
  const auto moving = computerUseCursorSample(&motion, 1.016, false);
  assert(moving.b > 0.0 && !identity(moving));
  assert(std::abs(area(moving) - 1.0) < 1e-12);
  const auto settled = computerUseCursorSample(&motion, 3.0, false);
  assert(std::abs(settled.a - 1.0) < 1e-8 && std::abs(settled.b) < 1e-8);

  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, true);
  computerUseCursorPress(&motion, true, 1.01);
  computerUseCursorPress(&motion, false, 1.011);
  assert(area(computerUseCursorSample(&motion, 1.06, false)) < 0.9);
  assert(std::abs(area(computerUseCursorSample(&motion, 2.0, false)) - 1.0) < 1e-6);

  computerUseCursorPress(&motion, true, 2.01);
  assert(std::abs(area(computerUseCursorSample(&motion, 4.0, false)) - 0.49) < 1e-8);
  computerUseCursorPress(&motion, false, 4.0);
  assert(area(computerUseCursorSample(&motion, 5.0, false)) > 0.999);

  computerUseCursorMove(&motion, -100.0, -200.0, 5.016);
  computerUseCursorPress(&motion, true, 5.02);
  const auto reducedPressed = computerUseCursorSample(&motion, 5.05, true);
  assert(reducedPressed.a == 0.7 && reducedPressed.d == 0.7 && reducedPressed.b == 0.0 && reducedPressed.c == 0.0);
  computerUseCursorReset(&motion, -100.0, -200.0, 6.0, true);
  assert(identity(computerUseCursorSample(&motion, 6.0, false)) && !motion.isPressed);

  computerUseCursorMove(&motion, 1000000.0, -1000000.0, 6.0);
  const auto bounded = computerUseCursorSample(&motion, 6.0, false);
  assert(std::isfinite(bounded.a) && area(bounded) > 0.7);
  computerUseCursorMove(&motion, std::numeric_limits<double>::infinity(), 0.0, 6.0);
  computerUseCursorPress(&motion, true, std::numeric_limits<double>::quiet_NaN());
  computerUseCursorMove(&motion, 0.0, 0.0, 5.0);
  assert(std::isfinite(motion.x) && !motion.isPressed);

  ComputerUseCursorMotion scaled{};
  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, true);
  computerUseCursorReset(&scaled, 40.0 * 96.0 / 192.0, 60.0 * 96.0 / 192.0, 1.0, true);
  computerUseCursorMove(&motion, 50.0, 40.0, 1.016);
  computerUseCursorMove(&scaled, 100.0 * 96.0 / 192.0, 80.0 * 96.0 / 192.0, 1.016);
  const auto normalDpi = computerUseCursorSample(&motion, 1.02, false);
  const auto highDpi = computerUseCursorSample(&scaled, 1.02, false);
  assert(normalDpi.a == highDpi.a && normalDpi.b == highDpi.b && normalDpi.c == highDpi.c && normalDpi.d == highDpi.d);

  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, false);
  auto detached = computerUseCursorSample(&motion, 1.0, false);
  assert(detached.a == 0.75 && detached.d == 0.75 && detached.b == 0.0 && detached.c == 0.0);
  computerUseCursorAttach(&motion, true, 1.0);
  const auto halfway = computerUseCursorSample(&motion, 1.1, false);
  assert(std::abs(halfway.a - 0.875) < 1e-7);
  computerUseCursorAttach(&motion, false, 1.1);
  const auto reversed = computerUseCursorSample(&motion, 1.1, false);
  assert(reversed.a == halfway.a && reversed.d == halfway.d);
  computerUseCursorAttach(&motion, false, 1.15);
  assert(std::abs(computerUseCursorSample(&motion, 1.3, false).a - 0.75) < 1e-12);
  computerUseCursorAttach(&motion, true, 1.3);
  assert(computerUseCursorSample(&motion, 1.35, true).a == 1.0);
  assert(std::abs(computerUseCursorSample(&motion, 1.5, false).a - 1.0) < 1e-12);
  computerUseCursorAttach(&motion, false, 1.5);
  computerUseCursorPress(&motion, true, 1.5);
  detached = computerUseCursorSample(&motion, 3.5, false);
  assert(std::abs(detached.a - 0.525) < 1e-8 && area(detached) > 0.27);
  assert(computerUseCursorSample(&motion, 3.5, true).a == 0.75 * 0.7);
  computerUseCursorAttach(&motion, true, 1.0);
  computerUseCursorAttach(&motion, true, std::numeric_limits<double>::quiet_NaN());
  assert(!motion.isAttached && std::isfinite(computerUseCursorSample(&motion, 2.1, false).a));

  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, true);
  computerUseCursorPress(&motion, true, 1.0);
  assert(std::abs(computerUseCursorSample(&motion, 1.1, false).a - 0.8006462541072339) < 1e-12);
  const double beforeRelease = motion.pressAmount, beforeVelocity = motion.pressVelocity;
  computerUseCursorPress(&motion, false, 1.1);
  assert(motion.pressAmount == beforeRelease && motion.pressVelocity == beforeVelocity);
  assert(std::abs(computerUseCursorSample(&motion, 1.8, false).a - 1.0) < 1e-5);
  computerUseCursorReset(&motion, 20.0, 30.0, 1.0, true);
  computerUseCursorPress(&motion, true, 1.0);
  computerUseCursorPress(&motion, false, 1.001);
  scaled = motion;
  const auto coarsePulse = computerUseCursorSample(&motion, 1.2, false);
  for (int i = 1; i <= 199; ++i) computerUseCursorSample(&scaled, 1.001 + i * 0.001, false);
  const auto finePulse = computerUseCursorSample(&scaled, 1.2, false);
  assert(std::abs(coarsePulse.a - finePulse.a) < 1e-12);

  std::array<uint8_t, 32 * 32 * 4> source{}, destination{};
  for (int y = 9; y <= 13; ++y) for (int x = 9; x <= 13; ++x) {
    const auto pixel = (y * 32 + x) * 4;
    source[pixel] = 40; source[pixel + 1] = 80;
    source[pixel + 2] = 100; source[pixel + 3] = 128;
  }
  computerUseCursorTransformPixels(source.data(), destination.data(), 32, 11, 11, {1.0, 0.0, 0.0, 1.0});
  assert(source == destination);
  computerUseCursorTransformPixels(source.data(), destination.data(), 32, 11, 11, moving);
  assert(source != destination);
  const auto hotspot = (11 * 32 + 11) * 4;
  for (int channel = 0; channel < 4; ++channel) assert(destination[hotspot + channel] == source[hotspot + channel]);
  for (size_t pixel = 0; pixel < destination.size(); pixel += 4)
    for (size_t channel = 0; channel < 3; ++channel) assert(destination[pixel + channel] <= destination[pixel + 3]);
  assert(destination[3] == 0 && destination.back() == 0);
  computerUseCursorTransformPixels(source.data(), destination.data(), 32, 11, 11, detached);
  for (int channel = 0; channel < 4; ++channel) assert(destination[hotspot + channel] == source[hotspot + channel]);
  assert(destination[3] == 0 && destination.back() == 0);
  std::puts("RESULT passed=19 failed=0");
}
