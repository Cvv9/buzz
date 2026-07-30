#!/bin/sh
set -eu

: "${VARVIK_AGENT_PUBKEY:?set VARVIK_AGENT_PUBKEY}"
: "${BUZZ_ACP_DISPLAY_NAME:=VarVik AI}"

# Idempotent relay membership bootstrap. The command exits successfully when
# the member already exists.
buzz-admin add-member --pubkey "${VARVIK_AGENT_PUBKEY}" --role member

# Agent-authored discovery profile used by browser and desktop clients.
buzz agents publish-profile \
  --display-name "${BUZZ_ACP_DISPLAY_NAME}" \
  --about "Hosted AI collaborator for the VarVik Studios community"

exec buzz-acp
