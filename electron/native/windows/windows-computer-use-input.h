#pragma once

#include <atomic>
#include <cstdint>
#include <future>
#include <thread>
#include <string>
#include <map>

namespace computer_use {

// The action thread retains the first physical epoch across all requests of a
// trusted turn. Enqueueing another action cannot silently resume that turn.
class TurnInputFence {
 public:
  bool check(const std::string& owner, uint64_t epoch) {
    if (epoch == UINT64_MAX) unhealthy_ = true;
    auto found = epochs_.find(owner);
    if (found == epochs_.end()) {
      // Bound memory without ever reviving a late request by evicting its turn.
      if (epochs_.size() >= 1024) unhealthy_ = true;
      else found = epochs_.emplace(owner, epoch).first;
    }
    return !unhealthy_ && found != epochs_.end() && found->second == epoch;
  }
  bool available() const { return !unhealthy_; }
 private:
  std::map<std::string, uint64_t> epochs_;
  bool unhealthy_ = false;
};

// Observe only intervention metadata. No keystrokes are retained or suppressed.
// SendInput-generated events do not count as physical user intervention.
class InputMonitor {
 public:
  InputMonitor();
  ~InputMonitor();
  InputMonitor(const InputMonitor&) = delete;
  InputMonitor& operator=(const InputMonitor&) = delete;

  bool ready() const;
  uint64_t epoch() const;

 private:
  void run(std::promise<void> started);
  void physicalInput();
  struct Hooks;
  std::atomic<uint64_t> epoch_{0};
  std::atomic<uint64_t> heartbeat_{0};
  std::atomic<unsigned long> threadId_{0};
  std::atomic<bool> ready_{false};
  std::atomic<bool> stopped_{false};
  mutable std::atomic<bool> unhealthy_{false};
  std::thread thread_;
};

}  // namespace computer_use
