import { useDialogsStore } from "../../state/dialogs";
import { ConfirmDialog } from "./ConfirmDialog";
import { getDialogRenderer } from "./dialogRegistry";

export function DialogHost() {
  const current = useDialogsStore((s) => s.current);
  const busy = useDialogsStore((s) => s.busy);
  const close = useDialogsStore((s) => s.close);
  if (current === null) return null;
  if (current.kind === "confirm") {
    return (
      <ConfirmDialog
        title={current.title}
        message={current.message}
        {...(current.command !== undefined ? { command: current.command } : {})}
        confirmLabel={current.confirmLabel}
        danger={current.danger === true}
        busy={busy}
        onConfirm={() => {
          if (!busy) void current.onConfirm();
        }}
        onCancel={() => {
          if (!busy) close();
        }}
      />
    );
  }
  return <>{getDialogRenderer(current.id)?.(current.props, close) ?? null}</>;
}
