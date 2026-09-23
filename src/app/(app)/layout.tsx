import { requireUser } from "@/lib/auth";
import { SidebarNav } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarNav role={user.role} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={{ name: user.name, email: user.email, role: user.role }} />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
