import type { InProgress } from "../../ipc/merge";
import { opTitle, shortOid } from "../../state/ops";

function branchName(ref: string | null): string | null {
  return ref === null ? null : ref.replace(/^refs\/heads\//, "");
}

export function opBannerText(p: InProgress): string {
  if (p.kind !== "rebase") return `${opTitle(p.kind)} in progress`;
  const counter = p.total > 0 ? ` (${p.done}/${p.total})` : "";
  const head = branchName(p.headName);
  const detail =
    head !== null && p.onto !== null ? ` — rebasing ${head} onto ${shortOid(p.onto)}` : "";
  return `Rebase in progress${counter}${detail}`;
}
