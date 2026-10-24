import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Profile from "@/components/Profile";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Profile · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  const since = new Date(`${user.created_day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <AppShell active="/profile" name={user.hunter_name}>
      <Profile name={user.hunter_name} email={user.email} since={since} />
    </AppShell>
  );
}
