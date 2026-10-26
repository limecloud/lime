#pragma once

#include "windows-computer-use.h"

namespace computer_use {

// Product-owned input indicator. It never changes the user's cursor scheme.
class Pointer {
 public:
  Pointer(const InputMonitor& input, HANDLE issuer);
  ~Pointer();
  Pointer(const Pointer&) = delete;
  Pointer& operator=(const Pointer&) = delete;
  bool begin(const Target& target, const std::string& owner);
  bool show(const Target& target, POINT point, bool pressed);
  void detach();
  void finish(const std::string& owner);
  void stop();

 private:
  struct State;
  std::unique_ptr<State> state_;
};

std::optional<int> runPointerRecovery(int argc, char** argv);

}  // namespace computer_use
