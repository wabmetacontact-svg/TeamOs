import type { Metadata } from "next";
import { AuditView } from "@/components/ops/views/audit";

export const metadata: Metadata = { title: "Audit trail" };

export default function Page() {
  return <AuditView />;
}
