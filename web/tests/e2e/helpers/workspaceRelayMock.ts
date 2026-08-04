import type { Page } from "@playwright/test";

export async function installWorkspaceRelayMock(
  page: Page,
  viewerPubkey: string,
  options: {
    generalMemberPubkeys?: string[];
    hostedAgentConfig?: {
      agentPubkey: string;
      name: string;
      avatarUrl: string;
      model: string;
    };
  } = {},
) {
  await page.addInitScript(
    ({ pubkey, generalMemberPubkeys, hostedAgentConfig }) => {
      const event = (
        kind: number,
        eventPubkey: string,
        tags: string[][],
        content = "",
        suffix = "0",
      ) => ({
        id: suffix.padStart(64, "0"),
        pubkey: eventPubkey,
        created_at: 1,
        kind,
        tags,
        content,
        sig: "0".repeat(128),
      });
      const agentEvents = Array.from({ length: 18 }, (_, index) => {
        const agentPubkey = (index + 1).toString(16).padStart(64, "0");
        return event(
          10100,
          agentPubkey,
          [],
          JSON.stringify({
            name: `Workspace Agent ${index + 1}`,
            aliases: index === 6 ? ["Research Agent"] : [],
            access_tier: index < 6 ? "personal" : "shared",
          }),
          (index + 10).toString(16),
        );
      });
      const hostedConfigEvents = hostedAgentConfig
        ? [
            event(
              30179,
              pubkey,
              [["d", hostedAgentConfig.agentPubkey]],
              JSON.stringify({
                schema: "buzz.hosted-agent-config.v1",
                agent_pubkey: hostedAgentConfig.agentPubkey,
                name: hostedAgentConfig.name,
                avatar_url: hostedAgentConfig.avatarUrl,
                model: hostedAgentConfig.model,
              }),
              "88",
            ),
          ]
        : [];
      const sockets = new Set<MockWebSocket>();
      const publishedEvents: ReturnType<typeof event>[] = [];
      let reactionQueryCount = 0;

      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readonly url: string;
        readyState = MockWebSocket.CONNECTING;
        private readonly listeners = new Map<
          string,
          Set<(event: Event) => void>
        >();
        private readonly subscriptions = new Map<
          string,
          {
            kinds?: number[];
            authors?: string[];
            "#e"?: string[];
            "#h"?: string[];
          }
        >();

        constructor(url: string | URL) {
          this.url = String(url);
          sockets.add(this);
          window.setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit("open", new Event("open"));
            this.emit(
              "message",
              new MessageEvent("message", {
                data: JSON.stringify(["AUTH", "workspace-e2e-challenge"]),
              }),
            );
          }, 0);
        }

        addEventListener(type: string, listener: EventListener) {
          const listeners = this.listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(type: string, listener: EventListener) {
          this.listeners.get(type)?.delete(listener);
        }

        send(payload: string) {
          const envelope = JSON.parse(payload) as unknown[];
          if (envelope[0] === "AUTH") {
            const auth = envelope[1] as ReturnType<typeof event>;
            window.setTimeout(
              () =>
                this.emit(
                  "message",
                  new MessageEvent("message", {
                    data: JSON.stringify(["OK", auth.id, true, ""]),
                  }),
                ),
              0,
            );
            return;
          }
          if (envelope[0] === "EVENT") {
            const published = envelope[1] as ReturnType<typeof event>;
            publishedEvents.push(published);
            window.setTimeout(
              () =>
                this.emit(
                  "message",
                  new MessageEvent("message", {
                    data: JSON.stringify(["OK", published.id, true, ""]),
                  }),
                ),
              0,
            );
            return;
          }
          if (envelope[0] !== "REQ") return;
          const subscriptionId = String(envelope[1]);
          const filter = (envelope[2] ?? {}) as {
            kinds?: number[];
            authors?: string[];
            "#e"?: string[];
            "#h"?: string[];
          };
          this.subscriptions.set(subscriptionId, filter);
          const kinds = filter.kinds ?? [];
          let events: ReturnType<typeof event>[] = [];
          if (kinds.includes(39002)) {
            events = [
              event(
                39002,
                "f".repeat(64),
                [
                  ["d", "general"],
                  ["p", pubkey, "", "owner"],
                  ...generalMemberPubkeys.map((memberPubkey) => [
                    "p",
                    memberPubkey,
                    "",
                    "bot",
                  ]),
                ],
                "",
                "1",
              ),
              event(
                39002,
                "f".repeat(64),
                [
                  ["d", "random"],
                  ["p", pubkey, "", "owner"],
                ],
                "",
                "3",
              ),
            ];
          } else if (kinds.length === 1 && kinds.includes(39000)) {
            events = [
              event(
                39000,
                "f".repeat(64),
                [
                  ["d", "general"],
                  ["name", "general"],
                ],
                "",
                "2",
              ),
              event(
                39000,
                "f".repeat(64),
                [
                  ["d", "random"],
                  ["name", "random"],
                ],
                "",
                "4",
              ),
            ];
          } else if (kinds.includes(30179)) {
            events = hostedConfigEvents;
          } else if (kinds.includes(10100) || kinds.includes(30177)) {
            events = agentEvents;
          } else if (kinds.includes(13534)) {
            events = [
              event(
                13534,
                "f".repeat(64),
                [["member", pubkey, "owner"]],
                "",
                "89",
              ),
            ];
          } else if (
            kinds.length === 1 &&
            kinds.includes(0) &&
            filter.authors?.includes(pubkey)
          ) {
            events = [
              event(
                0,
                pubkey,
                [],
                JSON.stringify({
                  about: "Existing founder profile",
                  picture:
                    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
                  custom_field: "preserve-me",
                }),
                "5",
              ),
            ];
          } else if (kinds.includes(9) && kinds.includes(40002)) {
            events = [
              event(
                9,
                "a".repeat(64),
                [["h", "general"]],
                "Welcome to Buzz",
                "6",
              ),
              event(
                9,
                "b".repeat(64),
                [
                  ["h", "general"],
                  ["e", "6".padStart(64, "0"), "", "root"],
                  ["e", "6".padStart(64, "0"), "", "reply"],
                ],
                "A threaded reply",
                "7",
              ),
            ];
          } else if (kinds.length === 1 && kinds.includes(7)) {
            if (subscriptionId.startsWith("q-")) reactionQueryCount += 1;
            const targetIds = filter["#e"] ?? [];
            const deletedReactionIds = new Set(
              publishedEvents
                .filter((published) => published.kind === 5)
                .flatMap((published) =>
                  published.tags
                    .filter((tag) => tag[0] === "e")
                    .map((tag) => tag[1]),
                ),
            );
            const seededReactions = targetIds.includes("6".padStart(64, "0"))
              ? [
                  event(
                    7,
                    "1".padStart(64, "0"),
                    [["e", "6".padStart(64, "0")]],
                    "👍",
                    "101",
                  ),
                ]
              : [];
            events = [
              ...seededReactions,
              ...publishedEvents.filter(
                (published) =>
                  published.kind === 7 &&
                  !deletedReactionIds.has(published.id) &&
                  (!targetIds.length ||
                    published.tags.some(
                      (tag) => tag[0] === "e" && targetIds.includes(tag[1]),
                    )) &&
                  (!filter.authors?.length ||
                    filter.authors.includes(published.pubkey)),
              ),
            ];
          }
          window.setTimeout(() => {
            for (const relayEvent of events) {
              this.emit(
                "message",
                new MessageEvent("message", {
                  data: JSON.stringify(["EVENT", subscriptionId, relayEvent]),
                }),
              );
            }
            this.emit(
              "message",
              new MessageEvent("message", {
                data: JSON.stringify(["EOSE", subscriptionId]),
              }),
            );
          }, 0);
        }

        close() {
          if (this.readyState === MockWebSocket.CLOSED) return;
          this.readyState = MockWebSocket.CLOSED;
          sockets.delete(this);
          this.emit("close", new CloseEvent("close"));
        }

        emitRelayEvent(relayEvent: ReturnType<typeof event>) {
          for (const [subscriptionId, filter] of this.subscriptions) {
            if (
              filter.kinds?.length &&
              !filter.kinds.includes(relayEvent.kind)
            ) {
              continue;
            }
            if (
              filter["#h"]?.length &&
              !relayEvent.tags.some(
                (tag) => tag[0] === "h" && filter["#h"]?.includes(tag[1]),
              )
            ) {
              continue;
            }
            if (
              filter["#e"]?.length &&
              !relayEvent.tags.some(
                (tag) => tag[0] === "e" && filter["#e"]?.includes(tag[1]),
              )
            ) {
              continue;
            }
            this.emit(
              "message",
              new MessageEvent("message", {
                data: JSON.stringify(["EVENT", subscriptionId, relayEvent]),
              }),
            );
          }
        }

        private emit(type: string, event: Event) {
          for (const listener of this.listeners.get(type) ?? []) {
            listener.call(this, event);
          }
        }
      }

      window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
      Object.assign(window, {
        __BUZZ_WEB_E2E_EMIT__: (relayEvent: ReturnType<typeof event>) => {
          for (const socket of sockets) {
            if (socket.readyState === MockWebSocket.OPEN) {
              socket.emitRelayEvent(relayEvent);
            }
          }
        },
        __BUZZ_WEB_E2E_EVENT__: event,
        __BUZZ_WEB_E2E_PUBLISHED__: publishedEvents,
        __BUZZ_WEB_E2E_REACTION_QUERY_COUNT__: () => reactionQueryCount,
      });
    },
    {
      pubkey: viewerPubkey,
      generalMemberPubkeys: options.generalMemberPubkeys ?? [],
      hostedAgentConfig: options.hostedAgentConfig ?? null,
    },
  );
}
