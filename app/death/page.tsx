import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import DeathQuest from "@/components/DeathQuest";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Death Quest · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  return (
    <AppShell active="/death" name={user.hunter_name}>
      <DeathQuest />
    </AppShell>
  );
}
