import { call } from "./core";

export { onOpProgress } from "./events";
export type { OpProgress } from "./events";

/** Resolves false when the id is unknown (not registered yet). The original fetch/pull/push call then rejects with `git.cancelled`. */
export function cancelOp(opId: string): Promise<boolean> {
  return call<boolean>("cancel_op", { opId });
}
