import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { IconButton } from "./IconButton";

interface NavArrowButtonProps {
  direction: "back" | "forward";
  disabled?: boolean;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
}

/**
 * DESIGN.md "Navigation Arrow Button": 32px circular hit area on the void-black
 * top bar, white chevron icon.
 */
export function NavArrowButton({ direction, disabled, onClick }: NavArrowButtonProps) {
  const isBack = direction === "back";
  const Icon = isBack ? ChevronLeft : ChevronRight;
  return (
    <IconButton
      label={isBack ? "Go back" : "Go forward"}
      disabled={disabled}
      onClick={onClick}
      className="bg-void-black"
    >
      <Icon className="size-5" aria-hidden="true" />
    </IconButton>
  );
}
