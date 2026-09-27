import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";

type SearchInputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * DESIGN.md "Search Input": 36px pill (500px radius), graphite fill with the
 * input-field inset shadow, white monoline icon left, white placeholder text,
 * 12px horizontal padding. The inner <input> carries the accessible name.
 */
export function SearchInput({
  placeholder = "What do you want to play?",
  className = "",
  type = "search",
  ...rest
}: SearchInputProps) {
  return (
    <div
      className={`flex h-9 items-center gap-2 rounded-inputs bg-graphite px-3 shadow-subtle ${className}`}
    >
      <Search className="size-4 shrink-0 text-pure-white" aria-hidden="true" />
      <input
        type={type}
        aria-label="Search"
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-body-lg font-regular text-pure-white placeholder:text-pure-white"
        {...rest}
      />
    </div>
  );
}
