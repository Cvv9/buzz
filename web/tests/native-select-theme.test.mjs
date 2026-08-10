import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native select menus use semantic theme surfaces", async () => {
  const stylesheet = await readFile(
    new URL("../src/shared/styles/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    stylesheet,
    /select option,\s*select optgroup\s*{[^}]*background-color:\s*hsl\(var\(--popover\)\);[^}]*color:\s*hsl\(var\(--popover-foreground\)\);/s,
  );
  assert.match(
    stylesheet,
    /select option:disabled\s*{[^}]*color:\s*hsl\(var\(--muted-foreground\)\);/s,
  );
});
