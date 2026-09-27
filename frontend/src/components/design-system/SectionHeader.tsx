import Link from "next/link";

interface SectionHeaderProps {
  title: string;
  action?: { label: string; href: string };
  className?: string;
}

/**
 * DESIGN.md "Section Header": title 24px/700 white on the left,
 * optional #b3b3b3 12px link on the right, 24px row gap to content below.
 */
export function SectionHeader({ title, action, className = "" }: SectionHeaderProps) {
  return (
    <div className={`mb-6 flex items-baseline justify-between gap-4 ${className}`}>
      <h2 className="text-heading font-bold text-pure-white">{title}</h2>
      {action && (
        <Link
          href={action.href}
          className="text-label font-bold text-mist transition hover:text-pure-white"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
