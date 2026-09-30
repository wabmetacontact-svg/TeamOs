"use client";

import { useState, useTransition } from "react";
import { Mail, Phone, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { addClientContact, removeClientContact } from "../actions";

type Contact = {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
};

export function ContactsPanel({
  clientId,
  contacts,
  canEdit,
}: {
  clientId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {contacts.length === 0 && !adding && (
        <p className="text-sm text-muted">No contacts yet. Who do you actually talk to here?</p>
      )}

      {contacts.length > 0 && (
        <ul className="grid gap-2">
          {contacts.map((contact) => (
            <li key={contact.personId} className="flex items-center gap-2.5">
              <Avatar name={contact.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{contact.name}</span>
                  {contact.isPrimary && <Badge tone="blue">Primary</Badge>}
                </div>
                <p className="truncate text-xs text-muted">
                  {[contact.title, contact.email, contact.phone].filter(Boolean).join(" · ") || "No details"}
                </p>
              </div>

              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-fg"
                  aria-label={`Email ${contact.name}`}
                >
                  <Mail className="size-4" />
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-fg"
                  aria-label={`Call ${contact.name}`}
                >
                  <Phone className="size-4" />
                </a>
              )}

              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const result = await removeClientContact({ clientId, personId: contact.personId });
                      if (!result.ok) setError(result.error);
                    })
                  }
                  className="rounded-md p-1.5 text-muted hover:bg-rose-50 hover:text-[var(--red)]"
                  aria-label={`Remove ${contact.name}`}
                  title="Removes the link to this client. The person stays on file."
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}
      {note && <p className="text-sm text-muted">{note}</p>}

      {canEdit &&
        (adding ? (
          <form
            action={(formData) =>
              start(async () => {
                setError(null);
                setNote(null);
                const result = await addClientContact({
                  clientId,
                  name: String(formData.get("name") ?? ""),
                  email: String(formData.get("email") ?? "") || undefined,
                  phone: String(formData.get("phone") ?? "") || undefined,
                  title: String(formData.get("title") ?? "") || undefined,
                  isPrimary: formData.get("isPrimary") === "on",
                });
                if (result.ok) {
                  setAdding(false);
                  setNote(result.message ?? null);
                } else setError(result.error);
              })
            }
            className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="c-name" required>
                <Input id="c-name" name="name" placeholder="Priya Sharma" required autoFocus />
              </Field>
              <Field label="Title" htmlFor="c-title">
                <Input id="c-title" name="title" placeholder="Head of Marketing" />
              </Field>
              <Field
                label="Email"
                htmlFor="c-email"
                hint="If this address is already on file, the same person is linked rather than copied"
              >
                <Input id="c-email" name="email" type="email" placeholder="priya@client.com" />
              </Field>
              <Field label="Phone" htmlFor="c-phone">
                <Input id="c-phone" name="phone" placeholder="+91 98765 43210" />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPrimary" className="size-4 accent-brand" />
              Primary contact
            </label>

            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={pending}>
                Add contact
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setAdding(true)}>
            <Plus />
            Add contact
          </Button>
        ))}
    </div>
  );
}
