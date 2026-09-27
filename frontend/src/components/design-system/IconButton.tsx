import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name — icon-only controls must always expose one. */
  label: string;
  size?: "sm" | "md";
  /** Visual tone: default (white on dark), accent (green play), light (white pill). */
  tone?: "default" | "accent" | "light";
}

const sizeClassName = {
  // 32px diameter — DESIGN.md "Navigation Arrow Button".
  sm: "size-8",
  md: "size-10",
} as const;

const toneClassName = {
  default: "text-pure-white hover:bg-smoke",
  // DESIGN.md: #1ed760 exclusively for play buttons / active states.
  accent: "bg-spotify-green text-void-black hover:scale-105 disabled:bg-iron disabled:text-fog",
  light: "bg-pure-white text-void-black hover:scale-105 disabled:bg-iron disabled:text-fog",
} as const;

export function IconButton({
  label,
  size = "sm",
  tone = "default",
  className = "",
  children,
  type = "button",
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-buttons transition disabled:pointer-events-none disabled:text-iron ${sizeClassName[size]} ${toneClassName[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
