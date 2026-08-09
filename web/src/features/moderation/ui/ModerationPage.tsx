import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listWorkspaceCommunityMembers } from "@/features/workspace/workspace-api";
import { useWorkspaceIdentity } from "@/features/workspace/useWorkspaceIdentity";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import {
  listCommunityRestrictions,
  listModerationAudit,
  listModerationReports,
  submitModeration,
  submitReport,
} from "../moderation-api";
import { isModeratorRole, type ReportType } from "../moderation-policy";

const reportTypes: ReportType[] = [
  "spam",
  "impersonation",
  "profanity",
  "malware",
  "nudity",
  "illegal",
  "other",
];

export function ModerationPage() {
  const { identity } = useWorkspaceIdentity();
  const queryClient = useQueryClient();
  const [authorPubkey, setAuthorPubkey] = React.useState("");
  const [eventId, setEventId] = React.useState("");
  const [reportType, setReportType] = React.useState<ReportType>("spam");
  const [note, setNote] = React.useState("");
  const membersQuery = useQuery({
    queryKey: ["workspace-community-members"],
    queryFn: listWorkspaceCommunityMembers,
    enabled: Boolean(identity),
  });
  const ownRole = membersQuery.data?.find(
    (member) => member.pubkey === identity?.pubkey.toLowerCase(),
  )?.role;
  const moderator = isModeratorRole(ownRole);
  const reportsQuery = useQuery({
    queryKey: ["moderation-reports", "open"],
    queryFn: () => listModerationReports("open"),
    enabled: moderator,
    refetchInterval: 15_000,
  });
  const auditQuery = useQuery({
    queryKey: ["moderation-audit"],
    queryFn: listModerationAudit,
    enabled: moderator,
    refetchInterval: 15_000,
  });
  const restrictionsQuery = useQuery({
    queryKey: ["moderation-restrictions"],
    queryFn: listCommunityRestrictions,
    enabled: moderator,
    refetchInterval: 15_000,
  });
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["moderation-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["moderation-audit"] }),
      queryClient.invalidateQueries({ queryKey: ["moderation-restrictions"] }),
    ]);
  const reportMutation = useMutation({ mutationFn: submitReport });
  const commandMutation = useMutation({
    mutationFn: submitModeration,
    onSuccess: () => void invalidate(),
  });
  const report = () =>
    reportMutation.mutate({ authorPubkey, eventId, reportType, note });
  const enforce = (
    input: Parameters<typeof submitModeration>[0],
    confirmation: string,
  ) => {
    if (window.confirm(confirmation)) commandMutation.mutate(input);
  };
  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-7">
      <h1 className="text-2xl font-semibold">Moderation</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Report a message privately to the relay moderators. Admin controls below
        are advisory; the relay remains the authorization authority.
      </p>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Report message</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            aria-label="Reported author pubkey"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Author pubkey"
            value={authorPubkey}
            onChange={(event) => setAuthorPubkey(event.target.value)}
          />
          <input
            aria-label="Reported event id"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Message event id"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
          />
          <select
            aria-label="Report type"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={reportType}
            onChange={(event) =>
              setReportType(event.target.value as ReportType)
            }
          >
            {reportTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <input
            aria-label="Report note"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Optional note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <Button
          className="mt-3"
          disabled={reportMutation.isPending || !identity}
          type="button"
          onClick={report}
        >
          Submit report
        </Button>
        {reportMutation.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {reportMutation.error.message}
          </p>
        ) : null}
      </section>
      {!moderator ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Moderator queue access is available to community owners and admins.
        </p>
      ) : null}
      {moderator ? (
        <>
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Open reports</h2>
            <div className="mt-3 space-y-3">
              {reportsQuery.data?.map((report) => (
                <article
                  className="rounded-md border border-border p-3 text-sm"
                  key={report.id}
                >
                  <p>
                    <span className="font-medium">{report.reportType}</span> ·{" "}
                    {report.targetKind} {report.target.slice(0, 16)}…
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {report.note ?? "No reporter note"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        enforce(
                          {
                            action: "resolve",
                            reportEventId: report.reportEventId,
                            status: "dismissed",
                            resolution: "dismiss",
                          },
                          "Dismiss this report?",
                        )
                      }
                    >
                      Dismiss
                    </Button>
                    {report.targetKind === "event" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          enforce(
                            {
                              action: "resolve",
                              reportEventId: report.reportEventId,
                              status: "resolved",
                              resolution: "delete",
                            },
                            "Resolve this report as delete?",
                          )
                        }
                      >
                        Resolve delete
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
              {!reportsQuery.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No open reports.
                </p>
              ) : null}
            </div>
          </section>
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Active restrictions</h2>
            <div className="mt-3 space-y-2">
              {restrictionsQuery.data?.map((restriction) => (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm"
                  key={restriction.pubkey}
                >
                  <code className="text-xs">{restriction.pubkey}</code>
                  <span className="text-muted-foreground">
                    {restriction.banned
                      ? "Banned"
                      : restriction.mutedUntil
                        ? "Timed out"
                        : "Restricted"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      enforce(
                        {
                          action: restriction.banned ? "unban" : "untimeout",
                          pubkey: restriction.pubkey,
                        },
                        `Lift the restriction for ${truncatePubkey(restriction.pubkey)}?`,
                      )
                    }
                  >
                    Lift
                  </Button>
                </div>
              ))}
              {!restrictionsQuery.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No active restrictions.
                </p>
              ) : null}
            </div>
          </section>
          <section className="mt-6 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Audit log</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {auditQuery.data?.map((action) => (
                <li className="rounded-md bg-muted p-2" key={action.id}>
                  {action.action} by{" "}
                  <code>{truncatePubkey(action.actorPubkey)}</code> ·{" "}
                  {new Date(action.createdAt).toLocaleString()}
                </li>
              ))}
              {!auditQuery.data?.length ? (
                <li className="text-muted-foreground">No recent actions.</li>
              ) : null}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
