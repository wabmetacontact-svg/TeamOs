"use client";

import { useEffect, useState } from "react";
import { clearClientPassword, revealClientPassword, saveClientAccount, setClientPassword } from "@/app/(app)/actions/clients";
import type { ClientW } from "@/lib/types";
import { useOps } from "../store";
import { OutlineButton, PrimaryButton, Section } from "../ui";

const input = "h-9 w-full rounded-lg border border-edge2 bg-white px-3 text-[13px] focus:border-accent focus:outline-none";

/** How long a revealed password stays on screen before it hides itself. */
const SHOW_FOR_MS = 30_000;

/**
 * The client's account: how they sign in, what plan they are on, notes, and -
 * for an owner - the password, if one was kept.
 *
 * Fields that come from WabMeta are shown, not edited: the next sync would put
 * them back, and an edit that silently undoes itself is worse than no edit.
 */
export function ClientAccount({ c }: { c: ClientW }) {
  const ops = useOps();
  const { m } = ops;
  const canEdit = m.edits("clients") && m.can(c.id, "edit") && !m.previewing;
  const owner = m.isOwner && !m.previewing;

  const [details, setDetails] = useState(c.details);
  const [loginId, setLoginId] = useState(c.loginId);
  const [phone, setPhone] = useState(c.phone);
  const [password, setPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A revealed password does not stay on a screen somebody walks away from.
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), SHOW_FOR_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const dirty = details !== c.details || (!c.synced && (loginId !== c.loginId || phone !== c.phone));

  const save = async () => {
    setBusy(true);
    await ops.run(saveClientAccount({ id: c.id, details, ...(!c.synced && { loginId, phone }) }));
    setBusy(false);
  };

  const store = async () => {
    if (!password) return;
    setBusy(true);
    const r = await ops.run(setClientPassword({ id: c.id, password }));
    setBusy(false);
    if (r.ok) {
      setPassword("");
      setChanging(false);
      setShown(null);
    }
  };

  const reveal = async () => {
    setBusy(true);
    // No success message to show, and a refusal toasts by itself.
    const r = await ops.run(revealClientPassword(c.id));
    setBusy(false);
    if (r.ok && r.data) setShown(r.data.password);
  };

  const clear = async () => {
    setBusy(true);
    await ops.run(clearClientPassword(c.id));
    setBusy(false);
    setShown(null);
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line3 py-2.5 text-[13px] last:border-b-0">
      <span className="w-[120px] shrink-0 text-mute">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value || <span className="text-faint">Not set</span>}</span>
    </div>
  );

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
      <Section>
        <h2 className="m-0 mb-1 text-[15px]">Account</h2>
        {c.synced && <p className="m-0 mb-2 text-xs text-mute">From WabMeta. Change these there; the next sync brings them here.</p>}

        {c.synced || !canEdit ? (
          <>
            {row("Login ID", c.loginId)}
            {row("Phone", c.phone)}
          </>
        ) : (
          <div className="grid gap-2 py-2">
            <label className="text-xs text-mute">
              Login ID
              <input className={`${input} mt-1`} value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Email or username they sign in with" />
            </label>
            <label className="text-xs text-mute">
              Phone
              <input className={`${input} mt-1`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" />
            </label>
          </div>
        )}
        {c.synced && row("Plan", c.plan)}
        {c.wabmetaId && row("WabMeta ID", <span className="font-mono text-xs">{c.wabmetaId}</span>)}
        {row("Sales", c.ownerId ? m.P(c.ownerId).name : "")}
        {row("Onboarder", c.onboarderId ? m.P(c.onboarderId).name : "")}
      </Section>

      <Section>
        <h2 className="m-0 mb-3 text-[15px]">Login password</h2>
        {!owner ? (
          <p className="m-0 text-[13px] text-mute">
            {c.hasPassword ? "A password is stored. " : "No password is stored. "}Only an owner can see or change it.
          </p>
        ) : (
          <>
            {c.hasPassword && !changing ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="fw-s min-w-[140px] flex-1 rounded-lg bg-tint2 px-3 py-2 font-mono text-[13px]">
                  {shown ?? "••••••••••"}
                </span>
                {shown === null ? (
                  <OutlineButton type="button" disabled={busy} onClick={reveal}>
                    Show
                  </OutlineButton>
                ) : (
                  <OutlineButton type="button" onClick={() => setShown(null)}>
                    Hide
                  </OutlineButton>
                )}
                <OutlineButton type="button" disabled={busy} onClick={() => setChanging(true)}>
                  Change
                </OutlineButton>
                <OutlineButton type="button" disabled={busy} onClick={clear}>
                  Remove
                </OutlineButton>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${input} min-w-[180px] flex-1`}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={c.hasPassword ? "New password" : "Their password, if you have it"}
                />
                <PrimaryButton type="button" disabled={busy || !password} onClick={store}>
                  {c.hasPassword ? "Save" : "Store"}
                </PrimaryButton>
                {changing && (
                  <OutlineButton type="button" onClick={() => { setChanging(false); setPassword(""); }}>
                    Cancel
                  </OutlineButton>
                )}
              </div>
            )}
            <p className="m-0 mt-2.5 text-xs text-mute">
              Encrypted. Only owners can see it, it hides itself after 30 seconds, and every view is written to History.
            </p>
          </>
        )}
      </Section>

      <Section className="[grid-column:1/-1]">
        <h2 className="m-0 mb-3 text-[15px]">Details</h2>
        <textarea
          className="min-h-[120px] w-full rounded-lg border border-edge2 bg-white p-3 text-[13px] focus:border-accent focus:outline-none disabled:bg-tint2"
          value={details}
          disabled={!canEdit}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Anything worth keeping about this client: who to talk to, what they bought, what was promised."
        />
        {canEdit && (
          <div className="mt-2 flex justify-end">
            <PrimaryButton type="button" disabled={busy || !dirty} onClick={save}>
              Save details
            </PrimaryButton>
          </div>
        )}
      </Section>
    </div>
  );
}
