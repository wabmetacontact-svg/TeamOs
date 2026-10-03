import { requireSigned } from "@/lib/auth";
import { loadWorkspace } from "@/lib/workspace";
import { Shell } from "@/components/ops/shell";
import { OpsProvider } from "@/components/ops/store";

/**
 * Every signed-in screen. The workspace is loaded here once, for whoever is
 * looking, and handed to the browser; moving between screens after that does
 * not go back to the database.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const signed = await requireSigned();
  const workspace = await loadWorkspace(signed);
  return (
    <OpsProvider initial={workspace}>
      <Shell>{children}</Shell>
    </OpsProvider>
  );
}
