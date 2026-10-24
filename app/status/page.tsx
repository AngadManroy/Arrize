import StatusWindow from "@/components/StatusWindow";
import { NoHunter } from "@/components/Nav";

export default async function Page({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  return h ? <StatusWindow h={h} /> : <NoHunter />;
}
