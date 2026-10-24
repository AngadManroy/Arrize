import Onboard from "@/components/Onboard";
import { NoHunter } from "@/components/Nav";

export default async function Page({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  return h ? <Onboard h={h} /> : <NoHunter />;
}
