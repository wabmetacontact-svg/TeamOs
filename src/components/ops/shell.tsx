"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FEATURES, featureName, type Feature } from "@/lib/access";
import { setPreview } from "@/app/(app)/actions/access";
import { logout } from "@/app/(auth)/actions";
import { Icon, IconSprite, type IconName } from "./icons";
import { useOps, useWide } from "./store";
import { openModal } from "./modals";
import { Overlays } from "./overlays";

const NAV_ICON: Partial<Record<Feature, IconName>> = {
  dashboard: "grid",
  tasks: "check",
  team: "users",
  expenses: "doc",
  clients: "database",
  access: "key",
  audit: "shield",
  import: "network",
};

const TITLES: Record<string, [sub: string, title: string]> = {
  dashboard: ["Overview", "Dashboard"],
  clients: ["Directory", "Clients"],
  team: ["People operations", "Team"],
  expenses: ["Finance", "Income and expenses"],
  tasks: ["Work", "Tasks"],
  access: ["Security", "Access"],
  audit: ["Security", "Audit trail"],
  import: ["Data", "Import"],
};

/** The section a path belongs to, and the client id on a client page. */
function routeOf(pathname: string): { view: string; clientId: string | null } {
  const [, first = "dashboard", second] = pathname.split("/");
  if (first === "clients" && second) return { view: "client", clientId: decodeURIComponent(second) };
  return { view: TITLES[first] ? first : "dashboard", clientId: null };
}

export function Shell({ children }: { children: React.ReactNode }) {
  const ops = useOps();
  const { w, m, menuOpen, setMenuOpen } = ops;
  const pathname = usePathname();
  const router = useRouter();
  const wide = useWide();
  const { view, clientId } = routeOf(pathname);

  // A route change closes the mobile menu and anything floating.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, setMenuOpen]);

  const feature: Feature = view === "client" ? "clients" : (view as Feature);
  const level = m.fa(feature);
  const client = clientId ? m.C(clientId) : null;
  const isClient = view === "client" && !!client && m.visIds.has(client.id);

  const [sub, title] = isClient ? [m.brandName(client!.brandId), client!.name] : (TITLES[view === "client" ? "clients" : view] ?? TITLES.dashboard!);

  const counts: Partial<Record<Feature, number>> = {
    clients: m.vis.length,
    team: m.team.length,
    tasks: w.tasks.filter((t) => t.status !== "done").length,
    audit: w.audit.length,
  };
  const nav = FEATURES.filter(([id]) => NAV_ICON[id] && m.fa(id) !== "none");
  const current = view === "client" ? "clients" : view;

  const [previewBusy, startPreview] = useTransition();
  const preview = (id: string | null) =>
    startPreview(async () => {
      const r = await ops.run(setPreview(id), { quiet: true });
      if (r.ok) {
        ops.setDrawer(null);
        router.refresh();
      } else ops.toast(r.error);
    });

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white">
      <IconSprite />
      {!wide && menuOpen && <div onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[29] bg-[rgba(15,23,42,.45)]" />}

      <aside
        className="z-30 flex w-60 shrink-0 flex-col border-r border-line bg-ink2 text-white transition-transform duration-200"
        style={{
          position: wide ? "relative" : "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          transform: !wide && !menuOpen ? "translateX(-100%)" : "none",
          ["--icon-stroke" as string]: "#fff",
        }}
      >
        <div className="flex items-center gap-2.5 px-5 pb-[18px] pt-[22px]">
          <span className="fw-s flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent text-[15px] text-white">O</span>
          <div className="flex flex-col leading-[1.2]">
            <span className="fw-s text-[15px]">Operations</span>
            <span className="text-[11px] opacity-70">Workspace</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-auto px-3 py-2">
          {nav.map(([id, label]) => (
            <Link
              key={id}
              href={`/${id}`}
              prefetch
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-white no-underline transition-colors hover:bg-[rgba(255,255,255,.08)] hover:text-white hover:no-underline"
              style={{
                background: current === id ? "rgba(255,255,255,.12)" : "transparent",
                fontWeight: current === id ? "var(--fw-strong)" : "var(--fw-body)",
              }}
            >
              <Icon name={NAV_ICON[id]!} />
              <span className="flex-1">{label}</span>
              <span className="text-[11px] opacity-70">{counts[id] ?? ""}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-[rgba(255,255,255,.18)] p-4">
          {m.me.isOwner ? (
            <>
              <label className="text-[11px] uppercase tracking-[.08em] opacity-70" htmlFor="viewing-as">
                Viewing as
              </label>
              <select
                id="viewing-as"
                value={w.viewerId}
                disabled={previewBusy}
                onChange={(e) => preview(e.target.value === w.meId ? null : e.target.value)}
                className="w-full rounded-lg border border-[rgba(255,255,255,.18)] bg-[rgba(255,255,255,.06)] px-2.5 py-[9px] text-[13px] text-white"
              >
                {m.active.map((p) => (
                  <option key={p.id} value={p.id} style={{ color: "#0F172A" }}>
                    {p.name} · {p.title}
                  </option>
                ))}
              </select>
              <span className="text-[11px] leading-normal opacity-70">Access is enforced per person, per client.</span>
            </>
          ) : (
            <>
              <span className="text-[11px] uppercase tracking-[.08em] opacity-70">Signed in as</span>
              <span className="text-[13px]">
                {m.me.name} · {m.me.title}
              </span>
            </>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="fw-s h-9 w-full rounded-lg border border-[rgba(255,255,255,.18)] bg-transparent text-xs text-white hover:bg-[rgba(255,255,255,.08)]"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-canvas" id="main">
        <Header view={view} isClient={isClient} clientId={isClient ? clientId : null} sub={sub} title={title} wide={wide} />

        {m.previewing && (
          <div
            className="mx-4 mt-4 flex flex-wrap items-center gap-2.5 rounded-lg bg-ink2 px-4 py-3 text-[13px] text-white wide:mx-8"
            style={{ ["--icon-stroke" as string]: "#fff" }}
          >
            <Icon name="lock" size={18} />
            <span className="min-w-[200px] flex-1">
              Viewing as {m.viewer.name}. {m.vis.length} of {w.clients.length} clients visible, finance on {m.fin.length}. Changes are
              off while you preview.
            </span>
            <button
              type="button"
              disabled={previewBusy}
              onClick={() => preview(null)}
              className="fw-s rounded-full border border-[rgba(255,255,255,.5)] bg-transparent px-3.5 py-1.5 text-xs text-white"
            >
              Back to your view
            </button>
          </div>
        )}

        <div key={pathname} className="animate-rise-slow px-4 pb-16 pt-6 wide:px-8">
          {level === "none" ? (
            <div
              className="flex items-center gap-3.5 rounded-xl border border-dashed border-edge3 bg-white p-7 text-sm"
              style={{ ["--icon-stroke" as string]: "#5B5BD6" }}
            >
              <Icon name="lock" size={24} />
              <span>You don&apos;t have access to {featureName(feature)}. Ask the founder to grant it on the Access screen.</span>
            </div>
          ) : (
            <>
              {level === "view" && (
                <div className="mb-3.5 flex items-center gap-2.5 rounded-lg bg-info-s px-3.5 py-2.5 text-xs text-info-d">
                  View only. You can see {featureName(feature)} but can&apos;t add or change anything here.
                </div>
              )}
              {children}
            </>
          )}
        </div>
      </main>

      <Overlays />
    </div>
  );
}

function Header({
  view,
  isClient,
  clientId,
  sub,
  title,
  wide,
}: {
  view: string;
  isClient: boolean;
  clientId: string | null;
  sub: string;
  title: string;
  wide: boolean;
}) {
  const ops = useOps();
  const { m } = ops;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const ql = q.trim().toLowerCase();
  const results = useMemo(
    () =>
      ql
        ? [
            ...m.vis
              .filter((c) => c.name.toLowerCase().includes(ql))
              .map((c) => ({ id: `c${c.id}`, name: c.name, kind: `Client · ${m.brandName(c.brandId)}`, go: () => router.push(`/clients/${c.id}`) })),
            ...m.team
              .filter((p) => p.name.toLowerCase().includes(ql))
              .map((p) => ({ id: `p${p.id}`, name: p.name, kind: `Team · ${p.title}`, go: () => ops.setDrawer({ type: "person", id: p.id }) })),
          ].slice(0, 7)
        : [],
    [ql, m, router, ops],
  );

  const clientCtx = clientId ?? undefined;
  const addItems: { label: string; hint: string; feature: Feature | null; go: () => void }[] = [
    { label: "Task", hint: "Assign work against a client", feature: "tasks", go: () => openModal(ops, "task", { client: clientCtx }) },
    { label: "Expense", hint: "Money out, for a client or overhead", feature: "expenses", go: () => openModal(ops, "entry", { type: "out", client: clientCtx }) },
    { label: "Income", hint: "Retainers and fees in INR, USD, USDT or USDC", feature: "expenses", go: () => openModal(ops, "entry", { type: "in", client: clientCtx }) },
    { label: "Client", hint: "New client record under a brand", feature: "clients", go: () => openModal(ops, "client") },
    { label: "Team member", hint: "Hire, contract or intern", feature: "team", go: () => openModal(ops, "member") },
    { label: "Leave request", hint: "For you or a team member", feature: null, go: () => openModal(ops, "leave") },
    { label: "Import data", hint: "From your Google Sheets", feature: "import", go: () => router.push("/import") },
  ];
  const items = addItems.filter((a) => !m.previewing && (a.feature === null || m.edits(a.feature)));

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-[rgba(255,255,255,.97)] px-4 py-3.5 wide:px-8">
      {!wide && (
        <button
          type="button"
          onClick={() => ops.setMenuOpen(true)}
          aria-label="Open menu"
          className="flex size-11 items-center justify-center rounded-lg border border-line2 bg-white"
        >
          <Icon name="grid" />
        </button>
      )}
      {isClient && (
        <Link
          href="/clients"
          title="Back to clients"
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line2 bg-white text-lg leading-none text-ink no-underline hover:bg-tint2 hover:no-underline"
        >
          ←
        </Link>
      )}
      <div className="min-w-0 flex-[1_1_140px]">
        <div className="flex items-center gap-1.5 text-xs text-mute">
          {isClient && (
            <>
              <Link href="/clients">Clients</Link>
              <span>/</span>
            </>
          )}
          <span>{sub}</span>
        </div>
        <h1 className="fw-s ellipsis m-0 mt-0.5 text-[21px] tracking-[-.01em]">{title}</h1>
      </div>

      <div className="relative max-w-[320px] flex-[1_1_200px]">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          placeholder="Search clients and team"
          className="h-10 w-full rounded-full border border-line2 bg-white pl-[38px] pr-3.5 text-[13px]"
        />
        <Icon name="search" size={18} style={{ position: "absolute", left: 13, top: 11, pointerEvents: "none" }} />
        {searchOpen && !!ql && view !== "clients" && (
          <div className="absolute left-0 right-0 top-[46px] z-20 animate-rise rounded-lg border border-[rgba(100,116,139,.25)] bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,.12)]">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  r.go();
                  setQ("");
                  setSearchOpen(false);
                }}
                className="flex w-full justify-between gap-2 rounded-md border-0 bg-transparent p-2.5 text-left text-[13px] hover:bg-[rgba(91,91,214,.08)]"
              >
                <span className="fw-s">{r.name}</span>
                <span className="text-xs text-mute">{r.kind}</span>
              </button>
            ))}
            {!results.length && <div className="p-2.5 text-[13px] text-mute">No matches you have access to.</div>}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="fw-s h-10 whitespace-nowrap rounded-full border-0 bg-accent px-[18px] text-[13px] text-white hover:bg-accent-h active:bg-accent-d"
          >
            + Add
          </button>
          {addOpen && (
            <>
              <div onClick={() => setAddOpen(false)} className="fixed inset-0 z-[19]" />
              <div className="absolute right-0 top-12 z-20 w-[230px] animate-rise rounded-lg border border-[rgba(100,116,139,.25)] bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,.14)]">
                {items.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      a.go();
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md border-0 bg-transparent px-2.5 py-[9px] text-left hover:bg-[rgba(91,91,214,.08)]"
                  >
                    <span className="fw-s text-[13px]">{a.label}</span>
                    <span className="text-[11px] text-mute">{a.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}
