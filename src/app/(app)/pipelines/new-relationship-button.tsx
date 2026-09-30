"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createRelationship } from "./actions";

type Context = { id: string; name: string; stages: { id: string; name: string }[] };

export function NewRelationshipButton({
  contexts,
  defaultContextId,
  owners,
  clients,
}: {
  contexts: Context[];
  defaultContextId: string;
  owners: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [contextId, setContextId] = useState(defaultContextId);

  const context = contexts.find((c) => c.id === contextId) ?? contexts[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New relationship
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New relationship"
        description="If this email is already on file, the same person is used — an investor who is also a KOL is one human, not two records."
        className="sm:max-w-xl"
      >
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              setErrors({});
              const result = await createRelationship({
                name: String(formData.get("name") ?? ""),
                email: String(formData.get("email") ?? "") || undefined,
                phone: String(formData.get("phone") ?? "") || undefined,
                notes: String(formData.get("notes") ?? "") || undefined,
                contextId: String(formData.get("contextId") ?? ""),
                stageId: String(formData.get("stageId") ?? "") || undefined,
                ownerId: String(formData.get("ownerId") ?? "") || undefined,
                clientId: String(formData.get("clientId") ?? "") || undefined,
                value: String(formData.get("value") ?? "") || undefined,
                currency: String(formData.get("currency") ?? "INR"),
                relationshipNotes: String(formData.get("relationshipNotes") ?? "") || undefined,
              });

              if (result.ok) {
                setOpen(false);
                if (result.data?.personId) router.push(`/people/${result.data.personId}`);
                else router.refresh();
              } else {
                setError(result.error);
                setErrors(result.fieldErrors ?? {});
              }
            })
          }
          className="grid gap-4"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="r-name" error={errors.name?.[0]} required>
              <Input id="r-name" name="name" placeholder="Priya Sharma" required autoFocus />
            </Field>
            <Field label="Email" htmlFor="r-email" error={errors.email?.[0]} hint="Matches an existing person if it is on file">
              <Input id="r-email" name="email" type="email" placeholder="priya@fund.com" />
            </Field>
            <Field label="Phone" htmlFor="r-phone">
              <Input id="r-phone" name="phone" placeholder="+91 98765 43210" />
            </Field>
            <Field label="About them" htmlFor="r-notes">
              <Input id="r-notes" name="notes" placeholder="Angel, ex-operator" />
            </Field>
          </div>

          <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-2">
            <Field label="Pipeline" htmlFor="r-context" error={errors.contextId?.[0]} required>
              <Select
                id="r-context"
                name="contextId"
                value={contextId}
                onChange={(e) => setContextId(e.currentTarget.value)}
                required
              >
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Stage" htmlFor="r-stage" hint="Defaults to the first stage">
              <Select id="r-stage" name="stageId" defaultValue="" key={contextId}>
                <option value="">First stage</option>
                {context?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Owner" htmlFor="r-owner" hint="Defaults to you">
              <Select id="r-owner" name="ownerId" defaultValue="">
                <option value="">You</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Client" htmlFor="r-client" hint="If this sits under a client you already have">
              <Select id="r-client" name="clientId" defaultValue="">
                <option value="">None</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Value" htmlFor="r-value" hint="Cheque or deal size, if it is known">
              <Input id="r-value" name="value" inputMode="decimal" placeholder="50,00,000" />
            </Field>

            <Field label="Currency" htmlFor="r-currency">
              <Input id="r-currency" name="currency" defaultValue="INR" maxLength={3} className="font-mono uppercase" />
            </Field>

            <Field label="Notes on this relationship" htmlFor="r-rnotes" className="sm:col-span-2">
              <Textarea id="r-rnotes" name="relationshipNotes" placeholder="Where this came from, what they want." />
            </Field>
          </div>

          <Button type="submit" variant="primary" loading={pending} className="justify-self-start">
            Add relationship
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
