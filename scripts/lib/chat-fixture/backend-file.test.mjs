import assert from "node:assert/strict";
import test from "node:test";
import { startTextProviderFixtureServer } from "./backend-file.mjs";
import { FIXTURE_MODEL, TEXT_PROVIDER_FIXTURE_API_KEY } from "./constants.mjs";

test("text provider observes request markers without exposing raw payloads or credentials", async () => {
  const fixture = await startTextProviderFixtureServer({
    requestMarkers: ["marker-present", "marker-absent"],
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TEXT_PROVIDER_FIXTURE_API_KEY}`,
      },
      body: JSON.stringify({
        model: FIXTURE_MODEL,
        messages: [
          { role: "user", content: "marker-present private-payload-value" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    await response.text();
    const requests = fixture.requests();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].bodyMarkers, {
      "marker-present": true,
      "marker-absent": false,
    });
    assert.equal(requests[0].bodySummary.messages[0].role, "user");
    assert.equal("body" in requests[0], false);
    assert.equal("headers" in requests[0], false);
    assert.equal(
      JSON.stringify(requests).includes("private-payload-value"),
      false,
    );
    assert.equal(
      JSON.stringify(requests).includes(TEXT_PROVIDER_FIXTURE_API_KEY),
      false,
    );
  } finally {
    await fixture.close();
  }
});
