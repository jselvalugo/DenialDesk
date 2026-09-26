import { redirect } from "next/navigation";

/** Old address of the home page; kept so bookmarks still work. */
export default function WelcomeRedirect() {
  redirect("/");
}
