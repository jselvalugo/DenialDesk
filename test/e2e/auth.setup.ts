import { test as setup } from "@playwright/test";
import { e2eUser, signIn, signInOperator } from "./support";

// Signs in once per role and saves the session for the other tests.
for (const key of ["worker", "viewer", "manager", "intAdmin", "intViewer"] as const) {
  setup(`sign in as ${key}`, async ({ page }) => {
    await signIn(page, e2eUser(key));
    await page.context().storageState({ path: `test/e2e/.auth/${key}.json` });
  });
}

setup("sign in as the platform operator", async ({ page }) => {
  await signInOperator(page, e2eUser("operator"));
  await page.context().storageState({ path: "test/e2e/.auth/operator.json" });
});
