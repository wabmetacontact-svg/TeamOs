"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { createContext } from "./actions";

const DEFAULT_STAGES = ["New", "In conversation", "Won", "Lost"];

export function NewContextButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState(DEFAULT_STAGES.join("\n"));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus />
          New pipeline
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New pipeline"
        description="Stages can be renamed and reordered afterwards — these are a starting point, not a commitment."
      >
        <form
          action={(formData) =>
            start(async () => {
              setError(null);
              const result = await createContext({
                name: String(formData.get("name") ?? ""),
                stages: stages
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              if (result.ok) {
                setOpen(false);
                setStages(DEFAULT_STAGES.join("\n"));
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

          <Field label="Name" htmlFor="ctx-name" required>
            <Input id="ctx-name" name="name" placeholder="Partner" required autoFocus />
          </Field>

          <Field
            label="Stages"
            htmlFor="ctx-stages"
            hint="One per line. Won, Lost, Signed, Closed, Declined and Passed are treated as endings automatically."
          >
            <textarea
              id="ctx-stages"
              value={stages}
              onChange={(e) => setStages(e.currentTarget.value)}
              rows={6}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </Field>

          <Button type="submit" variant="primary" loading={pending} className="justify-self-start">
            Add pipeline
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
