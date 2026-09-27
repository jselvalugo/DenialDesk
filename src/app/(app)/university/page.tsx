import { redirect } from "next/navigation";

/** The University module opens on its Wiki until the owner shapes the rest of the module. */
export default function UniversityHome() {
  redirect("/university/wiki");
}
