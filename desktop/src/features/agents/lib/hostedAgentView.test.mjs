import assert from "node:assert/strict";
import test from "node:test";

import { localRosterForHostedCommunity } from "./hostedAgentView.ts";

const persona = (id, isBuiltIn = true) => ({ id, isBuiltIn });
const team = (id, isBuiltin = true) => ({ id, isBuiltin });

test("keeps the starter roster when no hosted agents are available", () => {
  const personas = [persona("builtin:fizz")];
  const teams = [team("builtin-team:welcome")];

  assert.deepEqual(localRosterForHostedCommunity(personas, teams, false), {
    personas,
    teams,
  });
});

test("removes only pristine built-in starter entries in hosted communities", () => {
  const result = localRosterForHostedCommunity(
    [
      persona("builtin:fizz"),
      persona("builtin:honey"),
      persona("builtin:bumble"),
      persona("custom:research", false),
    ],
    [team("builtin-team:welcome"), team("custom:ops", false)],
    true,
  );

  assert.deepEqual(
    result.personas.map((entry) => entry.id),
    ["custom:research"],
  );
  assert.deepEqual(
    result.teams.map((entry) => entry.id),
    ["custom:ops"],
  );
});
