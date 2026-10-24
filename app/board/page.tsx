import Board from "@/components/Board";
import { NoHunter } from "@/components/Nav";

export default async function Page({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const { h } = await searchParams;
  return h ? <Board h={h} /> : <NoHunter />;
}
