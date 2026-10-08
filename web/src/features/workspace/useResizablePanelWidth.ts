import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export type PanelWidthPolicy = {
  defaultWidth: number;
  minWidth: number;
  limit: (viewportWidth: number) => number;
  clamp: (width: number, viewportWidth: number) => number;
  read: (value: string | null, viewportWidth: number) => number;
};

/**
 * Device-local width for a side panel with a drag handle. `edge` names the
 * side the handle sits on: a left-docked panel resizes from its right edge,
 * a right-docked panel from its left edge.
 */
export function useResizablePanelWidth({
  storageKey,
  policy,
  cssVariable,
  label,
  edge,
}: {
  storageKey: string;
  policy: PanelWidthPolicy;
  cssVariable: string;
  label: string;
  edge: "left" | "right";
}) {
  const direction = edge === "right" ? 1 : -1;
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [saved, setSaved] = useState(() => {
    try {
      return {
        key: storageKey,
        width: policy.read(
          window.localStorage.getItem(storageKey),
          window.innerWidth,
        ),
      };
    } catch {
      return { key: storageKey, width: policy.defaultWidth };
    }
  });
  const drag = useRef<{
    pointer: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const width = policy.clamp(
    saved.key === storageKey ? saved.width : policy.defaultWidth,
    viewportWidth,
  );
  const update = (next: number) =>
    setSaved({
      key: storageKey,
      width: policy.clamp(next, window.innerWidth),
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
        width: policy.read(
          window.localStorage.getItem(storageKey),
          window.innerWidth,
        ),
      });
    } catch {
      setSaved({ key: storageKey, width: policy.defaultWidth });
    }
  }, [storageKey, policy]);
  useEffect(() => {
    if (saved.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(saved.width));
    } catch {
      /* Resizing also works when browser storage is unavailable. */
    }
  }, [saved, storageKey]);
  return {
    width,
    style: { [cssVariable]: `${width}px` } as CSSProperties,
    separator: {
      role: "separator" as const,
      "aria-label": label,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": policy.minWidth,
      "aria-valuemax": policy.limit(viewportWidth),
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
          update(
            current.startWidth + direction * (event.clientX - current.startX),
          );
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
      onDoubleClick: () => update(policy.defaultWidth),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const next = {
          ArrowLeft: width - direction * 24,
          ArrowRight: width + direction * 24,
          Home: policy.minWidth,
          End: policy.limit(viewportWidth),
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        update(next);
      },
    },
  };
}
