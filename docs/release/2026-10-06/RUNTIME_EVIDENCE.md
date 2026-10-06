# Buzz runtime and recovery evidence — 6 October 2026

This is a dated, filtered observation, not a release-success certificate. Current source controls were inspected at Buzz `6c6d1996e94c4466572975a3efaf15a7ee17b010`. Suite verification/maintenance source was inspected at the exact candidate base recorded in the [source receipt](delivery-source-observation.json). Application source, runtime image, web bundle, native release pin and backup/restore evidence keep separate identities.

## Source controls

Buzz CI runs on main/release pushes, pull requests and manual dispatch. The relay Docker workflow publishes for relay version tags and permits manual rescue only at the matching immutable relay tag/source. Native architecture builds push candidate digests; qualified multi-architecture release manifests additionally require successful same-SHA CI and publish provenance/deployment-eligibility evidence. A candidate digest by itself is not that qualification. The fork defaults to `ghcr.io/cvv9/buzz`; repository variables may select another explicit image channel.

Hosted agent images have a separate version/tag-verified manual workflow. Browser bundles have exact-source web tags. Desktop/mobile use independent release lanes. The upstream staging-dev workflow is restricted to block/buzz and is not a VarVik production deployment path. The Suite operator's runtime selection remains separate from all of these artifact workflows. See [the sequence](../../architecture/relay-delivery.sequence.html) and [DEPLOYMENT.md](../../../DEPLOYMENT.md).

## Runtime and pinned artifact

| Evidence | Dated observed value | Qualification |
|---|---|---|
| Operator placement | Azure business host, clean Buzz Compose project | Does not establish latest-main deployment |
| Running relay image ID | `sha256:48bb611d489cc6beb63240a2928b64840f350c353dcaaacf117a0b6bad103c92` | Running and healthy at the recorded observation |
| Running image OCI source label | `1afb648e6a489ebc0b1e7560c8f157449d619d25` | Label correlation; reproducible build/source contents not attested here |
| Native retained artifact | `ghcr.io/cvv9/buzz:0.2.18@sha256:543d8b9d5500784da8df999387a0776bbacf7ddbc9fff4ec02a3f46880def4c2` | Public config/digest and cached filesystem metadata checked |
| Native OCI source revision | `7a266c2d7f5acad374ec31304723e0153da140b7` | Different from the running relay label |
| Native/runtime layer sequences | Different | Health and alias/tag wording cannot substitute for matching artifact evidence |
| Installed verifier target | Older fresh Buzz container | Currently stopped/unhealthy and uses a different image ID from its retained native pin |
| Clean relay web mount | Read-only bind at `/srv/buzz/web` | Web bundle and relay image identities must be qualified independently |

The cached native image reports ID `sha256:543d...` on this host, matching the installed expected_id, and its layer sequence matches the digest-verified public config. The public config object's own digest is different. The suspected index/config-ID mismatch is therefore disproved by this engine's actual metadata; do not replace expected_id using an assumed universal ID convention. The actual unresolved mismatches are the selected stopped container and the running clean relay's different source/filesystem identity. Changing only a container name, lowering a gate or borrowing health would not qualify a release.

The Suite node verifier accepts only the installed target/pin inventory and its exact verifier source, then inspects cached image identity and readiness. It is a read-only control. These observations do not change its plan, pins, allowlist, image or source revision.

## Backup and restore are separate

The loaded `varvik-clean-buzz-backup.timer` is active/waiting. Its latest trigger was 6 October 02:16:29 UTC; the service completed 02:18:23 UTC with Result=success and exit 0. The selected backup receipt reports complete=true, writersResumed=true and 28 artifacts. Its manifest checksum is `899217cb80f4f4b6b33151723dd97535534616984c0686162afe37244a7078da`. This review inspected receipt metadata, not archived contents or encryption keys.

The inspected older restore receipt reports 25 archives, matching artifact hashes, isolated database import, member/event count parity and migration-checksum parity, with liveVolumesTouched=false. It explicitly leaves tableContentParityProven=false and fullApplicationRecoveryProven=false. Its manifest checksum `ad764ec0ec82c719d80bd13491f1c9b2b62f54db7b421e2bf7df9c1f73a33377` differs from the newer 28-artifact backup. Its complete=true means that receipt's phase completed; it does not prove full application recovery or restoration of today's backup.

The checked-in Suite maintenance workflow runs read-only runtime verification on automatic events. Its legacy backup/rehearsal job is opt-in via manual dispatch and input conditions. A skipped legacy job is not proof that the independent clean-Buzz timer failed; a green timer/backup receipt is likewise not a full restore qualification. Retain source/run/time/manifest identity for each claim.

## Remaining qualification

1. Establish a reviewed immutable artifact for the intended current relay/agent/web source, with its actual build and qualification evidence. Preserve the distinction from retained 0.2.18 and current-main source.
2. Reconcile Suite source and the installed operator verification contract with that intended release and placement; preserve full pin, source and inventory checks. Obtain a fresh independent native/runtime receipt after authorized adoption.
3. Verify full application recovery and table parity from the intended latest backup in an isolated recovery environment, tied to exact manifest and source/image identities, without touching live volumes.
4. Adopt the paired owning/central documentation and qualified knowledge routing. A documentation-only change does not execute any of the runtime/recovery steps above.

No deployment, image pull, restart, verifier/allowlist mutation, backup decoding, database restore, clinical/patient read or credential output was performed for this review. The original delivery card remains archived with its original date.
