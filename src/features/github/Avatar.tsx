import type { RepoId } from "../../ipc/types";
import { avatarColor, initials } from "../graph/avatar";
import styles from "./Avatar.module.css";
import { useAuthorAvatar } from "./useAuthorAvatar";

export function Avatar({
  name,
  email,
  size,
  repoId,
}: {
  name: string;
  email: string;
  size: number;
  repoId?: RepoId;
}) {
  const url = useAuthorAvatar(email, repoId);
  const title = `${name} <${email}>`;
  if (url !== null) {
    return (
      <img
        className={styles.avatar}
        src={url}
        alt={name}
        title={title}
        draggable={false}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`${styles.avatar} ${styles.badge} ${styles[`c${avatarColor(email)}`]}`}
      title={title}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}
