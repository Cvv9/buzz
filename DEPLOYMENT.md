# Deployment and CI/CD

> Repository-local delivery contract, verified 2026-10-06. Portfolio
> governance is maintained in the [VarVik Suite delivery registry](https://github.com/VarVik-Studios/varvik-suite/blob/main/config/deployments/repository-delivery-registry.json).

## Runtime

- **Status:** `production_artifact_source`
- **Production:** VarVik Suite operates the observed relay on its Azure business host at https://buzz.varvikstudios.com; artifact publication and runtime deployment are separate.

## Continuous integration

GitHub CI on main/release, pull requests and manual dispatch; explicit release/canary workflows

## Continuous delivery

Immutable relay-tag workflows publish qualified GHCR artifacts; desktop/mobile use independent release lanes; Suite operations select and deploy the relay image

## Safety boundary

A normal main-branch commit must not deploy the live relay.

Changing this contract requires the same pull request to update this file and
the central registry. A workflow file, deploy script, framework template, old
provider URL, or historical Actions run is not evidence of current production
ownership.

## Source, runtime and recovery evidence

Read [the dated runtime and backup observation](docs/release/2026-10-06/RUNTIME_EVIDENCE.md) and [its source receipt](docs/release/2026-10-06/delivery-source-observation.json). Explore the [release identity sequence](docs/architecture/relay-delivery.sequence.html), backed by its [specification](docs/architecture/relay-delivery.sequence.json). These records distinguish current repository controls from the observed deployment and retained native pin.

The [previous delivery card](docs/archive/DEPLOYMENT-2026-10-06-before-azure-review.md) retains its original date and former Lightsail declaration. This local correction is paired with the Suite registry review; publication and adoption remain separate.
