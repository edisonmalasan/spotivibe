import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "pill" | "ghost";

/**
 * DESIGN.md "Pill Button (Filled White)": the one filled button style —
 * white pill, black 14px/700 label, 12px horizontal / 8px vertical padding.
 * Shared so link-styled actions can reuse the exact same contract.
 */
export const pillButtonClassName =
  "rounded-buttons bg-pure-white px-3 py-2 text-body-lg font-bold text-void-black transition hover:scale-105";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantClassName: Record<ButtonVariant, string> = {
  pill: pillButtonClassName,
  // DESIGN.md "Ghost Text Button": no background/border, mist text that hovers to pure white.
  ghost:
    "rounded-buttons px-4 py-2 text-body-lg font-bold text-mist transition hover:text-pure-white",
};

export function Button({
  variant = "pill",
  loading = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 disabled:pointer-events-none disabled:text-iron ${variantClassName[variant]} ${className}`}
      {...rest}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
