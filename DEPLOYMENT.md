# Deployment and CI/CD

> Repository-local delivery contract, verified 2026-08-03. Portfolio
> governance is maintained in the [VarVik Suite delivery registry](https://github.com/VarVik-Studios/varvik-suite/blob/main/config/deployments/repository-delivery-registry.json).

## Runtime

- **Status:** `production_artifact_source`
- **Production:** The live relay is operated by VarVik Suite on the business Lightsail node at https://buzz.varvikstudios.com

## Continuous integration

GitHub CI plus explicit release/canary workflows

## Continuous delivery

Tag/manual workflows publish GHCR and desktop/mobile release artifacts; Suite operations choose and deploy the relay image

## Safety boundary

A normal main-branch commit must not deploy the live relay.

Changing this contract requires the same pull request to update this file and
the central registry. A workflow file, deploy script, framework template, old
provider URL, or historical Actions run is not evidence of current production
ownership.
