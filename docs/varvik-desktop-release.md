# VarVik Desktop Release Channel

This document describes the independent native-app channel for `Cvv9/buzz`.
It must be configured before distributing the first VarVik Windows or macOS
installer.

The web application and the desktop application are separate artifacts:

- A web/relay deployment changes server-backed data immediately: messages,
  channels, agent records, and avatars.
- A native UI or Tauri change needs a desktop release. An updater-enabled
  desktop install checks at launch and every six hours, downloads a verified
  update, then asks the user to install and relaunch it.

Treat every user-facing Buzz product release as coordinated: deploy the web
build and publish a higher `desktop-v<VERSION>` containing the corresponding
desktop implementation. Server-only data/configuration deployments do not need
an empty native rebuild.

Do not point VarVik builds at the upstream `block/buzz` updater. It can replace
a customized desktop client with an upstream build.

## Release channel

The release workflow derives the endpoint and asset URLs from the repository
that publishes the release. For this fork those URLs are:

```text
https://github.com/Cvv9/buzz/releases/download/buzz-desktop-latest/latest.json
https://github.com/Cvv9/buzz/releases/download/desktop-v<VERSION>/<asset>
```

The website download links, desktop manual-update link, updater endpoint, and
generated `latest.json` asset URLs must always use that same release channel.
The workflow creates the rolling `buzz-desktop-latest` release automatically
when publishing the first stable desktop release.
The local release-candidate script derives its changelog links from `origin`,
so the configured `origin` remote must remain `https://github.com/Cvv9/buzz.git`
when publishing from this fork.

## Identity and signing

Complete this setup before the first installer is distributed:

1. Use a new, permanent Tauri updater key pair for VarVik. Every future update
   must be signed by its private key and verified against its embedded public
   key. Back up the private key in the organization password vault; rotating it
   later does not update already-installed clients.
2. Keep the current bundle identifier for the first VarVik release so the
   existing pilot installation and its local data can migrate cleanly. Changing
   the identifier later requires an explicit data/keychain migration and a
   one-time reinstall.
3. Non-upstream releases use VarVik's Apple Developer ID certificate and App
   Store Connect API key. The workflow signs, notarizes, and staples the `.app`
   before creating the updater archive, then notarizes and staples the DMG.
4. Authenticode-sign the Windows NSIS installer when distributing beyond the
   pilot. The existing workflow labels
   it `_alpha-unsigned`; Tauri updater signatures protect update integrity, but
   do not prevent Windows SmartScreen / "Unknown publisher" warnings.

## GitHub configuration

Configure these names in the `Cvv9/buzz` repository before using the current
workflow. Never put the actual values in this repository.

| GitHub setting | Name | Purpose |
| --- | --- | --- |
| Secret | `BUZZ_UPDATER_PUBLIC_KEY` | Public half of the permanent Tauri updater key, embedded into release builds. |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Private half used to sign updater archives. |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater private key. |
| Secret | `APPLE_CERTIFICATE_BASE64` | Base64 Developer ID Application `.p12` certificate. |
| Secret | `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate. |
| Variable | `APPLE_SIGNING_IDENTITY` | Full Developer ID Application signing identity. |
| Variable | `APPLE_TEAM_ID` | Apple Developer team ID expected in the signed app. |
| Secret | `APPLE_API_KEY_BASE64` | Base64 App Store Connect API-key `.p8` file. |
| Variable | `APPLE_API_KEY_ID` | App Store Connect API key ID. |
| Variable | `APPLE_API_ISSUER_ID` | App Store Connect issuer ID. |

The optional release-candidate automation additionally uses
`BUZZ_RELEASE_TAGGER_CLIENT_ID` (variable) and
`BUZZ_RELEASE_TAGGER_PRIVATE_KEY` (secret). They are not needed when an
authorized maintainer creates the immutable `desktop-v*` tag manually.

Generate the updater key outside the repository, then store the two halves in
the listed GitHub secrets:

```sh
cd desktop
pnpm tauri signer generate --write-keys /secure/location/varvik-buzz-updater.key
```

The command prints the public key and writes the private key. Do not commit the
written key or share it through chat.

## First release checklist

1. Add the required signing secrets and variables above. Configure the optional
   GitHub App if automatic tagging is retained, and protect `desktop-v*` tags
   against modification/deletion.
2. Validate the repository configuration without exposing secret values:

   ```sh
   bash scripts/verify-varvik-desktop-release-readiness.sh
   ```

   From PowerShell on Windows, invoke the Git-for-Windows shell explicitly
   rather than the WSL `bash` shim:

   ```powershell
   & 'C:\Program Files\Git\bin\bash.exe' scripts/verify-varvik-desktop-release-readiness.sh
   ```

3. Cut `desktop-v0.5.4` or a higher stable version. Publish the versioned
   release first, then upload `latest.json` last. Confirm it contains
   `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64` entries that point
   to assets in the same VarVik release channel.
4. Install this first updater-enabled installer manually on Windows and each
   Mac architecture. Later coordinated desktop releases update in place;
   server-only deployments continue to synchronize through the relay.

## Verification after publishing

On a clean device, install the matching package:

- Apple Silicon Mac: `Buzz_<version>_aarch64.dmg`
- Intel Mac: `Buzz_<version>_x64.dmg`
- Windows: the Authenticode-signed x64 NSIS installer

Sign in to the same Buzz identity and production community. The client should
show the same server-backed agents, channels, messages, and avatars as the web
app. Native notification permission, Inbox/read-state UI, and local settings
remain per-device.

For the next release, use the in-app update check. It should discover the
update from the VarVik `latest.json`, download it, and offer **Install and
relaunch** without requiring a new installer.

## Signing hardening still recommended

The current Windows job deliberately publishes an `_alpha-unsigned` installer.
That does not break Tauri's updater verification, but it does cause an unknown
publisher / SmartScreen warning. Before distributing beyond the pilot, add an
Authenticode signing step backed by a VarVik certificate (or a hardware-backed
signing provider) and treat its credentials as release secrets.

The macOS signing path is already wired for a Developer ID Application
certificate and App Store Connect API key. The release workflow stops during
setup with the exact missing names rather than producing an unsigned Mac build.
