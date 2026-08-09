import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode } from "nostr-tools/nip19";
import { installWorkspaceRelayMock } from "./helpers/workspaceRelayMock";

const huddleId = "123e4567-e89b-42d3-a456-426614174000";

test("huddle history updates live and browser audio tears down mocked capture", async ({
  page,
}) => {
  const secretKey = generateSecretKey();
  const viewerPubkey = getPublicKey(secretKey);
  await page.addInitScript(() => {
    let stopped = false;
    const fakeTrack = {
      enabled: true,
      stop: () => {
        stopped = true;
      },
    };
    const fakeStream = {
      getAudioTracks: () => [fakeTrack],
      getTracks: () => [fakeTrack],
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => fakeStream,
    });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        { kind: "audioinput", deviceId: "mock-mic", label: "Mock microphone" },
      ],
    });
    class FakeAudioContext {
      sampleRate = 48_000;
      state = "running";
      destination = {};
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        return { connect() {}, disconnect() {}, onaudioprocess: null };
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
    }
    class FakeAudioData {
      close() {}
      numberOfChannels = 1;
      numberOfFrames = 960;
      sampleRate = 48_000;
      timestamp = 0;
      copyTo() {}
    }
    class FakeAudioEncoder {
      configure(_config: unknown) {}
      encode(_frame: unknown) {}
      close() {}
    }
    class FakeAudioDecoder {
      configure(_config: unknown) {}
      decode(_chunk: unknown) {}
      close() {}
    }
    class FakeEncodedAudioChunk {}
    Object.assign(window, {
      AudioContext: FakeAudioContext,
      AudioData: FakeAudioData,
      AudioEncoder: FakeAudioEncoder,
      AudioDecoder: FakeAudioDecoder,
      EncodedAudioChunk: FakeEncodedAudioChunk,
      __BUZZ_WEB_E2E_HUDDLE_TRACK_STOPPED__: () => stopped,
    });
  });
  await installWorkspaceRelayMock(page, viewerPubkey);
  await page.goto("/");
  await page.getByLabel("Display name").fill("Vikram");
  await page.getByLabel("Recovery key").fill(nsecEncode(secretKey));
  await page
    .getByLabel("Password", { exact: true })
    .fill("huddle-test-password");
  await page.getByLabel("Confirm password").fill("huddle-test-password");
  await page.getByRole("button", { name: "Sign in with recovery key" }).click();
  await expect(page.getByLabel("Message general")).toBeVisible();

  await page.goto("/huddles/general");
  await expect(page.getByRole("heading", { name: "Huddles" })).toBeVisible();
  await page.evaluate((sessionId) => {
    const helpers = window as typeof window & {
      __BUZZ_WEB_E2E_EMIT__: (event: unknown) => void;
      __BUZZ_WEB_E2E_EVENT__: (
        kind: number,
        pubkey: string,
        tags: string[][],
        content: string,
        suffix: string,
      ) => unknown;
    };
    helpers.__BUZZ_WEB_E2E_EMIT__(
      helpers.__BUZZ_WEB_E2E_EVENT__(
        48100,
        "a".repeat(64),
        [["h", "general"]],
        JSON.stringify({ ephemeral_channel_id: sessionId }),
        "huddle-start",
        Math.floor(Date.now() / 1_000),
      ),
    );
  }, huddleId);
  const session = page.getByTestId("huddle-session");
  await expect(session).toContainText("Huddle in progress");
  await session.getByRole("button", { name: "Join audio" }).click();
  await expect(
    session.getByRole("button", { name: "Leave audio" }),
  ).toBeVisible();
  await session.getByRole("button", { name: "Leave audio" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            __BUZZ_WEB_E2E_HUDDLE_TRACK_STOPPED__: () => boolean;
          }
        ).__BUZZ_WEB_E2E_HUDDLE_TRACK_STOPPED__(),
      ),
    )
    .toBe(true);
});
