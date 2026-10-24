import { redirect } from "next/navigation";
import { currentUser } from "./session";

/** Server-component guard for the app tabs: signed in and onboarded. */
export async function requireOnboarded() {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!user.onboarded_at) redirect("/onboard");
  return user;
}
