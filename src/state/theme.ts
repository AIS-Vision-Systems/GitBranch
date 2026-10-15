import { useUiStore } from "./ui";

/** Syncs `<html data-theme>` with the store and follows OS changes. Returns a cleanup function. */
export function applyTheme(): () => void {
  if (typeof document === "undefined") return () => undefined;

  const apply = (): void => {
    document.documentElement.dataset["theme"] = useUiStore.getState().resolvedTheme;
  };
  apply();
  const unsub = useUiStore.subscribe(apply);

  let mq: MediaQueryList | undefined;
  const onChange = (): void => useUiStore.getState().refreshTheme();
  if (typeof window.matchMedia === "function") {
    mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onChange);
  }
  return () => {
    unsub();
    mq?.removeEventListener("change", onChange);
  };
}
