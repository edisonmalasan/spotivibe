import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name — icon-only controls must always expose one. */
  label: string;
  size?: "sm" | "md";
}

const sizeClassName = {
  // 32px diameter — DESIGN.md "Navigation Arrow Button".
  sm: "size-8",
  md: "size-10",
} as const;

export function IconButton({
  label,
  size = "sm",
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
      className={`inline-flex items-center justify-center rounded-buttons text-pure-white transition hover:bg-smoke disabled:pointer-events-none disabled:text-iron ${sizeClassName[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
