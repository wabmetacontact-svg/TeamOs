import type { Metadata } from "next";
import { ClientsView } from "@/components/ops/views/clients";

export const metadata: Metadata = { title: "Clients" };

export default function Page() {
  return <ClientsView />;
}
