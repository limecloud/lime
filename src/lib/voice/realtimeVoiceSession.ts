import type { RealtimeVoiceClientSecret } from "@/lib/api/realtimeVoice";
import {
  applyRealtimeServerEvent,
  parseRealtimeServerEvent,
  type RealtimeTranscriptLine,
} from "./realtimeVoiceEvents";

export type RealtimeVoiceConnectionState =
  | "idle"
  | "requesting-secret"
  | "requesting-microphone"
  | "connecting"
  | "connected"
  | "stopping"
  | "closed"
  | "error";

export interface RealtimeVoiceSessionSnapshot {
  state: RealtimeVoiceConnectionState;
  transcripts: RealtimeTranscriptLine[];
  error: string | null;
  sessionId: string | null;
  model: string | null;
  voice: string | null;
}

export interface RealtimeVoiceSessionOptions {
  mintClientSecret: () => Promise<RealtimeVoiceClientSecret>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  fetchImpl?: typeof fetch;
  createPeerConnection?: () => RTCPeerConnection;
  createAudioElement?: () => HTMLAudioElement;
  iceGatheringTimeoutMs?: number;
  sessionStartTimeoutMs?: number;
}

const EMPTY_SNAPSHOT: RealtimeVoiceSessionSnapshot = {
  state: "idle",
  transcripts: [],
  error: null,
  sessionId: null,
  model: null,
  voice: null,
};

const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 10_000;
const DEFAULT_SESSION_START_TIMEOUT_MS = 15_000;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim())
    return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unable to start the OpenAI Realtime voice session";
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function readBoundedSdpError(text: string): string {
  return text.trim().slice(0, 512).replace(/\s+/g, " ");
}

/**
 * 浏览器 WebRTC 实时语音会话状态机。
 *
 * 生产路径只使用真实 `RTCPeerConnection`、麦克风、远程音频与 `oai-events`
 * data channel；没有真实 session.created/started 事件时不会进入 connected。
 */
export class RealtimeVoiceSession {
  private readonly options: RealtimeVoiceSessionOptions;
  private snapshot: RealtimeVoiceSessionSnapshot = { ...EMPTY_SNAPSHOT };
  private readonly listeners = new Set<
    (snapshot: RealtimeVoiceSessionSnapshot) => void
  >();
  private peer: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private sessionStartTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private cleaningUp = false;

  constructor(options: RealtimeVoiceSessionOptions) {
    this.options = options;
  }

  getSnapshot = (): RealtimeVoiceSessionSnapshot => this.snapshot;

  subscribe = (
    listener: (snapshot: RealtimeVoiceSessionSnapshot) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(): Promise<void> {
    if (
      !["idle", "closed", "error"].includes(this.snapshot.state) ||
      this.cleaningUp
    ) {
      return;
    }
    const generation = ++this.generation;
    this.clearSessionStartTimer();
    this.transcriptLines = [];
    this.update({
      state: "requesting-secret",
      error: null,
      sessionId: null,
      model: null,
      voice: null,
    });
    try {
      const secret = await this.options.mintClientSecret();
      if (!this.isCurrent(generation)) return;
      this.update({
        state: "requesting-microphone",
        model: secret.model,
        voice: secret.voice,
      });
      const getUserMedia =
        this.options.getUserMedia ??
        ((constraints: MediaStreamConstraints) =>
          navigator.mediaDevices.getUserMedia(constraints));
      const microphone = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.isCurrent(generation)) {
        stopStream(microphone);
        return;
      }
      this.microphone = microphone;

      const createPeerConnection =
        this.options.createPeerConnection ?? (() => new RTCPeerConnection());
      const peer = createPeerConnection();
      this.peer = peer;
      this.audio = this.createAudio();
      peer.addEventListener("track", this.handleTrack);
      peer.addEventListener(
        "connectionstatechange",
        this.handleConnectionStateChange,
      );

      const dataChannel = peer.createDataChannel("oai-events");
      this.dataChannel = dataChannel;
      dataChannel.addEventListener("message", this.handleDataChannelMessage);
      dataChannel.addEventListener("close", this.handleDataChannelClose);
      dataChannel.addEventListener("error", this.handleDataChannelError);

      microphone.getTracks().forEach((track) => {
        peer.addTrack(track, microphone);
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.waitForIceGathering(peer);
      if (!this.isCurrent(generation)) return;
      const offerSdp = peer.localDescription?.sdp ?? offer.sdp;
      if (!offerSdp?.trim()) {
        throw new Error("Unable to create a WebRTC SDP offer");
      }

      this.update({ state: "connecting" });
      const fetchImpl = this.options.fetchImpl ?? fetch;
      const response = await fetchImpl(secret.callsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offerSdp,
      });
      if (!this.isCurrent(generation)) return;
      if (!response.ok) {
        const detail = readBoundedSdpError(await response.text());
        throw new Error(
          `OpenAI Realtime SDP request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      const answerSdp = await response.text();
      if (!this.isCurrent(generation)) return;
      if (!answerSdp.trim().startsWith("v=")) {
        throw new Error("OpenAI Realtime returned an invalid SDP answer");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      if (!this.isCurrent(generation)) return;
      this.armSessionStartTimer(generation);
    } catch (error) {
      this.fail(generation, errorText(error));
    }
  }

  stop(): void {
    if (this.snapshot.state === "idle" || this.snapshot.state === "closed") {
      return;
    }
    this.generation += 1;
    this.clearSessionStartTimer();
    this.update({ state: "stopping" });
    this.cleanup();
    this.update({ state: "closed" });
  }

  dispose(): void {
    this.generation += 1;
    this.clearSessionStartTimer();
    this.cleanup();
  }

  private transcriptLines: RealtimeTranscriptLine[] = [];

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private update(partial: Partial<RealtimeVoiceSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private createAudio(): HTMLAudioElement {
    if (this.options.createAudioElement) {
      return this.options.createAudioElement();
    }
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    return audio;
  }

  private handleTrack = (event: RTCTrackEvent): void => {
    const audio = this.audio;
    if (!audio) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
  };

  private handleConnectionStateChange = (): void => {
    const peer = this.peer;
    if (!peer || this.cleaningUp) return;
    if (peer.connectionState === "failed") {
      this.fail(this.generation, "WebRTC connection failed");
    } else if (peer.connectionState === "closed") {
      this.remoteClosed();
    }
  };

  private handleDataChannelMessage = (event: MessageEvent): void => {
    const parsed = parseRealtimeServerEvent(event.data);
    switch (parsed.kind) {
      case "session-started":
        this.clearSessionStartTimer();
        if (this.snapshot.state === "connected") {
          this.update({
            sessionId: parsed.sessionId ?? this.snapshot.sessionId,
          });
        } else {
          this.update({
            state: "connected",
            error: null,
            sessionId: parsed.sessionId ?? this.snapshot.sessionId,
          });
        }
        break;
      case "transcript-delta":
      case "transcript-done":
        this.transcriptLines = applyRealtimeServerEvent(
          this.transcriptLines,
          parsed,
        );
        this.update({ transcripts: this.transcriptLines });
        break;
      case "error":
        if (this.snapshot.state === "connected") {
          this.update({ error: parsed.message });
        } else {
          this.fail(this.generation, parsed.message);
        }
        break;
      case "closed":
        this.remoteClosed();
        break;
      case "ignored":
        break;
    }
  };

  private handleDataChannelClose = (): void => {
    if (this.cleaningUp) return;
    this.remoteClosed();
  };

  private handleDataChannelError = (): void => {
    if (this.cleaningUp) return;
    this.fail(this.generation, "OpenAI Realtime data channel failed");
  };

  private remoteClosed(): void {
    if (this.snapshot.state === "closed") return;
    this.clearSessionStartTimer();
    this.cleanup();
    this.update({ state: "closed" });
  }

  private fail(generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.clearSessionStartTimer();
    this.cleanup();
    this.update({ state: "error", error: message });
  }

  private armSessionStartTimer(generation: number): void {
    this.clearSessionStartTimer();
    this.sessionStartTimer = setTimeout(() => {
      if (
        generation === this.generation &&
        this.snapshot.state === "connecting"
      ) {
        this.fail(generation, "OpenAI Realtime session did not start");
      }
    }, this.options.sessionStartTimeoutMs ?? DEFAULT_SESSION_START_TIMEOUT_MS);
  }

  private clearSessionStartTimer(): void {
    if (this.sessionStartTimer !== null) {
      clearTimeout(this.sessionStartTimer);
      this.sessionStartTimer = null;
    }
  }

  private waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutMs =
        this.options.iceGatheringTimeoutMs ?? DEFAULT_ICE_GATHERING_TIMEOUT_MS;
      const cleanup = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", handleStateChange);
      };
      const handleStateChange = () => {
        if (peer.iceGatheringState !== "complete") return;
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out while gathering WebRTC ICE candidates"));
      }, timeoutMs);
      peer.addEventListener("icegatheringstatechange", handleStateChange);
      handleStateChange();
    });
  }

  private cleanup(): void {
    this.cleaningUp = true;
    this.clearSessionStartTimer();
    const dataChannel = this.dataChannel;
    this.dataChannel = null;
    if (dataChannel) {
      dataChannel.removeEventListener("message", this.handleDataChannelMessage);
      dataChannel.removeEventListener("close", this.handleDataChannelClose);
      dataChannel.removeEventListener("error", this.handleDataChannelError);
      try {
        dataChannel.close();
      } catch {
        // A closed channel is already clean.
      }
    }
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.removeEventListener("track", this.handleTrack);
      peer.removeEventListener(
        "connectionstatechange",
        this.handleConnectionStateChange,
      );
      try {
        peer.close();
      } catch {
        // A closed peer is already clean.
      }
    }
    stopStream(this.microphone);
    this.microphone = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
    this.cleaningUp = false;
  }
}
