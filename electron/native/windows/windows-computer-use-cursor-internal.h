#pragma once

#include "windows-computer-use.h"

namespace computer_use {

class CursorVisibility {
 public:
  CursorVisibility();
  ~CursorVisibility();
  bool ready() const { return initialized_; }
  bool show(bool visible) const { return initialized_ && show_(visible ? TRUE : FALSE); }
 private:
  HMODULE library_ = nullptr;
  using Initialize = BOOL(WINAPI*)();
  using Show = BOOL(WINAPI*)(BOOL);
  Initialize uninitialize_ = nullptr;
  Show show_ = nullptr;
  bool initialized_ = false;
};

struct alignas(8) CursorRecoveryState {
  volatile LONG active = 0;
  volatile LONG initialized = 0;
  alignas(8) volatile LONG64 deadline = 0;
};

class CursorRecovery {
 public:
  CursorRecovery();
  ~CursorRecovery();
  bool ready() const;
  bool arm(bool refresh);
  void disarm();
 private:
  Handle mapping_, wake_, started_, process_;
  CursorRecoveryState* state_ = nullptr;
};

}  // namespace computer_use
