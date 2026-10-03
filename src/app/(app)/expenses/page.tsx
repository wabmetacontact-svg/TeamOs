import type { Metadata } from "next";
import { ExpensesView } from "@/components/ops/views/expenses";

export const metadata: Metadata = { title: "Income and expenses" };

export default function Page() {
  return <ExpensesView />;
}
