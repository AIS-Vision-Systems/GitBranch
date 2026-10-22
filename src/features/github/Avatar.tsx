import { avatarColor, initials } from "../graph/avatar";
import styles from "./Avatar.module.css";
import { useAuthorAvatar } from "./useAuthorAvatar";

export function Avatar({ name, email, size }: { name: string; email: string; size: number }) {
  const url = useAuthorAvatar(email);
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
