import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { encodedHuddleFrameMetadata } from "./huddle-audio-policy";

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_FRAME_SAMPLES = 960;
const AUDIO_PROTOCOL_VERSION = 2;
const AUDIO_FRAME_HEADER_BYTES = 8;
const MAX_AUDIO_FRAME_BYTES = 4_096;

type CodecAudioData = {
  close(): void;
  numberOfChannels: number;
  numberOfFrames: number;
  sampleRate: number;
  timestamp: number;
  copyTo(destination: Float32Array, options?: { planeIndex?: number }): void;
};

type CodecEncodedChunk = {
  byteLength: number;
  timestamp: number;
  copyTo(destination: Uint8Array): void;
};

type CodecAudioEncoder = {
  configure(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    bitrate: number;
  }): void;
  encode(frame: CodecAudioData): void;
  close(): void;
};

type CodecAudioDecoder = {
  configure(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
  }): void;
  decode(chunk: unknown): void;
  close(): void;
};

type BrowserCodecs = {
  AudioData: new (init: {
    format: "f32-planar";
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }) => CodecAudioData;
  AudioEncoder: new (init: {
    output: (chunk: CodecEncodedChunk) => void;
    error: (error: DOMException) => void;
  }) => CodecAudioEncoder;
  AudioDecoder: new (init: {
    output: (data: CodecAudioData) => void;
    error: (error: DOMException) => void;
  }) => CodecAudioDecoder;
  EncodedAudioChunk: new (init: {
    type: "key";
    timestamp: number;
    data: Uint8Array;
  }) => unknown;
};

export type HuddleAudioInput = {
  deviceId: string;
  label: string;
};

export type HuddleAudioState =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "connected"
  | "error";

export type BrowserHuddleAudioOptions = {
  channelId: string;
  parentChannelId: string;
  deviceId?: string;
  onStateChange?: (state: HuddleAudioState, error?: Error) => void;
};

function browserCodecs(): BrowserCodecs | null {
  const codecs = globalThis as Partial<BrowserCodecs>;
  if (
    !codecs.AudioData ||
    !codecs.AudioEncoder ||
    !codecs.AudioDecoder ||
    !codecs.EncodedAudioChunk
  ) {
    return null;
  }
  return codecs as BrowserCodecs;
}

export function browserHuddleAudioUnsupportedReason(): string | null {
  if (!window.isSecureContext) {
    return "Huddle audio requires a secure (HTTPS) browser context.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser cannot request microphone access.";
  }
  if (!browserCodecs()) {
    return "This browser does not expose the required Opus WebCodecs transport.";
  }
  return null;
}

export async function listBrowserAudioInputs(): Promise<HuddleAudioInput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

function audioSocketUrl(channelId: string) {
  return `${relayWsUrl().replace(/\/$/, "")}/huddle/${encodeURIComponent(channelId)}/audio`;
}

function headerForFrame(
  sequence: number,
  timestamp48k: number,
  levelDbov: number,
) {
  const header = new Uint8Array(AUDIO_FRAME_HEADER_BYTES);
  new DataView(header.buffer).setUint16(0, sequence & 0xffff, false);
  new DataView(header.buffer).setUint32(2, timestamp48k >>> 0, false);
  header[6] = levelDbov & 0xff;
  header[7] = 0;
  return header;
}

function audioLevelDbov(samples: Float32Array) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  return rms > 0
    ? Math.max(-127, Math.min(0, Math.round(20 * Math.log10(rms))))
    : -127;
}

function decodeTimestamp(frame: Uint8Array) {
  return new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  ).getUint32(3, false);
}

/**
 * Short-lived browser audio transport for the relay's existing opaque Opus
 * websocket. It owns all capture/playback resources and releases them on every
 * leave, route unmount, visibility transition, or failed handshake.
 */
export class BrowserHuddleAudio {
  private readonly options: BrowserHuddleAudioOptions;
  private state: HuddleAudioState = "idle";
  private stream: MediaStream | null = null;
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private encoder: CodecAudioEncoder | null = null;
  private decoder: CodecAudioDecoder | null = null;
  private muted = false;
  private sequence = 0;
  private timestamp48k = 0;
  private playbackAt = 0;
  private readonly levelsByTimestamp = new Map<number, number>();
  private stopped = false;
  private readonly onVisibilityChange = () => this.applyInputGate();

  constructor(options: BrowserHuddleAudioOptions) {
    this.options = options;
  }

  get connected() {
    return this.state === "connected";
  }

  get isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyInputGate();
  }

  async connect() {
    const unsupported = browserHuddleAudioUnsupportedReason();
    if (unsupported) throw new Error(unsupported);
    if (this.state === "connected" || this.state === "connecting") return;
    this.stopped = false;
    this.setState("requesting-permission");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: AUDIO_SAMPLE_RATE,
          ...(this.options.deviceId
            ? { deviceId: { exact: this.options.deviceId } }
            : {}),
        },
        video: false,
      });
      this.setState("connecting");
      this.socket = await this.connectSocket();
      await this.configureAudioGraph();
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.applyInputGate();
      this.setState("connected");
    } catch (error) {
      await this.close();
      const normalized =
        error instanceof Error
          ? error
          : new Error("Could not join huddle audio.");
      this.setState("error", normalized);
      throw normalized;
    }
  }

  async close() {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "leave" }));
      } catch {
        // The close below is still authoritative local teardown.
      }
    }
    socket?.close();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    this.encoder?.close();
    this.decoder?.close();
    this.encoder = null;
    this.decoder = null;
    this.levelsByTimestamp.clear();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") await context.close();
    if (this.state !== "error") this.setState("idle");
  }

  private setState(state: HuddleAudioState, error?: Error) {
    this.state = state;
    this.options.onStateChange?.(state, error);
  }

  private applyInputGate() {
    const enabled = !this.muted && !document.hidden;
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = enabled;
  }

  private async connectSocket(): Promise<WebSocket> {
    const socket = new WebSocket(audioSocketUrl(this.options.channelId));
    socket.binaryType = "arraybuffer";
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(
        () => finish(new Error("Timed out joining huddle audio.")),
        10_000,
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) {
          socket.close();
          reject(error);
        } else {
          resolve(socket);
        }
      };
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") {
          if (settled) this.playIncomingFrame(message.data);
          return;
        }
        let parsed: { type?: unknown; challenge?: unknown; message?: unknown };
        try {
          parsed = JSON.parse(message.data) as typeof parsed;
        } catch {
          return;
        }
        if (
          parsed.type === "challenge" &&
          typeof parsed.challenge === "string"
        ) {
          void this.sendAudioAuth(socket, parsed.challenge).catch((error) => {
            finish(
              error instanceof Error
                ? error
                : new Error("Huddle authentication failed."),
            );
          });
        } else if (parsed.type === "joined") {
          finish();
        } else if (parsed.type === "error") {
          finish(
            new Error(
              typeof parsed.message === "string"
                ? parsed.message
                : "Huddle audio was rejected.",
            ),
          );
        }
      });
      socket.addEventListener("error", () =>
        finish(new Error("Could not connect to huddle audio.")),
      );
      socket.addEventListener("close", () => {
        if (!settled) finish(new Error("The huddle audio connection closed."));
        else if (!this.stopped)
          this.setState(
            "error",
            new Error("The huddle audio connection closed."),
          );
      });
    });
  }

  private async sendAudioAuth(socket: WebSocket, challenge: string) {
    const relay = relayWsUrl();
    const event = await signNostrEvent(
      {
        kind: 22242,
        content: "",
        tags: [
          ["relay", relay],
          ["challenge", challenge],
        ],
      },
      { requireNip07: true },
    );
    socket.send(
      JSON.stringify({
        type: "auth",
        event,
        parent_channel_id: this.options.parentChannelId,
        protocol_version: AUDIO_PROTOCOL_VERSION,
      }),
    );
  }

  private async configureAudioGraph() {
    const codecs = browserCodecs();
    const stream = this.stream;
    const track = stream?.getAudioTracks()[0];
    if (!codecs || !stream || !track || !this.socket)
      throw new Error("Huddle audio could not initialize.");
    const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    if (context.sampleRate !== AUDIO_SAMPLE_RATE) {
      void context.close();
      throw new Error("This browser cannot provide 48 kHz huddle audio.");
    }
    if (context.state === "suspended") await context.resume();
    this.context = context;
    const encoder = new codecs.AudioEncoder({
      output: (chunk) => this.sendEncodedFrame(chunk),
      error: (error) => this.setState("error", error),
    });
    encoder.configure({
      codec: "opus",
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: 32_000,
    });
    const decoder = new codecs.AudioDecoder({
      output: (data) => this.playDecodedAudio(data),
      error: (error) => this.setState("error", error),
    });
    decoder.configure({
      codec: "opus",
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: 1,
    });
    this.encoder = encoder;
    this.decoder = decoder;
    this.source = context.createMediaStreamSource(stream);
    this.processor = context.createScriptProcessor(AUDIO_FRAME_SAMPLES, 1, 1);
    this.processor.onaudioprocess = (event) => {
      this.encodeInput(event.inputBuffer.getChannelData(0));
      // ScriptProcessor must be connected for processing to run. Keep that
      // output silent so the microphone is never looped back to speakers.
      event.outputBuffer.getChannelData(0).fill(0);
    };
    this.source.connect(this.processor);
    this.processor.connect(context.destination);
  }

  private encodeInput(input: Float32Array) {
    if (this.muted || document.hidden || !this.encoder) return;
    const codecs = browserCodecs();
    if (!codecs) return;
    for (
      let offset = 0;
      offset + AUDIO_FRAME_SAMPLES <= input.length;
      offset += AUDIO_FRAME_SAMPLES
    ) {
      const samples = input.slice(offset, offset + AUDIO_FRAME_SAMPLES);
      const timestamp = (this.timestamp48k * 1_000_000) / AUDIO_SAMPLE_RATE;
      this.levelsByTimestamp.set(timestamp, audioLevelDbov(samples));
      if (this.levelsByTimestamp.size > 100) {
        const oldest = this.levelsByTimestamp.keys().next().value;
        if (oldest !== undefined) this.levelsByTimestamp.delete(oldest);
      }
      const frame = new codecs.AudioData({
        format: "f32-planar",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: AUDIO_FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp,
        data: samples,
      });
      this.encoder.encode(frame);
      frame.close();
      this.timestamp48k += AUDIO_FRAME_SAMPLES;
    }
  }

  private sendEncodedFrame(chunk: CodecEncodedChunk) {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.muted ||
      document.hidden
    )
      return;
    if (
      chunk.byteLength === 0 ||
      chunk.byteLength + AUDIO_FRAME_HEADER_BYTES > MAX_AUDIO_FRAME_BYTES
    )
      return;
    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);
    const frame = new Uint8Array(AUDIO_FRAME_HEADER_BYTES + payload.length);
    const { levelDbov: level, timestamp48k } = encodedHuddleFrameMetadata(
      chunk.timestamp,
      this.levelsByTimestamp,
    );
    this.levelsByTimestamp.delete(chunk.timestamp);
    frame.set(headerForFrame(this.sequence, timestamp48k, level), 0);
    frame.set(payload, AUDIO_FRAME_HEADER_BYTES);
    this.sequence = (this.sequence + 1) & 0xffff;
    this.socket.send(frame);
  }

  private playIncomingFrame(raw: unknown) {
    if (!this.decoder || !raw || !(raw instanceof ArrayBuffer)) return;
    const frame = new Uint8Array(raw);
    if (
      frame.length <= AUDIO_FRAME_HEADER_BYTES + 1 ||
      frame.length > MAX_AUDIO_FRAME_BYTES + 1
    )
      return;
    const codecs = browserCodecs();
    if (!codecs) return;
    const payload = frame.slice(1 + AUDIO_FRAME_HEADER_BYTES);
    this.decoder.decode(
      new codecs.EncodedAudioChunk({
        type: "key",
        timestamp: (decodeTimestamp(frame) * 1_000_000) / AUDIO_SAMPLE_RATE,
        data: payload,
      }),
    );
  }

  private playDecodedAudio(data: CodecAudioData) {
    const context = this.context;
    if (
      !context ||
      data.numberOfChannels !== 1 ||
      data.sampleRate !== AUDIO_SAMPLE_RATE
    ) {
      data.close();
      return;
    }
    const samples = new Float32Array(data.numberOfFrames);
    data.copyTo(samples, { planeIndex: 0 });
    data.close();
    const buffer = context.createBuffer(1, samples.length, AUDIO_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const earliest = context.currentTime + 0.05;
    if (
      this.playbackAt < earliest ||
      this.playbackAt > context.currentTime + 0.25
    ) {
      this.playbackAt = earliest;
    }
    source.start(this.playbackAt);
    this.playbackAt += buffer.duration;
  }
}
