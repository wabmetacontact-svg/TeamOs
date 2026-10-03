import type { Metadata } from "next";
import { ImportView } from "@/components/ops/views/import";

export const metadata: Metadata = { title: "Import" };

export default function Page() {
  return <ImportView />;
}
