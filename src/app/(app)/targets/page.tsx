import type { Metadata } from "next";
import { Targets } from "@/components/ops/views/targets";

export const metadata: Metadata = { title: "Targets" };

export default function Page() {
  return <Targets />;
}
