"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/auth";
import { markRead } from "@/lib/notifications";

/**
 * Marking your own notifications read.
 *
 * Not a defineAction: there is no permission for reading your own bell, and
 * inventing one would mean a role could be configured to forbid somebody from
 * dismissing their own notices.
 */
export async function markAllRead(): Promise<void> {
  const { scope } = await requireScope();
  await markRead(scope);
  revalidatePath("/", "layout");
}
