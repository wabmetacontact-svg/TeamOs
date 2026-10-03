import type { Metadata } from "next";
import { AccessView } from "@/components/ops/views/access";

export const metadata: Metadata = { title: "Access" };

export default function Page() {
  return <AccessView />;
}
