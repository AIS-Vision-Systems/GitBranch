import { useId, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useDialogsStore } from "../../state/dialogs";
import { useOpsStore } from "../../state/ops";
import { Dialog } from "../shell/Dialog";
import styles from "./Form.module.css";

interface Props {
  title: string;
  submitLabel: string;
  /** False disables the submit button and Enter. */
  valid: boolean;
  /** Resolve true to close the dialog. */
  onSubmit: () => Promise<boolean>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/** Shared shell: Enter submits, submit disabled while invalid or an operation is running. */
export function FormDialog({
  title,
  submitLabel,
  valid,
  onSubmit,
  onClose,
  initialFocusRef,
  children,
}: Props) {
  const formId = useId();
  const busy = useOpsStore((s) => s.busy);
  const disabled = !valid || busy;

  const guardedClose = (): void => {
    if (!busy) onClose();
  };

  const run = (): void => {
    if (disabled) return;
    const spec = useDialogsStore.getState().current;
    void onSubmit().then((ok) => {
      // Close only if this dialog is still the open one (it may have been dismissed mid-operation).
      if (ok && useDialogsStore.getState().current === spec) onClose();
    });
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    run();
  };
  // Enter in a text/select field submits (explicit, so it does not depend on the button being in the form).
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>): void => {
    if (e.key !== "Enter" || e.target instanceof HTMLTextAreaElement) return;
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    run();
  };

  return (
    <Dialog
      title={title}
      onClose={guardedClose}
      width="sm"
      {...(initialFocusRef !== undefined ? { initialFocusRef } : {})}
      footer={
        <>
          <button type="button" className={styles["cancel"]} onClick={guardedClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className={styles["submit"]} disabled={disabled}>
            {submitLabel}
          </button>
        </>
      }
    >
      <form id={formId} className={styles["form"]} onSubmit={submit} onKeyDown={onKeyDown}>
        {children}
      </form>
    </Dialog>
  );
}
