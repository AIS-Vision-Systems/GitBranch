import type { ReactNode } from "react";

export type DialogRenderer = (props: Record<string, unknown>, close: () => void) => ReactNode;

const registry = new Map<string, DialogRenderer>();

export function registerDialog(id: string, render: DialogRenderer): void {
  registry.set(id, render);
}

export function getDialogRenderer(id: string): DialogRenderer | undefined {
  return registry.get(id);
}
