import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebarWidth,
  sidebarWidthLimit,
} from "./workspace-sidebar-width-policy.mjs";

/** Desktop width is device-local; channel sections and access stay relay-backed. */
export function useWorkspaceSidebarResize(pubkey: string) {
  const storageKey = `buzz-web:sidebar-width:v1:${pubkey}`;
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [saved, setSaved] = useState(() => {
    try {
      return {
        key: storageKey,
        width: readSidebarWidth(
          window.localStorage.getItem(storageKey),
          window.innerWidth,
        ),
      };
    } catch {
      return { key: storageKey, width: DEFAULT_SIDEBAR_WIDTH };
    }
  });
  const drag = useRef<{
    pointer: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const width = clampSidebarWidth(
    saved.key === storageKey ? saved.width : DEFAULT_SIDEBAR_WIDTH,
    viewportWidth,
  );
  const update = (next: number) =>
    setSaved({
      key: storageKey,
      width: clampSidebarWidth(next, window.innerWidth),
    });
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      setSaved({
        key: storageKey,
        width: readSidebarWidth(
          window.localStorage.getItem(storageKey),
          window.innerWidth,
        ),
      });
    } catch {
      setSaved({ key: storageKey, width: DEFAULT_SIDEBAR_WIDTH });
    }
  }, [storageKey]);
  useEffect(() => {
    if (saved.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(saved.width));
    } catch {
      /* Resizing also works when browser storage is unavailable. */
    }
  }, [saved, storageKey]);
  return {
    style: { "--workspace-sidebar-width": `${width}px` } as CSSProperties,
    separator: {
      role: "separator" as const,
      "aria-label": "Resize workspace sidebar",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": MIN_SIDEBAR_WIDTH,
      "aria-valuemax": sidebarWidthLimit(viewportWidth),
      "aria-valuenow": width,
      tabIndex: 0,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          startX: event.clientX,
          startWidth: width,
        };
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (current?.pointer === event.pointerId)
          update(current.startWidth + event.clientX - current.startX);
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      },
      onPointerCancel: () => {
        drag.current = null;
      },
      onLostPointerCapture: () => {
        drag.current = null;
      },
      onDoubleClick: () => update(DEFAULT_SIDEBAR_WIDTH),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const next = {
          ArrowLeft: width - 24,
          ArrowRight: width + 24,
          Home: MIN_SIDEBAR_WIDTH,
          End: sidebarWidthLimit(viewportWidth),
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        update(next);
      },
    },
  };
}
