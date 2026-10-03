import type { Metadata } from "next";
import { TasksView } from "@/components/ops/views/tasks";

export const metadata: Metadata = { title: "Tasks" };

export default function Page() {
  return <TasksView />;
}
