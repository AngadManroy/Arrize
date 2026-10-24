import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Stats from "@/components/Stats";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Stats · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  return (
    <AppShell active="/status" name={user.hunter_name}>
      <Stats />
    </AppShell>
  );
}
