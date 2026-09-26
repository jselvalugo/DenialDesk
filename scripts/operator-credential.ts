// Creates the platform operator's credential for infrastructure configuration.
// Usage: pnpm operator:credential   (run on your own machine; nothing is stored or sent)
//
// Prompts for a password twice (not echoed) and prints its scrypt hash. Put the hash in the hosting
// configuration as PLATFORM_OPERATOR_PASSWORD_HASH (secret): Netlify environment variables in
// pre-production, Azure Key Vault in production. Changing it resets the operator's password and
// two-step verification and ends every operator session (docs/specs/operator-login.md).
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword, passwordProblem } from "@/auth/password";

/** The operator is the most privileged account: longer minimum than practice accounts. */
const OPERATOR_MIN_LENGTH = 16;

async function ask(prompt: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(prompt);
  muted = true;
  const answer = await new Promise<string>((resolve) => rl.question("", resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function main() {
  if (!process.stdin.isTTY) {
    process.stderr.write("Run this in an interactive terminal so the password isn't echoed or logged.\n");
    process.exit(1);
  }
  const password = await ask("Operator password (not shown): ");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (password.length < OPERATOR_MIN_LENGTH) {
    throw new Error(`Use at least ${OPERATOR_MIN_LENGTH} characters for the operator account.`);
  }
  if ((await ask("Confirm password: ")) !== password) throw new Error("The passwords don't match.");
  const hash = await hashPassword(password);
  process.stdout.write(
    [
      "",
      "Set this as PLATFORM_OPERATOR_PASSWORD_HASH (mark it secret) in the hosting configuration:",
      "",
      hash,
      "",
      "Then set PLATFORM_OPERATOR_EMAIL, redeploy, and sign in at /operator/login.",
      "You'll set up two-step verification on first sign-in.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
