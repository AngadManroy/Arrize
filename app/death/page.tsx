import DeathQuests from "@/components/DeathQuests";
import { NoHunter } from "@/components/Nav";

export default async function Page({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  return h ? <DeathQuests h={h} /> : <NoHunter />;
}
