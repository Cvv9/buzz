import { Link } from "@tanstack/react-router";

/** A consistent return path for browser-safe settings pages outside the shell. */
export function BrowserSettingsBreadcrumb({ current }: { current: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-8 flex items-center gap-2 text-sm"
    >
      <Link className="text-muted-foreground hover:text-foreground" to="/">
        Workspace
      </Link>
      <span aria-hidden="true" className="text-muted-foreground">
        /
      </span>
      <Link
        className="text-muted-foreground hover:text-foreground"
        to="/settings"
      >
        Settings
      </Link>
      <span aria-hidden="true" className="text-muted-foreground">
        /
      </span>
      <span aria-current="page">{current}</span>
    </nav>
  );
}
