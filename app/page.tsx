import { redirect } from "next/navigation";
import Gate from "@/components/Gate";
import { currentUser } from "@/lib/session";

export default async function Home() {
  const user = await currentUser();
  if (user) redirect(user.onboarded_at ? "/board" : "/onboard");
  return <Gate />;
}
