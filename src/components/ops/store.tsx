"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Collections, Patch, Result, Workspace } from "@/lib/types";
import { buildModel, type Model } from "./model";

/**
 * The workspace as the browser holds it, plus the interface state that floats
 * above every screen: the drawer, the form modal, the quick-add dialog, the
 * toast.
 *
 * The server sends the workspace once per page load. After that every change
 * goes through a server action, which answers with the records it touched;
 * `apply` puts them in place. No screen refetches the workspace to show its
 * own edit.
 */

export type Drawer =
  | { type: "task"; id: string; back?: Drawer | null }
  | { type: "person"; id: string }
  | { type: "client"; id: string }
  | { type: "day"; day: string };

export type ModalType =
  | "entry"
  | "editEntry"
  | "confirmDelete"
  | "task"
  | "client"
  | "editClient"
  | "removeClient"
  | "member"
  | "editMember"
  | "leave"
  | "draw"
  | "deleteDraw"
  | "salary"
  | "password"
  | "removeMember";

export type Form = Record<string, string>;
export type Modal = { type: ModalType; form: Form; errors: Record<string, string>; busy: boolean };

export type QuickKind = "client" | "member" | "brand" | "dept" | "tdept" | "area" | "cat";
export type Quick = {
  kind: QuickKind;
  /** Where the new value goes: a modal field, a task drawer field, or nowhere. */
  target: "form" | "draft" | "none";
  field: string;
  form: Form;
  error: string;
  busy: boolean;
};

export type Notice = { title: string; text: string; link: string };

export type TaskDraft = {
  status: string;
  who: string;
  by: string;
  hours: string;
  due: string;
  pri: string;
  est: string;
  brand: string;
  client: string;
  dept: string;
};

type Ctx = {
  w: Workspace;
  m: Model;
  apply: (patch?: Patch) => void;
  run: <T>(p: Promise<Result<T>>, opts?: { quiet?: boolean }) => Promise<Result<T>>;
  toast: (msg: string) => void;
  toastText: string | null;
  drawer: Drawer | null;
  setDrawer: (d: Drawer | null) => void;
  draft: TaskDraft;
  setDraft: React.Dispatch<React.SetStateAction<TaskDraft>>;
  modal: Modal | null;
  setModal: React.Dispatch<React.SetStateAction<Modal | null>>;
  quick: Quick | null;
  setQuick: React.Dispatch<React.SetStateAction<Quick | null>>;
  notice: Notice | null;
  setNotice: (n: Notice | null) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
};

const OpsContext = createContext<Ctx | null>(null);

export function useOps(): Ctx {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error("useOps outside OpsProvider");
  return ctx;
}

const EMPTY_DRAFT: TaskDraft = { status: "todo", who: "", by: "", hours: "0", due: "", pri: "medium", est: "", brand: "", client: "", dept: "" };

function merge<T extends { id: string }>(list: T[], upsert?: T[], remove?: string[], prepend = false): T[] {
  if (!upsert?.length && !remove?.length) return list;
  const gone = new Set(remove ?? []);
  const incoming = new Map((upsert ?? []).map((x) => [x.id, x]));
  const out = list.filter((x) => !gone.has(x.id)).map((x) => incoming.get(x.id) ?? x);
  const fresh = (upsert ?? []).filter((x) => !list.some((y) => y.id === x.id) && !gone.has(x.id));
  return prepend ? [...fresh, ...out] : [...out, ...fresh];
}

export function OpsProvider({ initial, children }: { initial: Workspace; children: React.ReactNode }) {
  const [w, setW] = useState(initial);
  // A new page load (or router.refresh after an import or a preview switch)
  // brings a whole new workspace from the server; it replaces what we had.
  const seen = useRef(initial);
  useEffect(() => {
    if (seen.current !== initial) {
      seen.current = initial;
      setW(initial);
    }
  }, [initial]);

  const [toastText, setToastText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setToastText(msg);
    timer.current = setTimeout(() => setToastText(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = useCallback((patch?: Patch) => {
    if (!patch) return;
    setW((cur) => {
      const next = { ...cur };
      const keys = new Set([...Object.keys(patch.upsert ?? {}), ...Object.keys(patch.remove ?? {})]) as Set<keyof Collections>;
      for (const k of keys) {
        const up = patch.upsert?.[k] as { id: string }[] | undefined;
        const rm = patch.remove?.[k];
        (next as Record<string, unknown>)[k] = merge(cur[k] as { id: string }[], up, rm, k === "audit" || k === "ledger");
      }
      if (patch.upsert?.audit?.length) next.audit = [...next.audit].sort((a, b) => b.at.localeCompare(a.at));
      if (patch.tenant) next.tenant = { ...cur.tenant, ...patch.tenant };
      return next;
    });
  }, []);

  const run = useCallback(
    async <T,>(p: Promise<Result<T>>, opts: { quiet?: boolean } = {}) => {
      let r: Result<T>;
      try {
        r = await p;
      } catch {
        r = { ok: false, error: "Could not reach the server. Check your connection and try again." };
      }
      if (r.ok) {
        apply(r.patch);
        if (r.message && !opts.quiet) toast(r.message);
      } else if (!opts.quiet) {
        toast(r.error);
      }
      return r;
    },
    [apply, toast],
  );

  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [modal, setModal] = useState<Modal | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape closes the top-most thing: quick-add first, then everything else.
  const quickOpen = useRef(false);
  useEffect(() => {
    quickOpen.current = !!quick;
  }, [quick]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (quickOpen.current) return setQuick(null);
      setDrawer(null);
      setModal(null);
      setNotice(null);
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const m = useMemo(() => buildModel(w), [w]);

  const value: Ctx = {
    w,
    m,
    apply,
    run,
    toast,
    toastText,
    drawer,
    setDrawer,
    draft,
    setDraft,
    modal,
    setModal,
    quick,
    setQuick,
    notice,
    setNotice,
    menuOpen,
    setMenuOpen,
  };
  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

/** Whether the window is at least as wide as the desktop layout needs. */
export function useWide(min = 860): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = window.matchMedia(`(min-width: ${min}px)`);
    const on = () => setWide(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [min]);
  return wide;
}
