import { secp256k1 } from "@noble/curves/secp256k1.js";
import { makeAuthEvent } from "nostr-tools/nip42";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import {
  exportBrowserIdentity,
  importBrowserIdentity,
  type BrowserIdentity,
} from "@/shared/lib/browser-identity";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import {
  KIND_PAIRING,
  PAIRING_SESSION_TIMEOUT_MS,
  derivePairingSas,
  derivePairingSessionId,
  derivePairingTranscriptHash,
  encodePairingUri,
  pairingConstantTimeEqual,
  pairingEventHasExactRecipient,
  pairingHex,
  parsePairingMessage,
  parsePairingUri,
  type PairingMessage,
} from "./pairing-policy";

type PairingStage =
  | "waiting-offer"
  | "source-confirm"
  | "source-sent"
  | "target-waiting-source"
  | "target-confirm"
  | "target-transferring"
  | "target-ready-import"
  | "completed"
  | "aborted"
  | "expired";

export type PairingSnapshot = {
  stage: PairingStage;
  role: "source" | "target";
  code: string | null;
  pairingUri: string | null;
  error: string | null;
};

type PairingRelayInformation = { pairing_relay_url?: unknown };

function rawSharedSecret(secret: Uint8Array, pubkey: string) {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error("Pairing peer pubkey must be 32 lowercase hex bytes.");
  }
  const pubkeyBytes = pubkey.match(/[0-9a-f]{2}/g) ?? [];
  const peer = new Uint8Array(33);
  peer[0] = 2;
  for (let index = 0; index < 32; index += 1) {
    peer[index + 1] = Number.parseInt(pubkeyBytes[index] ?? "00", 16);
  }
  const shared = secp256k1.getSharedSecret(secret, peer, true);
  const raw = shared.slice(1, 33);
  shared.fill(0);
  return raw;
}

function pairingRelayUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error(
      "This community does not advertise a NIP-AB pairing relay.",
    );
  }
  const parsed = new URL(value);
  if (!/^wss?:$/.test(parsed.protocol) || !parsed.host) {
    throw new Error("The advertised pairing relay is invalid.");
  }
  return parsed.toString();
}

/** Read the NIP-11-advertised sidecar; never guess a pairing endpoint. */
export async function discoverPairingRelay() {
  const response = await fetch(relayHttpBaseUrl(), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok)
    throw new Error("Could not read this relay's pairing capability.");
  return pairingRelayUrl(
    ((await response.json()) as PairingRelayInformation).pairing_relay_url,
  );
}

class PairingTransport {
  private readonly queued: NostrEvent[] = [];
  private readonly sent = new Map<string, NostrEvent>();
  private readonly subscriptionId = `pair-${crypto.randomUUID()}`;
  private started = false;
  private stopped = false;
  private authPending = false;
  private authEventId: string | null = null;
  private socket: WebSocket | null = null;
  private fallbackTimer: number | null = null;

  constructor(
    private readonly relayUrl: string,
    private readonly secret: Uint8Array,
    private readonly pubkey: string,
    private readonly onEvent: (event: NostrEvent) => void,
    private readonly onFailure: (error: Error) => void,
  ) {}

  connect() {
    const socket = new WebSocket(this.relayUrl);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.fallbackTimer = window.setTimeout(() => this.start(), 250);
    });
    socket.addEventListener("message", (message) => {
      void this.handleMessage(message.data);
    });
    socket.addEventListener("error", () => {
      if (!this.stopped)
        this.onFailure(new Error("Pairing relay connection failed."));
    });
    socket.addEventListener("close", () => {
      if (!this.stopped)
        this.onFailure(new Error("Pairing relay connection closed."));
    });
  }

  publish(event: NostrEvent) {
    if (this.stopped) return;
    this.queued.push(event);
    this.flush();
  }

  stop() {
    this.stopped = true;
    this.queued.length = 0;
    this.sent.clear();
    if (this.fallbackTimer !== null) window.clearTimeout(this.fallbackTimer);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(["CLOSE", this.subscriptionId]));
    }
    this.socket?.close();
    this.socket = null;
  }

  private start() {
    if (
      this.stopped ||
      this.started ||
      this.authPending ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    this.started = true;
    this.socket.send(
      JSON.stringify([
        "REQ",
        this.subscriptionId,
        { kinds: [KIND_PAIRING], "#p": [this.pubkey] },
      ]),
    );
    this.flush();
  }

  private flush() {
    if (
      !this.started ||
      this.stopped ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    for (const event of this.queued.splice(0)) {
      this.sent.set(event.id, event);
      this.socket.send(JSON.stringify(["EVENT", event]));
    }
  }

  private async handleMessage(raw: unknown) {
    let message: unknown[];
    try {
      message = JSON.parse(String(raw)) as unknown[];
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;
    if (message[0] === "AUTH" && typeof message[1] === "string") {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.started) {
        this.started = false;
        this.queued.unshift(...this.sent.values());
        this.sent.clear();
      }
      this.authPending = true;
      if (this.fallbackTimer !== null) window.clearTimeout(this.fallbackTimer);
      const auth = finalizeEvent(
        makeAuthEvent(this.relayUrl, message[1]),
        this.secret,
      );
      this.authEventId = auth.id;
      this.socket.send(JSON.stringify(["AUTH", auth]));
      return;
    }
    if (
      message[0] === "OK" &&
      this.authPending &&
      message[1] === this.authEventId
    ) {
      if (message[2] !== true) {
        this.onFailure(new Error("Pairing relay authentication was rejected."));
        return;
      }
      this.authPending = false;
      this.authEventId = null;
      this.start();
      return;
    }
    if (
      message[0] === "EVENT" &&
      message[1] === this.subscriptionId &&
      message[2]
    ) {
      this.onEvent(message[2] as NostrEvent);
    }
  }
}

/**
 * A short-lived NIP-AB state machine. It holds only fresh ephemeral keys and
 * the QR secret; neither is written to IndexedDB or localStorage.
 */
export class BrowserPairingSession {
  private readonly listeners = new Set<(snapshot: PairingSnapshot) => void>();
  private readonly processedIds = new Set<string>();
  private readonly ephemeralSecret: Uint8Array;
  private readonly ownPubkey: string;
  private readonly sessionSecret: Uint8Array;
  private readonly sessionId: Uint8Array;
  private readonly timer: number;
  private transport: PairingTransport | null = null;
  private peerPubkey: string | null;
  private sasInput: Uint8Array | null = null;
  private pendingPayload: NostrEvent | null = null;
  private payload: string | null = null;
  private snapshotValue: PairingSnapshot;

  private constructor(
    private readonly role: "source" | "target",
    private readonly relayUrl: string,
    sessionSecret: Uint8Array,
    peerPubkey: string | null,
    sessionId: Uint8Array,
    snapshot: PairingSnapshot,
  ) {
    this.ephemeralSecret = generateSecretKey();
    this.ownPubkey = getPublicKey(this.ephemeralSecret);
    this.sessionSecret = sessionSecret.slice();
    this.sessionId = sessionId;
    this.peerPubkey = peerPubkey;
    this.snapshotValue = snapshot;
    this.timer = window.setTimeout(
      () => this.expire(),
      PAIRING_SESSION_TIMEOUT_MS,
    );
  }

  static async createSource() {
    const relayUrl = await discoverPairingRelay();
    const sessionSecret = crypto.getRandomValues(new Uint8Array(32));
    const sessionId = await derivePairingSessionId(sessionSecret);
    const session = new BrowserPairingSession(
      "source",
      relayUrl,
      sessionSecret,
      null,
      sessionId,
      {
        stage: "waiting-offer",
        role: "source",
        code: null,
        pairingUri: null,
        error: null,
      },
    );
    session.snapshotValue = {
      ...session.snapshotValue,
      pairingUri: encodePairingUri({
        sourcePubkey: session.ownPubkey,
        sessionSecret,
        relayUrl,
        version: 1,
      }),
    };
    session.connect();
    return session;
  }

  static async joinTarget(uri: string) {
    const qr = parsePairingUri(uri);
    const sessionId = await derivePairingSessionId(qr.sessionSecret);
    const session = new BrowserPairingSession(
      "target",
      qr.relayUrl,
      qr.sessionSecret,
      qr.sourcePubkey,
      sessionId,
      {
        stage: "target-waiting-source",
        role: "target",
        code: null,
        pairingUri: null,
        error: null,
      },
    );
    await session.computeSas(
      qr.sourcePubkey,
      qr.sourcePubkey,
      session.ownPubkey,
    );
    session.connect();
    session.send({
      type: "offer",
      session_id: pairingHex(session.sessionId),
      version: 1,
    });
    return session;
  }

  get snapshot() {
    return this.snapshotValue;
  }

  subscribe(listener: (snapshot: PairingSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => this.listeners.delete(listener);
  }

  /** Explicit source-side user gesture after visually checking the SAS. */
  async confirmSourceAndSendIdentity() {
    if (this.snapshotValue.stage !== "source-confirm" || !this.peerPubkey) {
      throw new Error(
        "Wait for a verified target offer before confirming pairing.",
      );
    }
    const nsec = await exportBrowserIdentity();
    try {
      const transcript = await this.transcriptHash();
      this.send({
        type: "sas-confirm",
        transcript_hash: pairingHex(transcript),
      });
      this.send({ type: "payload", payload_type: "nsec", payload: nsec });
      this.setSnapshot({ ...this.snapshotValue, stage: "source-sent" });
    } finally {
      // JavaScript strings cannot be reliably zeroized; never retain it on this session.
    }
  }

  /** Explicit target-side SAS confirmation; buffered payload is only now decrypted. */
  async confirmTargetSas() {
    if (this.snapshotValue.stage !== "target-confirm") {
      throw new Error("Wait for the source's verified SAS confirmation first.");
    }
    this.setSnapshot({ ...this.snapshotValue, stage: "target-transferring" });
    if (this.pendingPayload) {
      const payload = this.pendingPayload;
      this.pendingPayload = null;
      await this.acceptPayload(payload);
    }
  }

  /** Explicit target-side storage action. The NIP-AB payload is never auto-imported. */
  async importReceivedIdentity(
    displayName: string,
    password: string,
  ): Promise<BrowserIdentity> {
    if (this.snapshotValue.stage !== "target-ready-import" || !this.payload) {
      throw new Error("No verified pairing identity is ready to import.");
    }
    try {
      const identity = await importBrowserIdentity(
        this.payload,
        displayName,
        password,
      );
      this.send({ type: "complete", success: true });
      this.finish("completed");
      return identity;
    } catch (error) {
      this.send({ type: "complete", success: false });
      this.finish(
        "aborted",
        "Identity import failed; the source was notified.",
      );
      throw error;
    }
  }

  async cancel() {
    if (
      this.peerPubkey &&
      !["completed", "aborted", "expired"].includes(this.snapshotValue.stage)
    ) {
      this.send({ type: "abort", reason: "user_denied" });
    }
    this.finish("aborted", "Pairing was cancelled.");
  }

  dispose() {
    this.finish("aborted");
  }

  private connect() {
    this.transport = new PairingTransport(
      this.relayUrl,
      this.ephemeralSecret,
      this.ownPubkey,
      (event) => void this.handleEvent(event),
      (error) => this.finish("aborted", error.message),
    );
    this.transport.connect();
  }

  private async handleEvent(event: NostrEvent) {
    if (
      !verifyEvent(event) ||
      event.kind !== KIND_PAIRING ||
      !pairingEventHasExactRecipient(event.tags, this.ownPubkey) ||
      this.processedIds.has(event.id)
    ) {
      return;
    }
    if (
      this.role === "source" &&
      this.snapshotValue.stage === "waiting-offer"
    ) {
      await this.handleOffer(event);
      return;
    }
    if (!this.peerPubkey || event.pubkey !== this.peerPubkey) return;
    if (
      this.role === "target" &&
      this.snapshotValue.stage === "target-waiting-source"
    ) {
      await this.handleSasConfirm(event);
      return;
    }
    if (
      this.role === "target" &&
      (this.snapshotValue.stage === "target-confirm" ||
        this.snapshotValue.stage === "target-transferring")
    ) {
      if (this.snapshotValue.stage === "target-confirm") {
        this.pendingPayload = event;
      } else {
        await this.acceptPayload(event);
      }
      return;
    }
    if (this.role === "source" && this.snapshotValue.stage === "source-sent") {
      const message = this.decrypt(event);
      if (message?.type === "complete") {
        this.processedIds.add(event.id);
        this.finish(
          message.success ? "completed" : "aborted",
          message.success ? null : "Target could not import the identity.",
        );
      } else if (message?.type === "abort") {
        this.finish("aborted", "The target cancelled pairing.");
      }
    }
  }

  private async handleOffer(event: NostrEvent) {
    const message = this.decrypt(event);
    if (
      message?.type !== "offer" ||
      !pairingConstantTimeEqual(
        this.sessionId,
        this.hexBytes(message.session_id),
      )
    ) {
      return;
    }
    this.peerPubkey = event.pubkey;
    await this.computeSas(event.pubkey, this.ownPubkey, event.pubkey);
    this.processedIds.add(event.id);
    this.setSnapshot({ ...this.snapshotValue, stage: "source-confirm" });
  }

  private async handleSasConfirm(event: NostrEvent) {
    const message = this.decrypt(event);
    if (message?.type !== "sas-confirm") return;
    const transcript = await this.transcriptHash();
    if (
      !pairingConstantTimeEqual(
        transcript,
        this.hexBytes(message.transcript_hash),
      )
    ) {
      this.send({ type: "abort", reason: "sas_mismatch" });
      this.finish("aborted", "Pairing transcript verification failed.");
      return;
    }
    this.processedIds.add(event.id);
    this.setSnapshot({ ...this.snapshotValue, stage: "target-confirm" });
  }

  private async acceptPayload(event: NostrEvent) {
    const message = this.decrypt(event);
    if (message?.type !== "payload") {
      this.send({ type: "abort", reason: "protocol_error" });
      this.finish("aborted", "Pairing payload was invalid.");
      return;
    }
    this.processedIds.add(event.id);
    this.payload = message.payload;
    this.setSnapshot({ ...this.snapshotValue, stage: "target-ready-import" });
  }

  private decrypt(event: NostrEvent): PairingMessage | null {
    try {
      const conversation = nip44.utils.getConversationKey(
        this.ephemeralSecret,
        event.pubkey,
      );
      return parsePairingMessage(
        JSON.parse(nip44.decrypt(event.content, conversation)),
      );
    } catch {
      return null;
    }
  }

  private send(message: PairingMessage) {
    if (!this.peerPubkey || !this.transport) return;
    const plaintext = JSON.stringify(message);
    const conversation = nip44.utils.getConversationKey(
      this.ephemeralSecret,
      this.peerPubkey,
    );
    const content = nip44.encrypt(plaintext, conversation);
    this.transport.publish(
      finalizeEvent(
        {
          kind: KIND_PAIRING,
          content,
          tags: [["p", this.peerPubkey]],
          created_at: Math.floor(Date.now() / 1_000),
        },
        this.ephemeralSecret,
      ),
    );
  }

  private async computeSas(
    peerPubkey: string,
    sourcePubkey: string,
    targetPubkey: string,
  ) {
    const shared = rawSharedSecret(this.ephemeralSecret, peerPubkey);
    try {
      const sas = await derivePairingSas(shared, this.sessionSecret);
      this.sasInput = sas.input;
      this.setSnapshot({ ...this.snapshotValue, code: sas.code });
    } finally {
      shared.fill(0);
    }
    // Force early validation of the canonical transcript key ordering.
    await derivePairingTranscriptHash({
      sessionId: this.sessionId,
      sourcePubkey,
      targetPubkey,
      sasInput: this.sasInput,
      sessionSecret: this.sessionSecret,
    });
  }

  private async transcriptHash() {
    if (!this.peerPubkey || !this.sasInput)
      throw new Error("Pairing SAS is unavailable.");
    return derivePairingTranscriptHash({
      sessionId: this.sessionId,
      sourcePubkey: this.role === "source" ? this.ownPubkey : this.peerPubkey,
      targetPubkey: this.role === "source" ? this.peerPubkey : this.ownPubkey,
      sasInput: this.sasInput,
      sessionSecret: this.sessionSecret,
    });
  }

  private hexBytes(value: string) {
    if (!/^[0-9a-f]{64}$/.test(value)) return new Uint8Array();
    const output = new Uint8Array(32);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Number.parseInt(
        value.slice(index * 2, index * 2 + 2),
        16,
      );
    }
    return output;
  }

  private expire() {
    if (["completed", "aborted", "expired"].includes(this.snapshotValue.stage))
      return;
    this.send({ type: "abort", reason: "timeout" });
    this.finish("expired", "Pairing expired after two minutes.");
  }

  private finish(
    stage: Extract<PairingStage, "completed" | "aborted" | "expired">,
    error: string | null = null,
  ) {
    if (["completed", "aborted", "expired"].includes(this.snapshotValue.stage))
      return;
    window.clearTimeout(this.timer);
    this.transport?.stop();
    this.transport = null;
    this.pendingPayload = null;
    this.payload = null;
    this.sasInput?.fill(0);
    this.sasInput = null;
    this.sessionSecret.fill(0);
    this.sessionId.fill(0);
    this.ephemeralSecret.fill(0);
    this.setSnapshot({
      ...this.snapshotValue,
      stage,
      error,
      pairingUri: null,
      code: null,
    });
  }

  private setSnapshot(next: PairingSnapshot) {
    this.snapshotValue = next;
    for (const listener of this.listeners) listener(next);
  }
}
