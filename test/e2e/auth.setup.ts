import { test as setup } from "@playwright/test";
import { e2eUser, signIn } from "./support";

// Signs in once per role and saves the session for the other tests.
for (const key of ["worker", "viewer"] as const) {
  setup(`sign in as ${key}`, async ({ page }) => {
    await signIn(page, e2eUser(key));
    await page.context().storageState({ path: `test/e2e/.auth/${key}.json` });
  });
}
