import { describe, expect, it, vi } from "vitest";
import type { RealtimeVoiceClientSecret } from "@/lib/api/realtimeVoice";
import { RealtimeVoiceSession } from "./realtimeVoiceSession";

class FakeDataChannel {
  readonly label: string;
  readyState: globalThis.RTCDataChannelState = "connecting";
  private readonly listeners = new Map<
    string,
    Set<(event: { data?: unknown; target?: unknown }) => void>
  >();

  constructor(label: string) {
    this.label = label;
  }

  addEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    this.listeners.get(type)?.delete(listener as (event: never) => void);
  }

  emit(type: string, event: { data?: unknown; target?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }

  close() {
    this.readyState = "closed";
    this.emit("close");
  }

  send() {}
}

class FakePeerConnection {
  iceGatheringState: globalThis.RTCIceGatheringState = "complete";
  connectionState: globalThis.RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  readonly dataChannel: FakeDataChannel;
  readonly addedTracks: MediaStreamTrack[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    this.dataChannel = new FakeDataChannel("oai-events");
  }

  addEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as () => void);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    this.listeners.get(type)?.delete(listener as () => void);
  }

  emitConnectionState(state: globalThis.RTCPeerConnectionState) {
    this.connectionState = state;
    for (const listener of this.listeners.get("connectionstatechange") ?? []) {
      listener();
    }
  }

  createDataChannel(label: string) {
    expect(label).toBe("oai-events");
    return this.dataChannel as unknown as RTCDataChannel;
  }

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);
    return {} as RTCRtpSender;
  }

  async createOffer() {
    return {
      type: "offer",
      sdp: "v=0\r\noffer",
    } as globalThis.RTCSessionDescriptionInit;
  }

  async setLocalDescription(description: globalThis.RTCSessionDescriptionInit) {
    this.localDescription = {
      type: description.type,
      sdp: description.sdp ?? "",
      toJSON: () => description,
    } as RTCSessionDescription;
  }

  async setRemoteDescription(
    description: globalThis.RTCSessionDescriptionInit,
  ) {
    this.remoteDescription = {
      type: description.type,
      sdp: description.sdp ?? "",
      toJSON: () => description,
    } as RTCSessionDescription;
  }

  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
}

const SECRET: RealtimeVoiceClientSecret = {
  clientSecret: "ek_renderer_ephemeral",
  expiresAt: 1_893_456_000,
  model: "gpt-realtime-2.1",
  voice: "marin",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
  providerId: "openai",
};

function createHarness(
  overrides: Partial<
    ConstructorParameters<typeof RealtimeVoiceSession>[0]
  > = {},
) {
  const peer = new FakePeerConnection();
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const microphone = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  const audio = {
    autoplay: false,
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    setAttribute: vi.fn(),
  } as unknown as HTMLAudioElement;
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "v=0\r\nanswer",
  });
  const session = new RealtimeVoiceSession({
    mintClientSecret: vi.fn().mockResolvedValue(SECRET),
    getUserMedia: vi.fn().mockResolvedValue(microphone),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    createAudioElement: () => audio,
    iceGatheringTimeoutMs: 100,
    sessionStartTimeoutMs: 5_000,
    ...overrides,
  });
  return { session, peer, track, audio, fetchImpl };
}

function emitMessage(peer: FakePeerConnection, payload: unknown) {
  peer.dataChannel.emit("message", { data: JSON.stringify(payload) });
}

describe("RealtimeVoiceSession", () => {
  it("starts only from real lifecycle events and posts the SDP with the ephemeral secret", async () => {
    const { session, peer, track, fetchImpl } = createHarness();

    expect(session.getSnapshot()).toMatchObject({
      state: "idle",
      transcripts: [],
      error: null,
    });

    await session.start();

    expect(session.getSnapshot().state).toBe("connecting");
    expect(session.getSnapshot().transcripts).toEqual([]);
    expect(peer.addedTracks).toEqual([track]);
    expect(fetchImpl).toHaveBeenCalledWith(
      SECRET.callsUrl,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: "v=0\r\n offer".replace("\r\n ", "\r\n"),
      }),
    );
    expect(peer.remoteDescription).toMatchObject({
      type: "answer",
      sdp: "v=0\r\nanswer",
    });

    emitMessage(peer, { type: "session.created", session: { id: "sess_1" } });
    expect(session.getSnapshot()).toMatchObject({
      state: "connected",
      sessionId: "sess_1",
      model: "gpt-realtime-2.1",
      voice: "marin",
    });
  });

  it("streams real transcript deltas and errors without faking audio events", async () => {
    const { session, peer } = createHarness();
    await session.start();
    emitMessage(peer, { type: "session.started" });

    emitMessage(peer, {
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "user-1",
      delta: "Hello",
    });
    emitMessage(peer, {
      type: "response.output_audio_transcript.delta",
      item_id: "assistant-1",
      delta: "Hi ",
    });
    emitMessage(peer, {
      type: "response.output_audio_transcript.delta",
      item_id: "assistant-1",
      delta: "there",
    });
    emitMessage(peer, {
      type: "response.output_audio_transcript.done",
      item_id: "assistant-1",
    });
    emitMessage(peer, { type: "error", error: { message: "bad event" } });

    expect(session.getSnapshot().transcripts).toEqual([
      {
        id: "user:user-1",
        role: "user",
        text: "Hello",
        final: false,
      },
      {
        id: "assistant:assistant-1",
        role: "assistant",
        text: "Hi there",
        final: true,
      },
    ]);
    expect(session.getSnapshot().error).toBe("bad event");
    expect(session.getSnapshot().state).toBe("connected");
  });

  it("fails before microphone capture when the host cannot mint a secret", async () => {
    const getUserMedia = vi.fn();
    const { session } = createHarness({
      mintClientSecret: vi
        .fn()
        .mockRejectedValue(new Error("providerKeyMissing")),
      getUserMedia,
    });

    await session.start();

    expect(session.getSnapshot()).toMatchObject({
      state: "error",
      error: "providerKeyMissing",
      transcripts: [],
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("fails closed when the OpenAI SDP endpoint rejects the offer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid ephemeral key",
    });
    const { session, peer } = createHarness({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await session.start();

    expect(session.getSnapshot().state).toBe("error");
    expect(session.getSnapshot().error).toContain("HTTP 401");
    expect(session.getSnapshot().error).toContain("invalid ephemeral key");
    expect(peer.closed).toBe(true);
    expect(session.getSnapshot().transcripts).toEqual([]);
  });

  it("stops microphone, peer and audio playback without emitting fake transcripts", async () => {
    const { session, peer, track, audio } = createHarness();
    await session.start();
    emitMessage(peer, { type: "session.created" });

    session.stop();

    expect(session.getSnapshot().state).toBe("closed");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(peer.closed).toBe(true);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().transcripts).toEqual([]);
  });

  it("reflects a real remote close or data-channel close", async () => {
    const { session, peer } = createHarness();
    await session.start();
    emitMessage(peer, { type: "session.created" });
    emitMessage(peer, { type: "session.closed", reason: "completed" });
    expect(session.getSnapshot().state).toBe("closed");

    const second = createHarness();
    await second.session.start();
    emitMessage(second.peer, { type: "session.created" });
    second.peer.dataChannel.emit("close");
    expect(second.session.getSnapshot().state).toBe("closed");
  });
});
