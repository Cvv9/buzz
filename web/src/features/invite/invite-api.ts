import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

const INVITE_REQUEST_TIMEOUT_MS = 15_000;

export type BrowserInviteClaim = {
  status: "joined" | "already_member";
  communityId: string;
  host: string;
  role: string;
};

export type MintedBrowserInvite = {
  code: string;
  expiresAt: number;
  url: string;
};

export async function mintBrowserInvite(): Promise<MintedBrowserInvite> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/invites`;
  const body = JSON.stringify({ max_uses: 1 });
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(INVITE_REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : `HTTP ${response.status}`,
    );
  }
  return {
    code: String(json.code),
    expiresAt: Number(json.expires_at),
    url: String(json.url),
  };
}

export async function claimInviteInBrowser(
  code: string,
  policyReceipt?: string,
): Promise<BrowserInviteClaim> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/invites/claim`;
  const body = JSON.stringify({
    code,
    policy_receipt: policyReceipt,
  });
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(INVITE_REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    status: json.status as BrowserInviteClaim["status"],
    communityId: String(json.community_id),
    host: String(json.host),
    role: String(json.role),
  };
}
