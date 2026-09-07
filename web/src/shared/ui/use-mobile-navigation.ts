import { useEffect, useRef, useState } from "react";

const focusable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

/** Keep an off-canvas navigation out of the tab order and contain focus while open. */
export function useMobileNavigation(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const navigation = ref.current;
    if (!mobile || !open || !navigation) return;
    const previousFocus = document.activeElement;
    const main = navigation.parentElement?.querySelector("main");
    const wasInert = main?.inert ?? false;
    if (main) main.inert = true;
    const controls = () =>
      [...navigation.querySelectorAll<HTMLElement>(focusable)].filter(
        (element) => element.getClientRects().length > 0,
      );
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    navigation.addEventListener("keydown", keydown);
    return () => {
      navigation.removeEventListener("keydown", keydown);
      if (main) main.inert = wasInert;
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !navigation.contains(previousFocus)
      ) {
        previousFocus.focus();
      } else {
        main?.querySelector<HTMLElement>(focusable)?.focus();
      }
    };
  }, [mobile, open]);
  return { ref, inert: mobile && !open };
}
