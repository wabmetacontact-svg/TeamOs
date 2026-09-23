"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArchiveRestore, EyeOff, Plus, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { CATEGORY_COLORS, COLOR_DOT, ROLE_LABELS, ROLES, type Role } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { addMember, changePassword, saveCategory, setCategoryArchived, updateMember, updateProfile, type MemberInput } from "@/app/(app)/settings/actions";

export function AddMemberButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <UserPlus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent title="Add team member" description="They sign in with this email and password. Share it with them once.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = Object.fromEntries(new FormData(e.currentTarget)) as unknown as MemberInput;
            start(async () => {
              const res = await addMember(fd);
              if (!res.ok) {
                setErrors(res.fieldErrors);
                return void toast.error(res.error);
              }
              setErrors(undefined);
              setOpen(false);
              toast.success(res.message ?? "Member added");
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="m-name" required error={errors?.name?.[0]}>
              <Input id="m-name" name="name" placeholder="Rahul Verma" required autoFocus />
            </Field>
            <Field label="Email" htmlFor="m-email" required error={errors?.email?.[0]}>
              <Input id="m-email" name="email" type="email" placeholder="rahul@company.com" required />
            </Field>
            <Field label="Role" htmlFor="m-role" hint="Managers see money and everyone's tasks">
              <Select id="m-role" name="role" defaultValue="MEMBER">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Designation" htmlFor="m-designation">
              <Input id="m-designation" name="designation" placeholder="Developer" />
            </Field>
          </div>
          <Field label="Temporary password" htmlFor="m-password" required hint="At least 8 characters" error={errors?.password?.[0]}>
            <Input id="m-password" name="password" type="text" placeholder="teamos1234" required />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Add member
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemberRow({
  member,
  isSelf,
}: {
  member: { id: string; name: string; email: string; role: string; active: boolean; designation: string | null };
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");

  function patch(data: Parameters<typeof updateMember>[1], successMessage?: string) {
    start(async () => {
      const res = await updateMember(member.id, data);
      if (!res.ok) return void toast.error(res.error);
      toast.success(successMessage ?? res.message ?? "Updated");
    });
  }

  return (
    <tr className="hover:bg-surface-2/60">
      <td className="px-4 py-2.5">
        <p className="font-medium">
          {member.name} {isSelf && <span className="text-xs font-normal text-muted">(you)</span>}
        </p>
        <p className="text-xs text-muted">{member.email}</p>
      </td>
      <td className="px-3 py-2.5 text-muted">{member.designation ?? "—"}</td>
      <td className="px-3 py-2.5">
        <Select
          value={member.role}
          disabled={isSelf || pending}
          onChange={(e) => patch({ role: e.target.value })}
          className="h-8 w-auto min-w-28 text-[13px]"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r as Role]}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={member.active ? "green" : "grey"}>{member.active ? "Active" : "Disabled"}</Badge>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-1.5">
          <Dialog open={resetOpen} onOpenChange={setResetOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost">
                Reset password
              </Button>
            </DialogTrigger>
            <DialogContent title={`Reset password for ${member.name}`} description="Share the new password with them.">
              <Field label="New password" htmlFor={`pw-${member.id}`} required>
                <Input id={`pw-${member.id}`} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </Field>
              <div className="mt-4 flex justify-end gap-2">
                <Button onClick={() => setResetOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={pending}
                  disabled={password.length < 8}
                  onClick={() => {
                    patch({ password }, "Password reset");
                    setPassword("");
                    setResetOpen(false);
                  }}
                >
                  Reset password
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          {!isSelf && (
            <Button size="sm" variant="ghost" loading={pending} onClick={() => patch({ active: !member.active })}>
              {member.active ? "Disable" : "Enable"}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function CategoryManager({
  categories,
}: {
  categories: { id: string; name: string; kind: string; color: string; archived: boolean; count: number }[];
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("EXPENSE");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [showArchived, setShowArchived] = useState(false);

  const visible = categories.filter((c) => showArchived || !c.archived);
  const archivedCount = categories.filter((c) => c.archived).length;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border">
        {visible.map((c) => (
          <li key={c.id} className="group flex items-center gap-2.5 py-2 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", COLOR_DOT[c.color] ?? COLOR_DOT.slate)} />
            <span className={cn("min-w-0 flex-1 truncate", c.archived && "text-muted line-through")}>{c.name}</span>
            <Badge tone={c.kind === "INCOME" ? "green" : "grey"}>{c.kind === "INCOME" ? "Income" : "Expense"}</Badge>
            <span className="tabular w-10 text-right text-xs text-muted">{c.count}</span>
            <button
              onClick={() =>
                start(async () => {
                  const res = await setCategoryArchived(c.id, !c.archived);
                  if (!res.ok) toast.error(res.error);
                })
              }
              className="rounded p-1 text-subtle opacity-0 hover:text-fg group-hover:opacity-100"
              title={c.archived ? "Restore" : "Hide"}
              aria-label={c.archived ? `Restore ${c.name}` : `Hide ${c.name}`}
            >
              {c.archived ? <ArchiveRestore className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
          </li>
        ))}
      </ul>

      {archivedCount > 0 && (
        <button onClick={() => setShowArchived(!showArchived)} className="text-xs text-brand hover:underline">
          {showArchived ? "Hide" : "Show"} {archivedCount} hidden
        </button>
      )}

      <form
        className="space-y-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveCategory({ name, kind, color });
            if (!res.ok) return void toast.error(res.error);
            setName("");
            toast.success("Category added");
          });
        }}
      >
        <div className="flex gap-1">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              className={cn("size-5 rounded-md ring-offset-2 transition", COLOR_DOT[c], color === c && "ring-2 ring-fg/30")}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category or income source" className="h-9 min-w-40 flex-1" />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 w-auto">
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </Select>
          <Button type="submit" loading={pending} disabled={name.trim().length < 2}>
            <Plus /> Add
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ProfileForm({ name, phone, email }: { name: string; phone: string | null; email: string }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.currentTarget)) as { name: string; phone: string };
        start(async () => {
          const res = await updateProfile(fd);
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.message ?? "Saved");
        });
      }}
    >
      <Field label="Email" htmlFor="p-email" hint="Ask a manager to change this">
        <Input id="p-email" value={email} disabled />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name" required>
          <Input id="p-name" name="name" defaultValue={name} required />
        </Field>
        <Field label="Phone" htmlFor="p-phone">
          <Input id="p-phone" name="phone" defaultValue={phone ?? ""} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = Object.fromEntries(new FormData(form)) as { current: string; next: string; confirm: string };
        if (fd.next !== fd.confirm) return void toast.error("New passwords don't match.");
        start(async () => {
          const res = await changePassword(fd);
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.message ?? "Password changed");
          form.reset();
        });
      }}
    >
      <Field label="Current password" htmlFor="pw-current" required>
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" htmlFor="pw-next" required>
          <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" required>
          <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
