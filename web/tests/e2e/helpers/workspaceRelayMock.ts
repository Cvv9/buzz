import type { Page } from "@playwright/test";

type RuntimeMock = {
  agentPubkey: string;
  controllerPubkey: string;
  catalogDigest: string;
  revision?: number;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  state?: "current" | "pending_busy" | "applying" | "applied" | "failed";
  requestedModel?: string | null;
  requestedEffort?:
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | "ultra"
    | null;
};

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
    searchEvents?: Array<{
      kind: number;
      pubkey: string;
      tags: string[][];
      content: string;
      suffix: string;
      createdAt?: number;
    }>;
    workflowChannelId?: string;
    communityRole?: "owner" | "admin" | "member";
    runtime?: RuntimeMock;
  } = {},
) {
  if (options.runtime) {
    const runtime = options.runtime;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.headers().accept?.includes("application/nostr+json") &&
        new URL(request.url()).pathname === "/"
      ) {
        await route.fulfill({
          contentType: "application/nostr+json",
          body: JSON.stringify({
            name: "Buzz E2E",
            buzz_hosted_agent_runtime: {
              version: 1,
              controller_pubkey: runtime.controllerPubkey,
              request_kind: 24201,
              status_kind: 30181,
            },
          }),
        });
        return;
      }
      await route.fallback();
    });
  }
  await page.addInitScript(
    ({
      pubkey,
      generalMemberPubkeys,
      hostedAgentConfig,
      searchEvents,
      workflowChannelId,
      communityRole,
      runtime,
    }) => {
      const event = (
        kind: number,
        eventPubkey: string,
        tags: string[][],
        content = "",
        suffix = "0",
        createdAt = 1,
      ) => ({
        id: suffix.padStart(64, "0"),
        pubkey: eventPubkey,
        created_at: createdAt,
        kind,
        tags,
        content,
        sig: "0".repeat(128),
      });
      const agentEvents = Array.from({ length: 18 }, (_, index) => {
        const agentPubkey = (index + 1).toString(16).padStart(64, "0");
        const isRuntimeAgent = runtime?.agentPubkey === agentPubkey;
        const runtimeModel = runtime?.model ?? "gpt-5.6-sol";
        const runtimeEffort = runtime?.effort ?? "high";
        return event(
          10100,
          agentPubkey,
          [],
          JSON.stringify({
            name: `Workspace Agent ${index + 1}`,
            aliases: index === 6 ? ["Research Agent"] : [],
            about:
              index === 6
                ? "Investigates market questions and returns source-backed findings."
                : undefined,
            resources:
              index === 6
                ? ["Market Intelligence research", "Public web sources"]
                : [],
            access_tier: index < 6 ? "personal" : "shared",
            ...(isRuntimeAgent
              ? {
                  catalog_digest: runtime.catalogDigest,
                  model_families: [
                    {
                      id: "gpt-5.6-sol",
                      name: "GPT-5.6-Sol",
                      description: "Frontier model",
                      default_effort: "medium",
                      efforts: ["low", "medium", "high", "xhigh", "max"],
                    },
                    {
                      id: "gpt-5.6-terra",
                      name: "GPT-5.6-Terra",
                      description: "Balanced model",
                      default_effort: "medium",
                      efforts: ["low", "medium", "high", "xhigh"],
                    },
                    {
                      id: "gpt-3.5-turbo-16k",
                      name: "GPT-3.5-Turbo-16k",
                      description: "Legacy model",
                      default_effort: "medium",
                      efforts: ["medium"],
                    },
                  ],
                  runtime: {
                    schema: "buzz.agent-runtime.v1",
                    controller_pubkey: runtime.controllerPubkey,
                    revision: runtime.revision ?? 4,
                    model: runtimeModel,
                    effort: runtimeEffort,
                    effective_name: `Workspace Agent ${index + 1}`,
                    catalog_digest: runtime.catalogDigest,
                  },
                }
              : {}),
          }),
          (index + 10).toString(16),
        );
      });
      const runtimeStatusEvents = runtime
        ? [
            event(
              30181,
              runtime.controllerPubkey,
              [["d", runtime.agentPubkey]],
              JSON.stringify({
                schema: "buzz.hosted-agent-runtime-status.v1",
                agent_pubkey: runtime.agentPubkey,
                request_id: "550e8400-e29b-41d4-a716-446655440000",
                revision: runtime.revision ?? 4,
                state: runtime.state ?? "applied",
                effective: {
                  model: runtime.model ?? "gpt-5.6-sol",
                  effort: runtime.effort ?? "high",
                  runtime_name: "Workspace Agent 7",
                },
                requested:
                  runtime.state === "pending_busy" ||
                  runtime.state === "applying" ||
                  runtime.state === "failed"
                    ? {
                        model:
                          runtime.requestedModel ??
                          runtime.model ??
                          "gpt-5.6-sol",
                        effort:
                          runtime.requestedEffort ?? runtime.effort ?? "high",
                        runtime_name: "Workspace Agent 7",
                      }
                    : null,
                catalog_digest: runtime.catalogDigest,
                error:
                  runtime.state === "failed"
                    ? {
                        code: "adapter_rejected",
                        message:
                          "The agent could not apply this model and effort combination.",
                      }
                    : null,
              }),
              "runtime-status",
              100,
            ),
          ]
        : [];
      const hostedConfigEvents = hostedAgentConfig
        ? [
            event(
              30180,
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
      const seededSearchEvents = searchEvents.map((searchEvent) =>
        event(
          searchEvent.kind,
          searchEvent.pubkey,
          searchEvent.tags,
          searchEvent.content,
          searchEvent.suffix,
          searchEvent.createdAt,
        ),
      );
      const publishedEventsStorageKey = "buzz-web-e2e-published-events";
      const receivedEventsStorageKey = "buzz-web-e2e-received-events";
      const loadPublishedEvents = (): ReturnType<typeof event>[] => {
        try {
          const value = sessionStorage.getItem(publishedEventsStorageKey);
          const parsed: unknown = value ? JSON.parse(value) : [];
          return Array.isArray(parsed)
            ? (parsed as ReturnType<typeof event>[])
            : [];
        } catch {
          return [];
        }
      };
      const persistPublishedEvents = (events: ReturnType<typeof event>[]) => {
        sessionStorage.setItem(
          publishedEventsStorageKey,
          JSON.stringify(events),
        );
      };
      const loadReceivedEvents = (): ReturnType<typeof event>[] => {
        try {
          const value = sessionStorage.getItem(receivedEventsStorageKey);
          const parsed: unknown = value ? JSON.parse(value) : [];
          return Array.isArray(parsed)
            ? (parsed as ReturnType<typeof event>[])
            : [];
        } catch {
          return [];
        }
      };
      const persistReceivedEvents = (events: ReturnType<typeof event>[]) => {
        sessionStorage.setItem(
          receivedEventsStorageKey,
          JSON.stringify(events),
        );
      };
      const sockets = new Set<MockWebSocket>();
      const publishedEvents = loadPublishedEvents();
      const receivedEvents = loadReceivedEvents();
      let reactionQueryCount = 0;
      let lastSearchFilter: Record<string, unknown> | null = null;

      const knownEvents = () =>
        [...publishedEvents, ...receivedEvents].filter(
          (candidate, index, events) =>
            events.findIndex((event) => event.id === candidate.id) === index,
        );

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
            search?: string;
            since?: number;
            until?: number;
            "#d"?: string[];
            "#e"?: string[];
            "#h"?: string[];
            "#p"?: string[];
            "#a"?: string[];
          }
        >();

        constructor(url: string | URL) {
          this.url = String(url);
          sockets.add(this);
          window.setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit("open", new Event("open"));
            if (this.url.includes("/huddle/")) {
              this.emit(
                "message",
                new MessageEvent("message", {
                  data: JSON.stringify({
                    type: "challenge",
                    challenge: "workspace-e2e-huddle-challenge",
                  }),
                }),
              );
            } else {
              this.emit(
                "message",
                new MessageEvent("message", {
                  data: JSON.stringify(["AUTH", "workspace-e2e-challenge"]),
                }),
              );
            }
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

        send(payload: string | ArrayBuffer | ArrayBufferView) {
          if (typeof payload !== "string") return;
          const envelope = JSON.parse(payload) as unknown[];
          if (
            this.url.includes("/huddle/") &&
            !Array.isArray(envelope) &&
            (envelope as { type?: unknown }).type === "auth"
          ) {
            window.setTimeout(
              () =>
                this.emit(
                  "message",
                  new MessageEvent("message", {
                    data: JSON.stringify({ type: "joined", peers: [] }),
                  }),
                ),
              0,
            );
            return;
          }
          if (!Array.isArray(envelope)) return;
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
            persistPublishedEvents(publishedEvents);
            window.setTimeout(() => {
              this.emit(
                "message",
                new MessageEvent("message", {
                  data: JSON.stringify(["OK", published.id, true, ""]),
                }),
              );
              for (const socket of sockets) {
                if (socket.readyState === MockWebSocket.OPEN) {
                  socket.emitRelayEvent(published);
                }
              }
            }, 0);
            return;
          }
          if (envelope[0] !== "REQ") return;
          const subscriptionId = String(envelope[1]);
          const filter = (envelope[2] ?? {}) as {
            kinds?: number[];
            authors?: string[];
            search?: string;
            since?: number;
            until?: number;
            "#d"?: string[];
            "#e"?: string[];
            "#h"?: string[];
            "#p"?: string[];
            "#a"?: string[];
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
              ...(workflowChannelId
                ? [
                    event(
                      39002,
                      "f".repeat(64),
                      [
                        ["d", workflowChannelId],
                        ["p", pubkey, "", "owner"],
                      ],
                      "",
                      "workflow-membership",
                    ),
                  ]
                : []),
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
              ...(workflowChannelId
                ? [
                    event(
                      39000,
                      "f".repeat(64),
                      [
                        ["d", workflowChannelId],
                        ["name", "automations"],
                      ],
                      "",
                      "workflow-metadata",
                    ),
                  ]
                : []),
            ];
          } else if (kinds.length === 1 && kinds.includes(30181)) {
            events = [
              ...runtimeStatusEvents,
              ...knownEvents().filter((candidate) => candidate.kind === 30181),
            ];
          } else if (kinds.includes(30180)) {
            events = [
              ...hostedConfigEvents,
              ...knownEvents().filter((candidate) =>
                [30177, 30180].includes(candidate.kind),
              ),
            ];
          } else if (kinds.includes(10100) || kinds.includes(30177)) {
            events = agentEvents;
          } else if (kinds.includes(13534)) {
            events = [
              event(
                13534,
                "f".repeat(64),
                [["member", pubkey, communityRole]],
                "",
                "89",
              ),
            ];
          } else if (kinds.some((kind) => kind >= 48100 && kind <= 48106)) {
            events = knownEvents().filter(
              (candidate) =>
                kinds.includes(candidate.kind) &&
                (!filter["#h"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "h" && filter["#h"]?.includes(tag[1]),
                  )),
            );
          } else if (kinds.length === 1 && kinds.includes(0)) {
            events = [
              ...(filter.authors?.includes(pubkey)
                ? [
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
                  ]
                : []),
              ...knownEvents().filter(
                (candidate) =>
                  candidate.kind === 0 &&
                  (!filter.authors?.length ||
                    filter.authors.includes(candidate.pubkey)),
              ),
            ];
          } else if (kinds.length === 1 && kinds.includes(30315)) {
            events = knownEvents().filter(
              (candidate) =>
                candidate.kind === 30315 &&
                (!filter.authors?.length ||
                  filter.authors.includes(candidate.pubkey)) &&
                (!filter["#d"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "d" && filter["#d"]?.includes(tag[1]),
                  )),
            );
          } else if (kinds.length === 1 && kinds.includes(30620)) {
            events = knownEvents().filter(
              (candidate) =>
                candidate.kind === 30620 &&
                (!filter["#h"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "h" && filter["#h"]?.includes(tag[1]),
                  )) &&
                (!filter["#d"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "d" && filter["#d"]?.includes(tag[1]),
                  )),
            );
          } else if (kinds.length === 1 && kinds.includes(46010)) {
            events = knownEvents().filter(
              (candidate) =>
                candidate.kind === 46010 &&
                (!filter["#p"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "p" && filter["#p"]?.includes(tag[1]),
                  )),
            );
          } else if (filter.search) {
            lastSearchFilter = filter;
            const search = filter.search.toLowerCase();
            events = seededSearchEvents.filter(
              (candidate) =>
                kinds.includes(candidate.kind) &&
                candidate.content.toLowerCase().includes(search) &&
                (!filter.authors?.length ||
                  filter.authors.includes(candidate.pubkey)) &&
                (!filter["#h"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "h" && filter["#h"]?.includes(tag[1]),
                  )) &&
                (filter.since === undefined ||
                  candidate.created_at >= filter.since) &&
                (filter.until === undefined ||
                  candidate.created_at <= filter.until),
            );
          } else if (kinds.includes(9) && kinds.includes(40002)) {
            const messageEvents = [
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
              ...seededSearchEvents.filter((candidate) =>
                [9, 40002, 40003, 40099].includes(candidate.kind),
              ),
              ...knownEvents().filter((candidate) =>
                [9, 40002, 40003, 40099].includes(candidate.kind),
              ),
            ];
            events = messageEvents.filter(
              (candidate) =>
                kinds.includes(candidate.kind) &&
                (!filter.ids?.length || filter.ids.includes(candidate.id)) &&
                (!filter["#h"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "h" && filter["#h"]?.includes(tag[1]),
                  )) &&
                (!filter["#e"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "e" && filter["#e"]?.includes(tag[1]),
                  )),
            );
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
          } else {
            events = knownEvents().filter(
              (candidate) =>
                (!kinds.length || kinds.includes(candidate.kind)) &&
                (!filter.authors?.length ||
                  filter.authors.includes(candidate.pubkey)) &&
                (!filter["#a"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "a" && filter["#a"]?.includes(tag[1]),
                  )) &&
                (!filter["#d"]?.length ||
                  candidate.tags.some(
                    (tag) => tag[0] === "d" && filter["#d"]?.includes(tag[1]),
                  )) &&
                (filter.since === undefined ||
                  candidate.created_at >= filter.since) &&
                (filter.until === undefined ||
                  candidate.created_at <= filter.until),
            );
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

        hasKindSubscription(kind: number) {
          return [...this.subscriptions.values()].some((filter) =>
            filter.kinds?.includes(kind),
          );
        }

        emitRelayEvent(relayEvent: ReturnType<typeof event>) {
          if (!receivedEvents.some((event) => event.id === relayEvent.id)) {
            receivedEvents.push(relayEvent);
            persistReceivedEvents(receivedEvents);
          }
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
              filter["#p"]?.length &&
              !relayEvent.tags.some(
                (tag) => tag[0] === "p" && filter["#p"]?.includes(tag[1]),
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
            if (
              filter.authors?.length &&
              !filter.authors.includes(relayEvent.pubkey)
            ) {
              continue;
            }
            if (
              filter["#d"]?.length &&
              !relayEvent.tags.some(
                (tag) => tag[0] === "d" && filter["#d"]?.includes(tag[1]),
              )
            ) {
              continue;
            }
            if (
              filter["#a"]?.length &&
              !relayEvent.tags.some(
                (tag) => tag[0] === "a" && filter["#a"]?.includes(tag[1]),
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
        __BUZZ_WEB_E2E_RECEIVE__: (relayEvent: ReturnType<typeof event>) => {
          if (
            !receivedEvents.some((candidate) => candidate.id === relayEvent.id)
          ) {
            receivedEvents.push(relayEvent);
            persistReceivedEvents(receivedEvents);
          }
          for (const socket of sockets) {
            if (socket.readyState === MockWebSocket.OPEN) {
              socket.emitRelayEvent(relayEvent);
            }
          }
        },
        __BUZZ_WEB_E2E_EVENT__: event,
        __BUZZ_WEB_E2E_PUBLISHED__: publishedEvents,
        __BUZZ_WEB_E2E_REACTION_QUERY_COUNT__: () => reactionQueryCount,
        __BUZZ_WEB_E2E_LAST_SEARCH_FILTER__: () => lastSearchFilter,
        __BUZZ_WEB_E2E_HAS_KIND_SUBSCRIPTION__: (kind: number) =>
          [...sockets].some((socket) => socket.hasKindSubscription(kind)),
      });
    },
    {
      pubkey: viewerPubkey,
      generalMemberPubkeys: options.generalMemberPubkeys ?? [],
      hostedAgentConfig: options.hostedAgentConfig ?? null,
      searchEvents: options.searchEvents ?? [],
      workflowChannelId: options.workflowChannelId ?? null,
      communityRole: options.communityRole ?? "owner",
      runtime: options.runtime ?? null,
    },
  );
}
