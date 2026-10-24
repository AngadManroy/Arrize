import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Board from "@/components/Board";
import { requireOnboarded } from "@/lib/guard";

export const metadata: Metadata = { title: "Quests · Arrize" };

export default async function Page() {
  const user = await requireOnboarded();
  return (
    <AppShell active="/board" name={user.hunter_name}>
      <Board />
    </AppShell>
  );
}
