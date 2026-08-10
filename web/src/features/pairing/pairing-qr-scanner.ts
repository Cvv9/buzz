import {
  PAIRING_SESSION_TIMEOUT_MS,
  pairingCameraSupported,
} from "./pairing-policy.ts";

type PairingQrCode = { rawValue?: unknown };

type PairingQrDetector = {
  detect(video: PairingQrVideo): Promise<PairingQrCode[]>;
};

type PairingQrStream = {
  getTracks(): Array<{ stop(): void }>;
};

export type PairingQrVideo = {
  muted: boolean;
  playsInline: boolean;
  srcObject: unknown;
  play(): Promise<void>;
};

type PairingQrScannerEnvironment = {
  clearTimeout(handle: number): void;
  createDetector(): PairingQrDetector;
  getUserMedia(constraints: {
    audio: false;
    video: { facingMode: { ideal: "environment" } };
  }): Promise<PairingQrStream>;
  setTimeout(callback: () => void, delay: number): number;
};

/**
 * A strictly ephemeral QR scanner. The camera stream is stopped after a scan,
 * a route cleanup, an error, or the same two-minute limit as a pairing offer.
 */
export function createPairingQrScanner(
  environment: PairingQrScannerEnvironment,
) {
  let active = false;
  let scanTimer: number | null = null;
  let sessionTimer: number | null = null;
  let stream: PairingQrStream | null = null;
  let video: PairingQrVideo | null = null;

  const stop = () => {
    active = false;
    if (scanTimer !== null) environment.clearTimeout(scanTimer);
    if (sessionTimer !== null) environment.clearTimeout(sessionTimer);
    scanTimer = null;
    sessionTimer = null;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (video?.srcObject === stream) video.srcObject = null;
    stream = null;
    video = null;
  };

  return {
    async start(
      nextVideo: PairingQrVideo,
      onCode: (code: string) => void,
      onError: (error: Error) => void,
    ) {
      stop();
      active = true;
      video = nextVideo;
      try {
        const nextStream = await environment.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active) {
          nextStream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        stream = nextStream;
        nextVideo.muted = true;
        nextVideo.playsInline = true;
        nextVideo.srcObject = nextStream;
        await nextVideo.play();
        if (!active) return;

        const detector = environment.createDetector();
        const scan = async () => {
          if (!active) return;
          try {
            const result = await detector.detect(nextVideo);
            const code = result.find(
              (candidate): candidate is { rawValue: string } =>
                typeof candidate.rawValue === "string" &&
                candidate.rawValue.length > 0,
            )?.rawValue;
            if (code) {
              stop();
              onCode(code);
              return;
            }
          } catch (error) {
            stop();
            onError(
              error instanceof Error
                ? error
                : new Error("The camera could not read that QR code."),
            );
            return;
          }
          scanTimer = environment.setTimeout(() => void scan(), 250);
        };
        sessionTimer = environment.setTimeout(() => {
          stop();
          onError(new Error("Camera scanning stopped after two minutes."));
        }, PAIRING_SESSION_TIMEOUT_MS);
        void scan();
      } catch (error) {
        stop();
        onError(
          error instanceof Error
            ? error
            : new Error("The camera could not start."),
        );
      }
    },
    stop,
  };
}

/** Build the browser adapter only after feature detection succeeds. */
export function createBrowserPairingQrScanner() {
  const browserWindow = window as Window & {
    BarcodeDetector?: new (options: { formats: string[] }) => PairingQrDetector;
  };
  const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
    navigator.mediaDevices,
  );
  if (
    !pairingCameraSupported({
      barcodeDetector: browserWindow.BarcodeDetector,
      getUserMedia,
    })
  ) {
    throw new Error("Camera QR scanning is not available in this browser.");
  }
  const BarcodeDetector = browserWindow.BarcodeDetector;
  if (!BarcodeDetector || !getUserMedia) {
    throw new Error("Camera QR scanning is not available in this browser.");
  }
  return createPairingQrScanner({
    clearTimeout: window.clearTimeout,
    createDetector: () => new BarcodeDetector({ formats: ["qr_code"] }),
    getUserMedia,
    setTimeout: window.setTimeout,
  });
}
