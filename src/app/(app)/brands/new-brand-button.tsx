"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DEFAULT_BRAND_COLOR } from "@/lib/brand-colors";
import { createBrand } from "./actions";
import { ColorPicker } from "./color-picker";

export function NewBrandButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState<string>(DEFAULT_BRAND_COLOR);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setColor(DEFAULT_BRAND_COLOR);
        }
      }}
    >
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
              const result = await createBrand({ name: String(formData.get("name") ?? ""), color });
              if (result.ok) {
                setOpen(false);
                setColor(DEFAULT_BRAND_COLOR);
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

          <Field
            label="Colour"
            htmlFor="brand-color"
            hint="Pick a preset, or any colour — paste the hex from the brand's style guide"
          >
            <ColorPicker id="brand-color" value={color} onChange={setColor} />
          </Field>

          <Button type="submit" variant="primary" loading={pending} className="mt-1 justify-self-start">
            Add brand
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
