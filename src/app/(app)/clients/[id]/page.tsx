import type { Metadata } from "next";
import { ClientView } from "@/components/ops/views/client";

export const metadata: Metadata = { title: "Client" };

export default async function Page({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  return <ClientView id={decodeURIComponent(id)} />;
}
