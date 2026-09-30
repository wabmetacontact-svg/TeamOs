"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { inviteUser } from "./actions";

type Role = { id: string; name: string; description: string | null };

/**
 * There is no mail server yet, so the link is shown once and copied by hand.
 * That is stated plainly rather than hidden: an invitation the sender thinks
 * was emailed and was not is worse than one they know they have to paste.
 */
export function InviteButton({ roles }: { roles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const member = roles.find((r) => r.name === "Member") ?? roles[0];

  function reset() {
    setError(null);
    setFields({});
    setLink(null);
    setCopied(false);
  }

  function submit(formData: FormData) {
    reset();
    start(async () => {
      const result = await inviteUser({
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? "") || undefined,
        roleId: String(formData.get("roleId") ?? ""),
        allClients: formData.get("allClients") === "on",
        clientIds: [],
      });

      if (result.ok) setLink(result.data?.link ?? null);
      else {
        setError(result.error);
        setFields(result.fieldErrors ?? {});
      }
    });
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary">
          <UserPlus />
          Invite someone
        </Button>
      </DialogTrigger>

      <DialogContent
        title={link ? "Send them this link" : "Invite someone"}
        description={
          link
            ? "It works once and expires in 72 hours. You will not be able to see it again after you close this."
            : "They choose their own password, so you never handle it."
        }
      >
        {link ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant={copied ? "primary" : "secondary"} size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted">
              Anyone with this link can join as the role you picked, so send it the way you would send a password.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                reset();
              }}
            >
              Invite someone else
            </Button>
          </div>
        ) : (
          <form action={submit} className="grid gap-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}

            <Field label="Email" htmlFor="email" error={fields.email?.[0]} required>
              <Input id="email" name="email" type="email" placeholder="priya@company.com" required autoFocus />
            </Field>

            <Field label="Name" htmlFor="name" error={fields.name?.[0]} hint="Optional — they can correct it when they join">
              <Input id="name" name="name" placeholder="Priya Sharma" />
            </Field>

            <Field label="Role" htmlFor="roleId" error={fields.roleId?.[0]} required>
              <Select id="roleId" name="roleId" defaultValue={member?.id} required>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <input type="checkbox" name="allClients" defaultChecked className="mt-0.5 size-4 accent-[var(--brand)]" />
              <span className="text-sm">
                Every client
                <span className="block text-xs text-muted">
                  Untick to assign specific clients once they have accepted.
                </span>
              </span>
            </label>

            <Button type="submit" variant="primary" loading={pending} className="mt-1">
              Create invitation
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
