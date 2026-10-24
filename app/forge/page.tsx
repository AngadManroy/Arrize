import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Forge from "@/components/Forge";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Forge · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  return (
    <AppShell active="/forge" name={user.hunter_name}>
      <Forge />
    </AppShell>
  );
}
