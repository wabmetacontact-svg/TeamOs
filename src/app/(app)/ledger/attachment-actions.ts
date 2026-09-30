"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError, type ActionResult } from "@/lib/action";
import { getTransaction, isMonthClosed } from "@/lib/transactions";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  isAllowedUploadType,
  objectKey,
  presign,
  storageConfigured,
  deleteObject,
} from "@/lib/storage";
import { NotFoundError } from "@/lib/scope";

/**
 * Receipts.
 *
 * The file never passes through this server. The browser asks for a signed URL,
 * uploads straight to the bucket, and then tells us where it landed — a 10 MB
 * PDF through a serverless function would spend its whole memory budget and
 * most of its timeout carrying bytes it does nothing with.
 *
 * The cost of that is one honest gap: between handing out the URL and being
 * told the upload finished, we do not know whether it did. So the row is
 * written only on the confirmation, and an upload that is started and abandoned
 * leaves an orphan in the bucket and nothing in the database. That is the right
 * way round — a database row pointing at a file that does not exist is much
 * worse than a file nobody references.
 */

export const requestUploadUrl = defineAction({
  permission: "expense:edit",
  input: z.object({
    transactionId: z.string().min(1),
    filename: z.string().trim().min(1).max(200),
    contentType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive(),
  }),
  async handler(ctx, input) {
    if (!storageConfigured()) {
      throw new UserError("File storage is not set up for this workspace yet. See DEPLOY.md.", "conflict");
    }

    // Through getTransaction, so a transaction outside scope cannot be given
    // an upload slot any more than it can be read.
    const transaction = await getTransaction(ctx.scope, input.transactionId);

    if (await isMonthClosed(ctx.scope, transaction.clientId, transaction.bookMonth)) {
      throw new UserError(`${transaction.bookMonth} is closed. Reopen it to add a receipt.`);
    }

    if (!isAllowedUploadType(input.contentType)) {
      throw new UserError(`That file type is not accepted. Use ${ALLOWED_UPLOAD_TYPES.join(", ")}.`, "invalid");
    }
    if (input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new UserError(`Files are capped at ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, "invalid");
    }

    const key = objectKey(ctx.user.tenantId, transaction.id, input.filename);
    const url = presign("PUT", key, { expiresIn: 300, contentType: input.contentType });
    if (!url) throw new UserError("Could not prepare the upload.", "error");

    // No audit entry yet: nothing has happened. The entry is written when the
    // upload is confirmed.
    return { ok: true, data: { url, key } } satisfies ActionResult<{ url: string; key: string }>;
  },
});

export const confirmUpload = defineAction({
  permission: "expense:edit",
  input: z.object({
    transactionId: z.string().min(1),
    key: z.string().min(1),
    filename: z.string().trim().min(1).max(200),
    contentType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive(),
  }),
  async handler(ctx, input) {
    const transaction = await getTransaction(ctx.scope, input.transactionId);

    // The key was minted for this tenant and this transaction; anything else
    // is a client that has been edited.
    if (!input.key.startsWith(`${ctx.user.tenantId}/${transaction.id}/`)) {
      throw new UserError("That upload does not belong here.", "denied");
    }
    if (!isAllowedUploadType(input.contentType) || input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new UserError("That file was rejected.", "invalid");
    }

    const attachment = await ctx.db.attachment.create({
      data: {
        tenantId: ctx.user.tenantId,
        transactionId: transaction.id,
        storageKey: input.key,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedById: ctx.user.id,
      },
    });

    await ctx.audit({
      action: "attachment_added",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      after: { filename: input.filename, sizeBytes: input.sizeBytes },
    });

    revalidatePath(`/ledger/${input.transactionId}`);
    return { ok: true, data: { id: attachment.id } } satisfies ActionResult<{ id: string }>;
  },
});

/**
 * A short-lived link to read one receipt.
 *
 * Minted per request rather than stored, and good for five minutes. A URL that
 * lives in a database is a URL that outlives the permission that created it.
 */
export const getDownloadUrl = defineAction({
  permission: "expense:view",
  input: z.object({ attachmentId: z.string().min(1) }),
  async handler(ctx, input) {
    const attachment = await ctx.db.attachment.findUnique({
      where: { id: input.attachmentId },
      select: { id: true, storageKey: true, filename: true, transactionId: true },
    });
    if (!attachment) throw new NotFoundError();

    // The scope check is on the transaction, which is what the receipt is
    // attached to — the attachment table has no client of its own.
    await getTransaction(ctx.scope, attachment.transactionId);

    const url = presign("GET", attachment.storageKey, { expiresIn: 300, downloadAs: attachment.filename });
    if (!url) throw new UserError("File storage is not set up for this workspace.", "conflict");

    return { ok: true, data: { url } } satisfies ActionResult<{ url: string }>;
  },
});

export const removeAttachment = defineAction({
  permission: "expense:edit",
  input: z.object({ attachmentId: z.string().min(1) }),
  async handler(ctx, input) {
    const attachment = await ctx.db.attachment.findUnique({ where: { id: input.attachmentId } });
    if (!attachment) throw new NotFoundError();

    const transaction = await getTransaction(ctx.scope, attachment.transactionId);
    if (await isMonthClosed(ctx.scope, transaction.clientId, transaction.bookMonth)) {
      throw new UserError(`${transaction.bookMonth} is closed. Reopen it to remove a receipt.`);
    }

    await ctx.db.attachment.delete({ where: { id: input.attachmentId } });

    // Best effort, and deliberately after the row is gone. A file left in the
    // bucket is tidiness; a row pointing at a deleted file is a broken page.
    await deleteObject(attachment.storageKey);

    await ctx.audit({
      action: "attachment_removed",
      resourceType: "Transaction",
      resourceId: transaction.id,
      resourceLabel: `${transaction.ref} · ${transaction.name}`,
      before: { filename: attachment.filename },
    });

    revalidatePath(`/ledger/${attachment.transactionId}`);
    return { ok: true, message: `${attachment.filename} removed.` } satisfies ActionResult;
  },
});
