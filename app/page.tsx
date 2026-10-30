import { Dashboard } from "@/components/Dashboard";
import { buildDashboard } from "@/lib/aggregate";
import { OWNER_NAME } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await buildDashboard();
  return <Dashboard initial={data} owner={OWNER_NAME} signOut={Boolean(process.env.DASHBOARD_PASSWORD)} />;
}
