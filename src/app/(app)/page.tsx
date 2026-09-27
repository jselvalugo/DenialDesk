import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { todayIn } from "@rules/calendar";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { appHome, navApps } from "@/components/shell/navigation";
import { toneClasses } from "@/components/shell/tones";
import { Badge } from "@/components/ui/Badge";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Welcome" };

interface Step {
  title: string;
  body: string;
  /** Null until the step ships: shown as "Planned", never a link. */
  href: string | null;
  linkLabel?: string;
}

const STEPS: Step[] = [
  {
    title: "Record the claim",
    body: "Claims are kept with their service lines, diagnosis and procedure codes, payer, and the filing deadline that applies to them.",
    href: "/claims",
    linkLabel: "Claims",
  },
  {
    title: "Classify the denial",
    body: "Each denial is read by its CARC and RARC reason codes and grouped into a category that points to the likely fix.",
    href: "/denials",
    linkLabel: "Denials",
  },
  {
    title: "Work what matters first",
    body: "The queue sorts open denials by appeal deadline or amount at stake, with deadlines computed from versioned Florida and payer rules.",
    href: "/denials",
    linkLabel: "Denial queue",
  },
  {
    title: "Appeal with approval",
    body: "Appeals are drafted from the denial and the claim record. No procedure or diagnosis code changes without a recorded human approval.",
    href: null,
  },
  {
    title: "Track the outcome",
    body: "Recoveries, write-offs, and payer response times are reported so the practice can see which payers and reasons cost it most.",
    href: null,
  },
];

/** How the patient record feeds claims and denials. Same shipped/planned rule as STEPS. */
const RECORD_FLOW: Step[] = [
  {
    title: "Patient record",
    body: "Registration keeps demographics and primary coverage: payer, plan, and member ID (encrypted). Each claim is linked to the patient and the payer billed, so the record behind every claim is one click away.",
    href: "/patients",
    linkLabel: "Patients",
  },
  {
    title: "Charges become claims",
    body: "Charges from your practice management or EHR system will arrive by CSV file and become draft claims tied to the patient and payer. Direct EHR connections are not planned for launch.",
    href: null,
  },
  {
    title: "Claim filed and answered",
    body: "Claims will go to the clearinghouse as 837P files; acknowledgments and 835 remittances will come back and be matched to the claim.",
    href: null,
  },
  {
    title: "Denial back on the chart",
    body: "Each denial is linked to its claim and patient. The patient chart lists every claim and denial, so a coverage or registration error can be found and corrected on the patient record.",
    href: "/patients",
    linkLabel: "Patient charts",
  },
];

const SAFEGUARDS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Building2,
    title: "Practice data stays separate",
    body: "Every record is scoped to your practice at the database layer.",
  },
  {
    icon: ScrollText,
    title: "Every access is recorded",
    body: "Reads and changes to patient data are written to an audit trail: who, what, and when.",
  },
  {
    icon: CalendarClock,
    title: "Deadlines come from cited rules",
    body: "Filing, prompt-pay, and appeal clocks are versioned, effective-dated rules with their statutory source.",
  },
  {
    icon: FileCheck2,
    title: "People approve coding changes",
    body: "No procedure or diagnosis code will be changed without a recorded human approval.",
  },
  {
    icon: KeyRound,
    title: "Sign-in needs a second factor",
    body: "Every practice account uses an authenticator code, and idle sessions end after 15 minutes.",
  },
  {
    icon: LockKeyhole,
    title: "Identifiers are encrypted",
    body: "Member IDs are encrypted field by field, and patient names are kept out of page addresses.",
  },
  {
    icon: ShieldCheck,
    title: "Business Associate Agreements on file",
    body: "Each practice's signed agreement is recorded with its dates and signers; a missing one is flagged.",
  },
];

function StepLink({ step }: { step: Step }) {
  return step.href ? (
    <Link
      href={step.href}
      className="inline-flex items-center gap-1 text-body font-medium text-link hover:underline"
    >
      {step.linkLabel}
      <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </Link>
  ) : (
    <span>
      <Badge dot={false}>Planned</Badge>
    </span>
  );
}

/** Home: where sign-in and the logo land: a plain-language map of the platform and a way into each module. */
export default async function HomePage() {
  const auth = await requireAuth();
  const firstName = auth.displayName.trim().split(/\s+/)[0] || auth.displayName;
  const apps = navApps({
    showRevenueCycle: canViewRevenueCycle(auth.role),
    showSettings: true,
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <p className="text-label font-semibold tracking-wider text-muted uppercase">
            {auth.tenantName} · {formatDate(todayIn())}
          </p>
          <h1 className="font-serif text-display font-bold text-primary">Welcome, {firstName}</h1>
          <p className="mt-0.5 max-w-3xl text-body text-muted">
            DenialDesk follows each claim from submission to payment: it classifies denials, ranks them by
            value and deadline, and keeps the Florida clocks that decide what can still be recovered.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/university" className="text-body font-medium text-link hover:underline">
            New here? Start with DenialDesk University
          </Link>
          <Link
            href="/university/wiki"
            title="DenialDesk Wiki"
            className="inline-flex h-9 items-center rounded-control border border-border px-2 hover:bg-surface-muted"
          >
            <Image src="/brand/denialdesk-wiki.png" alt="DenialDesk Wiki" width={100} height={30} />
          </Link>
          <Link href="/denials" className={primaryLinkButtonClass}>
            Open denial queue
          </Link>
        </div>
      </header>

      <Panel title="How DenialDesk works" description="The path a claim takes through the platform" flush>
        <ol className="grid grid-cols-1 divide-y divide-border md:grid-cols-5 md:divide-x md:divide-y-0">
          {STEPS.map((step, index) => (
            <li key={step.title} data-step={index + 1} className="flex flex-col gap-2 px-4 py-4">
              <span className="font-mono text-label text-subtle tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-heading font-semibold text-text">{step.title}</h3>
              <p className="flex-1 text-body text-muted">{step.body}</p>
              <StepLink step={step} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="From patient record to claim and denial"
        description="How the patient record feeds every claim, and where each denial comes back to"
        flush
      >
        <ol className="grid grid-cols-1 divide-y divide-border md:grid-cols-4 md:divide-x md:divide-y-0">
          {RECORD_FLOW.map((step, index) => (
            <li key={step.title} data-record-step={index + 1} className="flex flex-col gap-2 px-4 py-4">
              <span className="font-mono text-label text-subtle tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-heading font-semibold text-text">{step.title}</h3>
              <p className="flex-1 text-body text-muted">{step.body}</p>
              <StepLink step={step} />
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="Your modules" description="Also available from the module switcher (Ctrl K)" flush>
            <ul className="divide-y divide-border">
              {apps.map((app) => {
                const href = appHome(app);
                return (
                  <li key={app.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-control border",
                        toneClasses[app.tone],
                      )}
                    >
                      <app.icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {href ? (
                        <Link href={href} className="text-body font-semibold text-link hover:underline">
                          {app.label}
                        </Link>
                      ) : (
                        <span className="text-body font-semibold text-text">{app.label}</span>
                      )}
                      <p className="text-label text-muted">{app.description}</p>
                    </div>
                    {!href && <Badge dot={false}>Planned</Badge>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="Safeguards" description="Security and compliance controls in place today">
            <ul className="flex flex-col gap-4">
              {SAFEGUARDS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-accent"
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className="text-body font-semibold text-text">{title}</p>
                    <p className="text-label text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
