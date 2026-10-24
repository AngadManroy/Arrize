import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Chat from "@/components/Chat";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Set your goal · Arrize" };

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (user.onboarded_at) redirect("/board");
  return (
    <main className="app">
      <div className="row" style={{ marginBottom: 14, gap: 14 }}>
        <div className="lvl-badge" style={{ width: 56, height: 56, flex: "0 0 56px" }}><div><span style={{ fontSize: 8 }}>LV</span><b style={{ fontSize: 22 }}>1</b></div></div>
        <div>
          <p className="gate-h" style={{ letterSpacing: "0.32em", margin: 0 }}>ARRIZE · AWAKENING</p>
          <h1 className="hname">{user.hunter_name}</h1>
        </div>
      </div>
      <Chat mode="onboarding" name={user.hunter_name} />
      <p className="note center">About 8 questions. Your coach turns your answers into tracks and today&apos;s quests.</p>
    </main>
  );
}
