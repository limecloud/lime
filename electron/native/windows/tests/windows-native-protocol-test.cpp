#include "../windows-native-protocol.h"
#include "../windows-computer-use-input.h"

#include <chrono>
#include <future>
#include <functional>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <thread>

using namespace native_protocol;

namespace {
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

void rejects(const std::function<void()>& action) {
  try { action(); }
  catch (const std::exception&) { return; }
  throw std::runtime_error("Invalid input was accepted");
}

Request request(const std::string& method = "computerUse.execute") {
  return Request::parse("{\"id\":\"test\",\"method\":\"" + method + "\",\"params\":{}}");
}
}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--serve") {
    // Test-only bounded action. The framing, queue and cancellation are the
    // production transport used by the Win32 helper, without COM or OS input.
    std::mutex output;
    auto emit = [&](const std::string& line) {
      std::lock_guard<std::mutex> lock(output);
      std::cout << line << std::endl;
    };
    serve(std::cin, [&](const Request& request, const RequestQueue& queue) {
      std::ostringstream response;
      response << "{\"id\":" << std::quoted(request.id);
      if (request.method == "computerUse.execute") {
        emit("{\"event\":\"started\"}");
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (!queue.canceled(request) && std::chrono::steady_clock::now() < deadline)
          std::this_thread::yield();
        require(queue.canceled(request), "In-flight action did not observe cancellation");
        response << ",\"outcome\":\"canceled\"}";
      } else response << ",\"outcome\":\"observed\"}";
      emit(response.str());
    }, [&](const std::string& id, const std::string& code, const std::string&) {
      std::ostringstream response;
      response << "{\"id\":" << std::quoted(id) << ",\"error\":" << std::quoted(code) << "}";
      emit(response.str());
    });
    return 0;
  }
  int passed = 0;
  int failed = 0;
  auto test = [&](const char* name, const std::function<void()>& run) {
    try {
      run();
      ++passed;
      std::cout << "PASS " << name << '\n';
    } catch (const std::exception& error) {
      ++failed;
      std::cerr << "FAIL " << name << ": " << error.what() << '\n';
    }
  };

  test("Unicode escape and literal roundtrip", [] {
    const auto decoded = JsonParser::parse(R"({"text":"\u4e2d\u6587\ud83d\ude80\b\f\n\r\t\\\"\/","literal":"中文🚀"})");
    require(decoded.get("text").string() == u8"中文🚀\b\f\n\r\t\\\"/", "Unicode decoding mismatch");
    require(decoded.get("literal").string() == u8"中文🚀", "UTF-8 literal mismatch");
    require(JsonParser::parse(R"("\u0000")").string().size() == 1, "NUL escape was truncated");
  });

  test("Reject invalid UTF-8 and unpaired surrogates", [] {
    for (const auto* bad : {R"("\ud800")", R"("\udc00")", R"("\ud800\u0041")", R"("\u12xz")", R"("\x20")"})
      rejects([&] { JsonParser::parse(bad); });
    for (const std::string& bytes : {std::string("\xc0\xaf"), std::string("\xe0\x80\xaf"),
                                  std::string("\xed\xa0\x80"), std::string("\xf4\x90\x80\x80"),
                                  std::string("\x80"), std::string("\xf0\x9f")})
      rejects([&] { JsonParser::parse("\"" + bytes + "\""); });
    rejects([] { JsonParser::parse(std::string("\"a\n\"")); });
  });

  test("Exact integer bounds preserve HWND and fence", [] {
    const auto parsed = JsonParser::parse(R"({"handle":9007199254740993,"fence":18446744073709551615})");
    require(parsed.get("handle").unsignedInteger() == 9007199254740993ULL, "Integer rounded to double");
    require(parsed.get("fence").unsignedInteger() == UINT64_MAX, "Maximum fence corrupted");
    for (const auto* bad : {"18446744073709551616", "-1", "1.0", "1e0", "true", "null", "\"42\""})
      rejects([&] { JsonParser::parse(bad).unsignedInteger(); });
    rejects([] { JsonParser::parse("1e999").number(); });
    require(JsonParser::parse("-1.25e2").number() == -125, "Finite coordinate corrupted");
  });

  test("Reject malformed JSON numbers containers and trailing data", [] {
    for (const auto* bad : {"", "+1", "01", "--1", "1.", ".1", "1e", "1e+-1", "NaN", "Infinity",
                            "{}{}", "[1,]", "{\"x\":1,}", "{\"x\" 1}", "tru", "[", "\"unterminated"})
      rejects([&] { JsonParser::parse(bad); });
    const auto parsed = JsonParser::parse(" \r\n{\"a\":[null,true,false,-1.5e+2]}\t");
    require(parsed.get("a").array.size() == 4, "Valid JSON values lost");
  });

  test("Duplicate keys including escaped aliases fail closed", [] {
    for (const auto* bad : {R"({"method":"safe","method":"unsafe"})", R"({"id":1,"\u0069d":2})",
                            R"({"target":{"processId":1,"processId":2}})"})
      rejects([&] { JsonParser::parse(bad); });
  });

  test("Envelope fields cannot be supplied by nested objects or string contents", [] {
    for (const auto* bad : {R"({"nested":{"id":"x","method":"computerUse.cancel"}})",
                            R"({"id":"x","params":{"method":"computerUse.cancel"}})",
                            R"({"id":1,"method":"safe"})", R"({"id":"x","method":null})",
                            R"({"id":"x","method":"safe","params":[]})",
                            R"({"id":"x","method":"safe","windowHandle":42})"})
      rejects([&] { Request::parse(bad); });
    const auto parsed = Request::parse(R"({"id":"x","method":"windows.uiAutomation.read","params":{"nested":{"windowHandle":42},"text":"\"method\":\"computerUse.cancel\""}})");
    require(parsed.method == "windows.uiAutomation.read", "Nested method spoofed envelope");
    require(!parsed.params.find("windowHandle"), "Nested handle escaped params boundary");
    require(request().params.kind == Json::Kind::Object, "Empty params changed shape");
    require(Request::parse(R"({"id":"x","method":"safe"})").params.kind == Json::Kind::Object, "Missing params default is invalid");
  });

  test("Frame and JSON complexity bounds", [] {
    rejects([] { JsonParser::parse(std::string(kMaxFrameBytes + 1, ' ')); });
    rejects([] { JsonParser::parse(std::string(34, '[') + "0" + std::string(34, ']')); });
    std::string nodes = "[0";
    for (int i = 0; i < 16384; ++i) nodes += ",0";
    nodes += ']';
    rejects([&] { JsonParser::parse(nodes); });
  });

  test("Oversized frames drain without swallowing the next request", [] {
    std::istringstream input(std::string(kMaxFrameBytes + 50, 'x') + "\n{\"id\":\"next\",\"method\":\"safe\"}\n");
    std::string frame;
    rejects([&] { readFrame(input, frame); });
    require(frame.size() == kMaxFrameBytes, "Oversized input retained without a bound");
    require(readFrame(input, frame), "Next frame lost");
    require(Request::parse(frame).id == "next", "Frame boundary corrupted");
    require(!readFrame(input, frame), "EOF not reported");
    std::istringstream truncated("{\"id\":\"x\",\"method\":\"safe\"}");
    rejects([&] { readFrame(truncated, frame); });
  });

  test("Cancel fences running and previously queued work but allows new work", [] {
    RequestQueue queue;
    queue.push(request());
    const auto running = queue.next();
    require(running.has_value(), "No active request");
    queue.push(request());
    queue.cancel();
    require(queue.canceled(*running), "Active request ignored cancel");
    require(queue.canceled(*queue.next()), "Queued request acquired a fresh epoch");
    queue.push(request());
    require(!queue.canceled(*queue.next()), "Fresh request remained permanently canceled");
  });

  test("Full queue cannot prevent cancellation", [] {
    RequestQueue queue;
    for (int i = 0; i < 64; ++i) require(queue.push(request()), "Queue filled too early");
    require(!queue.push(request()), "Queue exceeded its bound");
    queue.cancel();
    for (int i = 0; i < 64; ++i) require(queue.canceled(*queue.next()), "Full queue ignored cancel");
  });

  test("Physical takeover cancels active and queued requests without renewing their epoch", [] {
    std::atomic<uint64_t> physical{4};
    RequestQueue queue([&] { return physical.load(); });
    queue.push(request());
    const auto active = *queue.next();
    queue.push(request());
    queue.push(request("computerUse.setup"));
    ++physical;
    require(queue.canceled(active), "In-flight request ignored physical input");
    require(queue.canceled(*queue.next()), "Queued action acquired a fresh physical epoch");
    require(queue.canceled(*queue.next()), "Old queued consent survived takeover");
    queue.push(request());
    require(!queue.canceled(*queue.next()), "New request could not use current physical epoch");
  });

  test("Turn input fence keeps takeover across newly enqueued actions and requires a new turn", [] {
    computer_use::TurnInputFence fence;
    require(fence.check("turn-a", 4), "Initial action failed");
    require(fence.check("turn-a", 4), "Own injected input changed the physical epoch");
    require(!fence.check("turn-a", 5), "Physical input did not interrupt the turn");
    require(!fence.check("turn-a", 5), "New request silently resumed the interrupted turn");
    require(fence.check("explicit-new-turn", 5), "Explicit new turn could not observe again");
    require(!fence.check("turn-a", 5), "Interleaving a different turn revived interrupted work");
    require(fence.check("explicit-new-turn", 5), "Interleaving invalidated the new turn");
    require(!fence.check("explicit-new-turn", UINT64_MAX), "Unhealthy monitor admitted input");
    require(!fence.check("another-turn", 6), "A recovered monitor revived the old helper session");
    computer_use::TurnInputFence bounded;
    for (int i = 0; i < 1024; ++i) require(bounded.check(std::to_string(i), 0), "Fence exhausted too early");
    require(!bounded.check("overflow", 0) && !bounded.available(), "Owner history grew without a bound");
    require(!bounded.check("0", 0), "Exhaustion revived an old turn");
  });

  test("Active consent allows physical approval but never bypasses explicit cancel or EOF", [] {
    std::atomic<uint64_t> physical{0};
    RequestQueue queue([&] { return physical.load(); });
    queue.push(request("computerUse.setup"));
    const auto consent = *queue.next();
    ++physical;
    require(queue.canceled(consent), "Physical event was not observed");
    require(!queue.canceled(consent, false), "Approval click canceled its own consent dialog");
    queue.cancel();
    require(queue.canceled(consent, false), "Consent ignored explicit cancellation");
    queue.push(request("computerUse.setup"));
    const auto next = *queue.next();
    queue.close();
    require(queue.canceled(next, false), "Consent ignored EOF cancellation");
  });

  test("Unhealthy or exhausted physical monitor fails closed and cannot revive old work", [] {
    std::atomic<uint64_t> physical{0};
    RequestQueue queue([&] { return physical.load(); });
    queue.push(request());
    const auto active = *queue.next();
    physical = UINT64_MAX;
    require(queue.canceled(active), "Unhealthy monitor left active input enabled");
    queue.push(request());
    const auto unhealthy = *queue.next();
    require(queue.canceled(unhealthy), "Unhealthy monitor admitted new input");
    physical = 1;
    require(queue.canceled(active), "Monitor recovery revived an old active request");
    require(queue.canceled(unhealthy), "Monitor recovery revived unhealthy queued work");
    queue.push(request());
    require(!queue.canceled(*queue.next()), "Healthy monitor could not admit a fresh request");
  });

  test("EOF cancels pending work and releases a waiting dispatcher", [] {
    RequestQueue pending;
    pending.push(request());
    pending.close();
    require(pending.canceled(*pending.next()), "EOF did not fence queued action");
    require(!pending.next(), "Closed queue did not drain");
    require(!pending.push(request()), "EOF allowed new requests");
    RequestQueue waiting;
    auto next = std::async(std::launch::async, [&] { return waiting.next(); });
    waiting.close();
    require(next.wait_for(std::chrono::seconds(2)) == std::future_status::ready, "Dispatcher remained blocked after EOF");
    require(!next.get(), "Closed empty queue produced work");
  });

  test("Transport treats cancel as one-way without a spurious response", [] {
    std::istringstream input("{\"id\":\"cancel\",\"method\":\"computerUse.cancel\",\"params\":{}}\n");
    int dispatched = 0;
    int rejected = 0;
    int indicatorStops = 0;
    serve(input, [&](const Request&, const RequestQueue&) { ++dispatched; },
          [&](const std::string&, const std::string&, const std::string&) { ++rejected; },
          [] { return uint64_t(0); }, [&] { ++indicatorStops; });
    require(dispatched == 0 && rejected == 0, "Cancel entered the normal response stream");
    require(indicatorStops == 2, "Cancel and EOF did not both stop the indicator");
  });

  std::cout << "RESULT passed=" << passed << " failed=" << failed << '\n';
  return failed ? 1 : 0;
}
