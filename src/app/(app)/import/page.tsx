import type { Metadata } from "next";
import { ImportView } from "@/components/ops/views/import";

export const metadata: Metadata = { title: "Import" };

// A big import writes thousands of rows in one transaction.
export const maxDuration = 300;

export default function Page() {
  return <ImportView />;
}
