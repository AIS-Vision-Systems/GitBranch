const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export function LaptopIcon() {
  return (
    <svg {...base} data-icon="laptop">
      <rect x="3" y="3.5" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" />
    </svg>
  );
}

export function CloudIcon({ title }: { title?: string }) {
  return (
    <svg {...base} data-icon="cloud">
      {title !== undefined && <title>{title}</title>}
      <path d="M4.5 12.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.9 6.3 3.1 3.1 0 0 1 11.5 12.5z" />
    </svg>
  );
}

export function PullRequestIcon() {
  return (
    <svg {...base} width={12} height={12} data-icon="pull-request">
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="12.5" r="1.6" />
      <path d="M4.5 5.1v5.8M11.5 10.9V6.5a2 2 0 0 0-2-2H8" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base} data-icon="check" strokeWidth={2}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function TagIcon() {
  return (
    <svg {...base} data-icon="tag">
      <path d="M2.5 2.5h5.6l5.4 5.4a1 1 0 0 1 0 1.4l-4.2 4.2a1 1 0 0 1-1.4 0L2.5 8.1z" />
      <circle cx="5.5" cy="5.5" r="1" />
    </svg>
  );
}
