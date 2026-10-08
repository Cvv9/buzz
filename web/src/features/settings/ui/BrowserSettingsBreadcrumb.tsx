import { Link } from "@tanstack/react-router";
import * as React from "react";

type Crumb = { label: string; to: "/" | "/settings" };

const SETTINGS_TRAIL: Crumb[] = [
  { label: "Workspace", to: "/" },
  { label: "Settings", to: "/settings" },
];

/**
 * A consistent return path for pages outside the workspace shell. The default
 * trail is Workspace / Settings; pages reached straight from the workspace
 * pass a shorter trail.
 */
export function BrowserSettingsBreadcrumb({
  current,
  trail = SETTINGS_TRAIL,
}: {
  current: string;
  trail?: Crumb[];
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-8 flex items-center gap-2 text-sm"
    >
      {trail.map((crumb) => (
        <React.Fragment key={crumb.to}>
          <Link
            className="text-muted-foreground hover:text-foreground"
            to={crumb.to}
          >
            {crumb.label}
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
        </React.Fragment>
      ))}
      <span aria-current="page">{current}</span>
    </nav>
  );
}
