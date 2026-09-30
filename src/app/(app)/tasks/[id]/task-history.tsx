"use client";

type Entry = { id: string; from: string | null; to: string; actor: string; createdAt: string };

export function TaskHistory({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted">Nothing recorded.</p>;

  return (
    <ol className="grid gap-0.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-baseline gap-x-1.5 border-l-2 border-border py-1.5 pl-3 text-sm"
        >
          <span className="font-medium">{entry.actor}</span>
          <span className="text-muted">
            {entry.from ? `moved it from ${entry.from} to ${entry.to}` : `created it as ${entry.to}`}
          </span>
          <span className="ml-auto whitespace-nowrap text-xs text-subtle">{when(entry.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
