import type { Metadata } from "next";
import { Ads } from "@/components/ops/views/ads";

export const metadata: Metadata = { title: "Ads" };

export default function Page() {
  return <Ads />;
}
