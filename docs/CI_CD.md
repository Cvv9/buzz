# CI/CD ownership for the Cvv9 fork

This repository is the VarVik-maintained `Cvv9/buzz` fork. Production Buzz runs
on the VarVik business Lightsail node through the guarded `varvik-suite`
deployment flow; a normal Buzz source merge does not deploy that node.

## Validation

Run `just ci` locally before opening a pull request. GitHub Actions runs the
path-filtered CI graph on pull requests and may be started manually when hosted
evidence is specifically required. The full graph is not rerun after merge to
`main`; the already-reviewed PR result is the merge gate. The `release` branch
retains its push validation for release preparation.

Docker validation runs on pull requests only when container inputs change.
Cross-platform desktop canaries and mobile release candidates are manual. Helm
workflows remain scoped to their chart paths.

## Publication and deployment

- Relay and push-gateway container publication runs only for an intentional
  `relay-v*` tag or manual rescue dispatch. By default images publish under the
  current repository owner (`ghcr.io/cvv9/...`); repository variables may
  override the registry names.
- Sprig builds publish for `sprig-v*` tags. An operator may manually request a
  rolling `sprig-latest` release; the workflow creates it when the fork does not
  already have one.
- Business-node deployment is owned by `VarVik-Studios/varvik-suite`, which
  consumes an explicitly configured image and performs its own validation and
  health checks.

This separation prevents a fork merge from repeating the full PR suite, trying
to publish into Block's upstream package namespace, or waking production without
an explicit release/deployment action.
