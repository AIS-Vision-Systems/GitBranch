/**
 * Row height in px. MUST stay in sync with `--graph-row-h` in src/styles/tokens.css
 * (the virtualizer needs a number; the CSS uses the token).
 */
export const ROW_H = 36;
/** Lane column width in px. Keep in sync with `--graph-lane-w`. */
export const LANE_W = 22;
/** Height of the sticky column header in px. Keep in sync with `--graph-header-h`. */
export const HEADER_H = 28;
/** Size of the lane color palette (`--graph-lane-0..11`). */
export const PALETTE = 12;
/** Size of the avatar color palette (`--avatar-0..11`). */
export const AVATAR_PALETTE = 12;
/** Radius of a merge commit's filled node. */
export const NODE_R = 5;
/** Outer radius of an avatar node (fill plus the 2 px lane ring). */
export const AVATAR_R = 11;
/** Radius of the bend in lane curves. */
export const CURVE_R = LANE_W / 2;
/** Chips shown before the `+N` pill. */
export const MAX_CHIPS = 2;
