import { createElement } from "react";
import { registerDialog } from "../shell/dialogRegistry";
import { BranchDropDialog, type BranchDropDialogProps } from "./BranchDropDialog";
import { AddWorktreeDialog, type AddWorktreeDialogProps } from "./AddWorktreeDialog";
import { LockWorktreeDialog, type LockWorktreeDialogProps } from "./LockWorktreeDialog";
import { CloneDialog, type CloneDialogProps } from "./CloneDialog";
import { CreateBranchDialog, type CreateBranchDialogProps } from "./CreateBranchDialog";
import { CreateTagDialog, type CreateTagDialogProps } from "./CreateTagDialog";
import { LoginDialog, type LoginDialogProps } from "../github/LoginDialog";
import { RepoPickerDialog, type RepoPickerDialogProps } from "../github/RepoPickerDialog";
import { CreatePullDialog, type CreatePullDialogProps } from "../github/CreatePullDialog";
import { AboutDialog } from "./AboutDialog";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";
import { SshFixDialog, type SshFixDialogProps } from "./SshFixDialog";
import { DIALOG } from "./ids";
import { MergeDialog, type MergeDialogProps } from "./MergeDialog";
import { PullDialog, type PullDialogProps } from "./PullDialog";
import { PushDialog, type PushDialogProps } from "./PushDialog";
import { RebaseDialog, type RebaseDialogProps } from "./RebaseDialog";
import { EditRemoteDialog, type EditRemoteDialogProps } from "./EditRemoteDialog";
import { RemotesDialog, type RemotesDialogProps } from "./RemotesDialog";
import { RenameBranchDialog, type RenameBranchDialogProps } from "./RenameBranchDialog";
import { ResetDialog, type ResetDialogProps } from "./ResetDialog";
import { SetUpstreamDialog, type SetUpstreamDialogProps } from "./SetUpstreamDialog";
import { StashPushDialog, type StashPushDialogProps } from "./StashPushDialog";

type Props<P> = Omit<P, "onClose">;

let registered = false;

/** Register the Phase 2 dialogs once. Props arrive untyped from the dialog store; callers use `open.ts`. */
export function registerPhase2Dialogs(): void {
  if (registered) return;
  registered = true;
  registerDialog(DIALOG.createBranch, (p, onClose) =>
    createElement(CreateBranchDialog, {
      ...(p as unknown as Props<CreateBranchDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.renameBranch, (p, onClose) =>
    createElement(RenameBranchDialog, {
      ...(p as unknown as Props<RenameBranchDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.setUpstream, (p, onClose) =>
    createElement(SetUpstreamDialog, {
      ...(p as unknown as Props<SetUpstreamDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.stashPush, (p, onClose) =>
    createElement(StashPushDialog, { ...(p as unknown as Props<StashPushDialogProps>), onClose }),
  );
  registerDialog(DIALOG.createTag, (p, onClose) =>
    createElement(CreateTagDialog, { ...(p as unknown as Props<CreateTagDialogProps>), onClose }),
  );
  registerDialog(DIALOG.reset, (p, onClose) =>
    createElement(ResetDialog, { ...(p as unknown as Props<ResetDialogProps>), onClose }),
  );
  registerDialog(DIALOG.merge, (p, onClose) =>
    createElement(MergeDialog, { ...(p as unknown as Props<MergeDialogProps>), onClose }),
  );
  registerDialog(DIALOG.rebase, (p, onClose) =>
    createElement(RebaseDialog, { ...(p as unknown as Props<RebaseDialogProps>), onClose }),
  );
  registerDialog(DIALOG.branchDrop, (p, onClose) =>
    createElement(BranchDropDialog, {
      ...(p as unknown as Props<BranchDropDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.about, (_p, onClose) => createElement(AboutDialog, { onClose }));
  registerDialog(DIALOG.settings, (p, onClose) =>
    createElement(SettingsDialog, { ...(p as unknown as Props<SettingsDialogProps>), onClose }),
  );
  registerDialog(DIALOG.pull, (p, onClose) =>
    createElement(PullDialog, { ...(p as unknown as Props<PullDialogProps>), onClose }),
  );
  registerDialog(DIALOG.push, (p, onClose) =>
    createElement(PushDialog, { ...(p as unknown as Props<PushDialogProps>), onClose }),
  );
  registerDialog(DIALOG.clone, (p, onClose) =>
    createElement(CloneDialog, { ...(p as unknown as Props<CloneDialogProps>), onClose }),
  );
  registerDialog(DIALOG.remotes, (p, onClose) =>
    createElement(RemotesDialog, { ...(p as unknown as Props<RemotesDialogProps>), onClose }),
  );
  registerDialog(DIALOG.sshFix, (p, onClose) =>
    createElement(SshFixDialog, { ...(p as unknown as Props<SshFixDialogProps>), onClose }),
  );
  registerDialog(DIALOG.editRemote, (p, onClose) =>
    createElement(EditRemoteDialog, {
      ...(p as unknown as Props<EditRemoteDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.addWorktree, (p, onClose) =>
    createElement(AddWorktreeDialog, {
      ...(p as unknown as Props<AddWorktreeDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.lockWorktree, (p, onClose) =>
    createElement(LockWorktreeDialog, {
      ...(p as unknown as Props<LockWorktreeDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.githubLogin, (p, onClose) =>
    createElement(LoginDialog, { ...(p as unknown as Props<LoginDialogProps>), onClose }),
  );
  registerDialog(DIALOG.githubRepoPicker, (p, onClose) =>
    createElement(RepoPickerDialog, {
      ...(p as unknown as Props<RepoPickerDialogProps>),
      onClose,
    }),
  );
  registerDialog(DIALOG.githubCreatePull, (p, onClose) =>
    createElement(CreatePullDialog, {
      ...(p as unknown as Props<CreatePullDialogProps>),
      onClose,
    }),
  );
}
