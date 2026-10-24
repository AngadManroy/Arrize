import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Chat from "@/components/Chat";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Coach · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  return (
    <AppShell active="/coach" name={user.hunter_name}>
      <Chat mode="coach" name={user.hunter_name} />
    </AppShell>
  );
}
