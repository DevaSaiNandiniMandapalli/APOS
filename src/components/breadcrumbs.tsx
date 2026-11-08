import { ChevronRight } from "lucide-react";

export type Crumb = { name: string; path: string };

export default function Breadcrumbs({ items, current }: { items: readonly Crumb[]; current: string }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <div className="crumbs-track">
        <span>Home</span>
        {items.map((item) => (
          <span key={item.path}>
            <ChevronRight size={13} aria-hidden="true" />
            {item.name}
          </span>
        ))}
        <span aria-current="page">
          <ChevronRight size={13} aria-hidden="true" />
          <strong>{current}</strong>
        </span>
      </div>
    </nav>
  );
}
