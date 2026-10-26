#pragma once

// Lime private helper protocol. No corresponding public upstream implementation
// is available. Keep parsing and cancellation independent of Win32 for testing.
#include <atomic>
#include <charconv>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <istream>
#include <limits>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace native_protocol {

constexpr size_t kMaxFrameBytes = 1024 * 1024;

// Drain an oversized frame without retaining it, then allow the next frame.
// EOF without a newline is not a complete protocol message.
inline bool readFrame(std::istream& input, std::string& frame) {
  frame.clear();
  bool oversized = false;
  char ch = 0;
  while (input.get(ch)) {
    if (ch == '\n') {
      if (oversized) throw std::length_error("Frame is too large");
      return true;
    }
    if (frame.size() < kMaxFrameBytes) frame += ch;
    else oversized = true;
  }
  if (!frame.empty() || oversized) throw std::invalid_argument("Incomplete JSONL frame");
  return false;
}

class InvalidRequest : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

struct Json {
  enum class Kind { Null, Boolean, Number, String, Array, Object };
  Kind kind = Kind::Null;
  std::string text;
  bool boolean = false;
  std::vector<Json> array;
  std::map<std::string, Json> object;

  const Json* find(const std::string& key) const {
    if (kind != Kind::Object) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &found->second;
  }

  const Json& get(const std::string& key) const {
    const auto* value = find(key);
    if (!value) throw InvalidRequest("Missing object field: " + key);
    return *value;
  }

  const std::string& string() const {
    if (kind != Kind::String) throw InvalidRequest("Expected a string");
    return text;
  }

  uint64_t unsignedInteger() const {
    uint64_t value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (kind != Kind::Number || text.empty() || result.ec != std::errc{} ||
        result.ptr != text.data() + text.size()) {
      throw InvalidRequest("Expected an exact unsigned 64-bit integer");
    }
    return value;
  }

  double number() const {
    if (kind != Kind::Number) throw InvalidRequest("Expected a number");
    try {
      const double value = std::stod(text);
      if (std::isfinite(value)) return value;
    } catch (const std::exception&) {}
    throw InvalidRequest("Number is outside finite bounds");
  }
};

class JsonParser {
 public:
  static Json parse(const std::string& frame) {
    if (frame.size() > kMaxFrameBytes) throw InvalidRequest("Frame is too large");
    JsonParser parser(frame);
    Json result = parser.value(0);
    parser.whitespace();
    if (parser.offset_ != frame.size()) throw InvalidRequest("Trailing JSON data");
    return result;
  }

 private:
  explicit JsonParser(const std::string& source) : source_(source) {}

  void whitespace() {
    while (offset_ < source_.size() &&
           (source_[offset_] == ' ' || source_[offset_] == '\t' ||
            source_[offset_] == '\r' || source_[offset_] == '\n')) ++offset_;
  }

  char take() {
    if (offset_ >= source_.size()) throw InvalidRequest("Incomplete JSON");
    return source_[offset_++];
  }

  bool consume(char expected) {
    if (offset_ < source_.size() && source_[offset_] == expected) {
      ++offset_;
      return true;
    }
    return false;
  }

  void expect(char expected) {
    if (take() != expected) throw InvalidRequest("Unexpected JSON token");
  }

  uint32_t hexQuad() {
    uint32_t result = 0;
    for (int i = 0; i < 4; ++i) {
      const char digit = take();
      result <<= 4;
      if (digit >= '0' && digit <= '9') result |= digit - '0';
      else if (digit >= 'a' && digit <= 'f') result |= digit - 'a' + 10;
      else if (digit >= 'A' && digit <= 'F') result |= digit - 'A' + 10;
      else throw InvalidRequest("Invalid Unicode escape");
    }
    return result;
  }

  static void appendUtf8(std::string& result, uint32_t point) {
    if (point < 0x80) result += static_cast<char>(point);
    else if (point < 0x800) {
      result += static_cast<char>(0xc0 | (point >> 6));
      result += static_cast<char>(0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      result += static_cast<char>(0xe0 | (point >> 12));
      result += static_cast<char>(0x80 | ((point >> 6) & 0x3f));
      result += static_cast<char>(0x80 | (point & 0x3f));
    } else {
      result += static_cast<char>(0xf0 | (point >> 18));
      result += static_cast<char>(0x80 | ((point >> 12) & 0x3f));
      result += static_cast<char>(0x80 | ((point >> 6) & 0x3f));
      result += static_cast<char>(0x80 | (point & 0x3f));
    }
  }

  std::string string() {
    expect('"');
    std::string result;
    while (true) {
      const auto ch = static_cast<unsigned char>(take());
      if (ch == '"') return result;
      if (ch < 0x20) throw InvalidRequest("Unescaped control character");
      if (ch == '\\') {
        switch (take()) {
          case '"': result += '"'; break;
          case '\\': result += '\\'; break;
          case '/': result += '/'; break;
          case 'b': result += '\b'; break;
          case 'f': result += '\f'; break;
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          case 'u': {
            uint32_t point = hexQuad();
            if (point >= 0xd800 && point <= 0xdbff) {
              expect('\\');
              expect('u');
              const uint32_t low = hexQuad();
              if (low < 0xdc00 || low > 0xdfff) throw InvalidRequest("Invalid surrogate pair");
              point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
            } else if (point >= 0xdc00 && point <= 0xdfff) {
              throw InvalidRequest("Unpaired low surrogate");
            }
            appendUtf8(result, point);
            break;
          }
          default: throw InvalidRequest("Invalid string escape");
        }
      } else if (ch < 0x80) {
        result += static_cast<char>(ch);
      } else {
        const size_t start = offset_ - 1;
        const int count = ch >= 0xc2 && ch <= 0xdf ? 1 :
                          ch >= 0xe0 && ch <= 0xef ? 2 :
                          ch >= 0xf0 && ch <= 0xf4 ? 3 : 0;
        if (!count) throw InvalidRequest("Invalid UTF-8 lead byte");
        uint32_t point = ch & (0x7f >> (count + 1));
        for (int i = 0; i < count; ++i) {
          const auto next = static_cast<unsigned char>(take());
          if ((next & 0xc0) != 0x80) throw InvalidRequest("Invalid UTF-8 continuation");
          point = (point << 6) | (next & 0x3f);
        }
        const uint32_t minimum = count == 1 ? 0x80 : count == 2 ? 0x800 : 0x10000;
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
          throw InvalidRequest("Invalid UTF-8 scalar");
        result.append(source_, start, offset_ - start);
      }
    }
  }

  Json value(size_t depth) {
    if (depth > 32 || ++nodes_ > 16384) throw InvalidRequest("JSON complexity limit exceeded");
    whitespace();
    if (offset_ >= source_.size()) throw InvalidRequest("Missing JSON value");
    Json result;
    const char next = source_[offset_];
    if (next == '"') {
      result.kind = Json::Kind::String;
      result.text = string();
    } else if (next == '{' || next == '[') {
      const bool object = take() == '{';
      const char end = object ? '}' : ']';
      result.kind = object ? Json::Kind::Object : Json::Kind::Array;
      whitespace();
      if (consume(end)) return result;
      do {
        whitespace();
        if (object) {
          const std::string key = string();
          whitespace();
          expect(':');
          if (!result.object.emplace(key, value(depth + 1)).second)
            throw InvalidRequest("Duplicate JSON object key");
        } else result.array.push_back(value(depth + 1));
        whitespace();
        if (consume(end)) return result;
      } while (consume(','));
      throw InvalidRequest("Invalid JSON container");
    } else if (next == 'n' || next == 't' || next == 'f') {
      const std::string literal = next == 'n' ? "null" : next == 't' ? "true" : "false";
      for (char ch : literal) expect(ch);
      result.kind = next == 'n' ? Json::Kind::Null : Json::Kind::Boolean;
      result.boolean = next == 't';
    } else {
      result.kind = Json::Kind::Number;
      const size_t start = offset_;
      consume('-');
      if (!consume('0')) digits();
      if (consume('.')) digits();
      if (consume('e') || consume('E')) {
        if (!consume('+')) consume('-');
        digits();
      }
      result.text = source_.substr(start, offset_ - start);
    }
    return result;
  }

  void digits() {
    const size_t start = offset_;
    while (offset_ < source_.size() && source_[offset_] >= '0' && source_[offset_] <= '9') ++offset_;
    if (offset_ == start) throw InvalidRequest("Invalid JSON number");
  }

  const std::string& source_;
  size_t offset_ = 0;
  size_t nodes_ = 0;
};

struct Request {
  std::string id;
  std::string method;
  Json params;
  uint64_t cancellationEpoch = 0;
  uint64_t physicalInputEpoch = 0;

  static Request parse(const std::string& frame) {
    const Json envelope = JsonParser::parse(frame);
    Request result;
    result.id = envelope.get("id").string();
    result.method = envelope.get("method").string();
    if (result.id.empty() || result.id.size() > 512 || result.method.empty() || result.method.size() > 128)
      throw InvalidRequest("Invalid request id or method length");
    for (const auto& entry : envelope.object)
      if (entry.first != "id" && entry.first != "method" && entry.first != "params")
        throw InvalidRequest("Unknown request envelope field");
    if (const auto* params = envelope.find("params")) result.params = *params;
    else result.params.kind = Json::Kind::Object;
    if (result.params.kind != Json::Kind::Object) throw InvalidRequest("params must be an object");
    return result;
  }
};

// stdin owns enqueue/cancel. The COM/action thread owns dispatch. A request keeps
// its enqueue epoch so cancellation also fences work not yet started.
class RequestQueue {
 public:
  using PhysicalInputEpoch = std::function<uint64_t()>;
  explicit RequestQueue(PhysicalInputEpoch physicalInputEpoch = [] { return uint64_t(0); })
      : physicalInputEpoch_(std::move(physicalInputEpoch)) {}

  bool push(Request request) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_ || pending_.size() >= 64) return false;
    request.cancellationEpoch = epoch_.load();
    request.physicalInputEpoch = physicalInputEpoch_();
    pending_.push_back(std::move(request));
    available_.notify_one();
    return true;
  }

  std::optional<Request> next() {
    std::unique_lock<std::mutex> lock(mutex_);
    available_.wait(lock, [&] { return closed_ || !pending_.empty(); });
    if (pending_.empty()) return std::nullopt;
    Request request = std::move(pending_.front());
    pending_.pop_front();
    return request;
  }

  void cancel() {
    std::lock_guard<std::mutex> lock(mutex_);
    advanceEpoch();
  }

  bool canceled(const Request& request, bool includePhysicalInput = true) const {
    const auto physical = includePhysicalInput ? physicalInputEpoch_() : uint64_t(0);
    return exhausted_.load() || epoch_.load() != request.cancellationEpoch ||
        (includePhysicalInput && (physical == UINT64_MAX || physical != request.physicalInputEpoch));
  }

  bool intervened(const Request& request) const {
    const auto physical = physicalInputEpoch_();
    return physical == UINT64_MAX || physical != request.physicalInputEpoch;
  }

  void close() {
    std::lock_guard<std::mutex> lock(mutex_);
    closed_ = true;
    advanceEpoch();
    available_.notify_all();
  }

 private:
  void advanceEpoch() {
    if (epoch_.load() == std::numeric_limits<uint64_t>::max()) exhausted_ = true;
    else ++epoch_;
  }

  mutable std::mutex mutex_;
  std::condition_variable available_;
  std::deque<Request> pending_;
  std::atomic<uint64_t> epoch_{0};
  std::atomic<bool> exhausted_{false};
  PhysicalInputEpoch physicalInputEpoch_;
  bool closed_ = false;
};

// COM stays on the calling thread. Only frame ingestion and cancellation run on
// the reader thread. Error/output callbacks must serialize their own writes.
template <typename Dispatch, typename Reject>
void serve(std::istream& input, Dispatch dispatch, Reject reject,
           RequestQueue::PhysicalInputEpoch physicalInputEpoch = [] { return uint64_t(0); },
           std::function<void()> onCancel = [] {}) {
  // cin's default tie would flush cout on the reader thread outside the output
  // mutex, racing response writers after sync_with_stdio(false).
  input.tie(nullptr);
  RequestQueue requests(std::move(physicalInputEpoch));
  std::thread reader([&] {
    std::string line;
    while (true) {
      try {
        if (!readFrame(input, line)) break;
        Request request = Request::parse(line);
        // One-way: never insert a cancel response id into an active action's
        // response stream. This matches the trusted Rust NativeHost client.
        if (request.method == "computerUse.cancel") { requests.cancel(); onCancel(); }
        else if (!requests.push(request))
          reject(request.id, "busy", "Windows native host request queue is full.");
      } catch (const std::exception&) {
        requests.cancel();
        onCancel();
        reject("", "invalid_request", "Invalid or oversized Windows native host JSONL request.");
        if (!input) break;
      }
    }
    requests.close();
    onCancel();
  });
  while (auto request = requests.next()) {
    try {
      if ((request->method == "computerUse.execute" || request->method == "computerUse.setup") &&
          requests.canceled(*request)) {
        const bool intervention = request->method == "computerUse.execute" && requests.intervened(*request);
        reject(request->id, intervention ? "user_intervened" : "canceled",
            "Computer Use request was interrupted before execution.");
        continue;
      }
      dispatch(*request, requests);
    } catch (const InvalidRequest& error) {
      reject(request->id, "invalid_argument", error.what());
    } catch (const std::exception&) {
      reject(request->id, "operation_failed", "Windows native host request failed.");
    }
  }
  reader.join();
}

}  // namespace native_protocol
