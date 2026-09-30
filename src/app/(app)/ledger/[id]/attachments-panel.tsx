"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Download, FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmUpload, getDownloadUrl, removeAttachment, requestUploadUrl } from "../attachment-actions";

type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

/**
 * Receipts, uploaded straight to the bucket.
 *
 * The server hands out a signed URL and the browser PUTs to it directly. A
 * 10 MB PDF routed through a serverless function would spend that function's
 * whole memory budget carrying bytes it does nothing with, and time out on a
 * slow connection.
 */
export function AttachmentsPanel({
  transactionId,
  attachments,
  canEdit,
  storageReady,
}: {
  transactionId: string;
  attachments: Attachment[];
  canEdit: boolean;
  storageReady: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(file.name);

    try {
      const slot = await requestUploadUrl({
        transactionId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      if (!slot.ok) {
        setError(slot.error);
        return;
      }

      const response = await fetch(slot.data!.url, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });

      if (!response.ok) {
        setError("The upload did not go through. Try again.");
        return;
      }

      // Only now does a row exist. An abandoned upload leaves a file in the
      // bucket and nothing in the database — the right way round, because a row
      // pointing at a missing file is a broken page.
      const confirmed = await confirmUpload({
        transactionId,
        key: slot.data!.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      if (confirmed.ok) router.refresh();
      else setError(confirmed.error);
    } catch {
      setError("The upload did not go through. Check your connection and try again.");
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  async function download(id: string) {
    setError(null);
    const result = await getDownloadUrl({ attachmentId: id });
    if (result.ok && result.data) window.open(result.data.url, "_blank", "noopener");
    else if (!result.ok) setError(result.error);
  }

  if (!storageReady) {
    return (
      <p className="text-sm text-muted">
        File storage is not set up for this workspace, so receipts cannot be attached yet. Everything else works —
        see DEPLOY.md for the four environment variables it needs.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {attachments.length === 0 && !uploading && <p className="text-sm text-muted">No receipt attached.</p>}

      {attachments.length > 0 && (
        <ul className="grid gap-2">
          {attachments.map((file) => {
            const Icon = file.contentType.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={file.id} className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{file.filename}</p>
                  <p className="truncate text-xs text-muted">
                    {formatSize(file.sizeBytes)} · {file.uploadedBy}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => download(file.id)}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-fg"
                  aria-label={`Download ${file.filename}`}
                >
                  <Download className="size-4" />
                </button>

                {canEdit && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null);
                        const result = await removeAttachment({ attachmentId: file.id });
                        if (result.ok) router.refresh();
                        else setError(result.error);
                      })
                    }
                    className="rounded-md p-1.5 text-muted hover:bg-rose-50 hover:text-[var(--red)]"
                    aria-label={`Remove ${file.filename}`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {uploading && <p className="text-sm text-muted">Uploading {uploading}…</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            loading={Boolean(uploading)}
            onClick={() => input.current?.click()}
          >
            <Paperclip />
            Attach a receipt
          </Button>
          <p className="text-xs text-subtle">PDF or an image, up to 10 MB.</p>
        </>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
