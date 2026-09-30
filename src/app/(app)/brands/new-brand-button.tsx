"use client";

import { BRAND_COLORS } from "@/lib/ui-enums";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { createBrand } from "./actions";

export function NewBrandButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New brand
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New brand"
        description="Fields come after — a brand starts with the standard client form and you add to it."
      >
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await createBrand({
                name: String(formData.get("name") ?? ""),
                color: String(formData.get("color") ?? "blue") as (typeof BRAND_COLORS)[number],
              });
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else setError(result.error);
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

          <Field label="Name" htmlFor="brand-name" required>
            <Input id="brand-name" name="name" placeholder="ARC3" required autoFocus />
          </Field>

          <Field label="Colour" htmlFor="brand-color" hint="Used wherever the brand is shown beside a client">
            <Select id="brand-color" name="color" defaultValue="blue">
              {BRAND_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit" variant="primary" loading={pending} className="mt-1 justify-self-start">
            Add brand
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
