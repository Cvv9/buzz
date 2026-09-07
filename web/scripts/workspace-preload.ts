import type { Plugin } from "vite";

/** Discover the initial workspace's static dependencies before React boots. */
export function workspacePreload(): Plugin {
  let base = "/";
  return {
    name: "buzz-workspace-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        if (!bundle) return;
        const workspace = Object.values(bundle).find(
          (entry) =>
            entry.type === "chunk" &&
            Object.keys(entry.modules).some((id) =>
              id.endsWith("/features/workspace/ui/WorkspacePage.tsx"),
            ),
        );
        if (!workspace)
          throw new Error("Workspace preload entry was not found");
        const files = new Set<string>();
        const visit = (file: string) => {
          if (files.has(file)) return;
          const chunk = bundle[file];
          if (chunk?.type !== "chunk") return;
          files.add(file);
          for (const dependency of chunk.imports) visit(dependency);
        };
        visit(workspace.fileName);
        const urls = JSON.stringify([...files].map((file) => `${base}${file}`));
        return [
          {
            tag: "script",
            // Only warm the messaging surface. Dynamic imports (dialogs,
            // emoji, and other routes) deliberately stay out of this graph.
            children: `if(location.pathname === "/" || location.pathname.startsWith("/messages/")){for(const href of ${urls}){const link=document.createElement("link");link.rel="modulepreload";link.crossOrigin="";link.href=href;document.head.append(link)}}`,
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}
