import type { Metadata } from "next";
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
import { SESSION_IDLE_MS } from "@/auth/policy";
import { requireAuth } from "@/auth/session";
import { appHome, navApps } from "@/components/shell/navigation";
import { toneClasses } from "@/components/shell/tones";
import { Badge } from "@/components/ui/Badge";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { Panel } from "@/components/ui/Panel";
import { getFormat, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { cn } from "@/lib/cn";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("welcome");
  return { title: t("meta.title") };
}

interface Step {
  titleKey: MessageKey<"welcome">;
  bodyKey: MessageKey<"welcome">;
  /** Null until the step ships: shown as "Planned", never a link. */
  href: string | null;
  linkKey?: MessageKey<"welcome">;
}

const STEPS: Step[] = [
  { titleKey: "step1.title", bodyKey: "step1.body", href: "/claims", linkKey: "step1.link" },
  { titleKey: "step2.title", bodyKey: "step2.body", href: "/denials", linkKey: "step2.link" },
  { titleKey: "step3.title", bodyKey: "step3.body", href: "/denials", linkKey: "step3.link" },
  { titleKey: "step4.title", bodyKey: "step4.body", href: null },
  { titleKey: "step5.title", bodyKey: "step5.body", href: null },
];

/** How the patient record feeds claims and denials. Same shipped/planned rule as STEPS. */
const RECORD_FLOW: Step[] = [
  { titleKey: "record1.title", bodyKey: "record1.body", href: "/patients", linkKey: "record1.link" },
  { titleKey: "record2.title", bodyKey: "record2.body", href: null },
  { titleKey: "record3.title", bodyKey: "record3.body", href: null },
  { titleKey: "record4.title", bodyKey: "record4.body", href: "/patients", linkKey: "record4.link" },
];

const SAFEGUARDS: { icon: LucideIcon; titleKey: MessageKey<"welcome">; bodyKey: MessageKey<"welcome"> }[] = [
  { icon: Building2, titleKey: "safeguard1.title", bodyKey: "safeguard1.body" },
  { icon: ScrollText, titleKey: "safeguard2.title", bodyKey: "safeguard2.body" },
  { icon: CalendarClock, titleKey: "safeguard3.title", bodyKey: "safeguard3.body" },
  { icon: FileCheck2, titleKey: "safeguard4.title", bodyKey: "safeguard4.body" },
  { icon: KeyRound, titleKey: "safeguard5.title", bodyKey: "safeguard5.body" },
  { icon: LockKeyhole, titleKey: "safeguard6.title", bodyKey: "safeguard6.body" },
  { icon: ShieldCheck, titleKey: "safeguard7.title", bodyKey: "safeguard7.body" },
];

type WelcomeT = Awaited<ReturnType<typeof getT<"welcome">>>;
type CommonT = Awaited<ReturnType<typeof getT<"common">>>;

function StepLink({ step, t, tc }: { step: Step; t: WelcomeT; tc: CommonT }) {
  return step.href ? (
    <Link
      href={step.href}
      className="inline-flex items-center gap-1 text-body font-medium text-link hover:underline"
    >
      {t(step.linkKey!)}
      <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </Link>
  ) : (
    <span>
      <Badge dot={false}>{tc("word.planned")}</Badge>
    </span>
  );
}

/** Home: where sign-in and the logo land: a plain-language map of the platform and a way into each module. */
export default async function HomePage() {
  const auth = await requireAuth();
  const t = await getT("welcome");
  const tc = await getT("common");
  const tShell = await getT("shell");
  const f = await getFormat();
  const firstName = auth.displayName.trim().split(/\s+/)[0] || auth.displayName;
  const apps = navApps(
    {
      showRevenueCycle: canViewRevenueCycle(auth.role),
      showSettings: true,
    },
    tShell,
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <p className="text-label font-semibold tracking-wider text-muted uppercase">
            {auth.tenantName} · {f.date(todayIn())}
          </p>
          <h1 className="font-serif text-display font-bold text-primary">
            {t("heading", { name: firstName })}
          </h1>
          <p className="mt-0.5 max-w-3xl text-body text-muted">{t("intro")}</p>
        </div>
        <Link href="/denials" className={primaryLinkButtonClass}>
          {t("openQueue")}
        </Link>
      </header>

      <Panel title={t("howItWorks.title")} description={t("howItWorks.description")} flush>
        <ol className="grid grid-cols-1 divide-y divide-border md:grid-cols-5 md:divide-x md:divide-y-0">
          {STEPS.map((step, index) => (
            <li key={step.titleKey} data-step={index + 1} className="flex flex-col gap-2 px-4 py-4">
              <span className="font-mono text-label text-subtle tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-heading font-semibold text-text">{t(step.titleKey)}</h3>
              <p className="flex-1 text-body text-muted">{t(step.bodyKey)}</p>
              <StepLink step={step} t={t} tc={tc} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={t("recordFlow.title")} description={t("recordFlow.description")} flush>
        <ol className="grid grid-cols-1 divide-y divide-border md:grid-cols-4 md:divide-x md:divide-y-0">
          {RECORD_FLOW.map((step, index) => (
            <li key={step.titleKey} data-record-step={index + 1} className="flex flex-col gap-2 px-4 py-4">
              <span className="font-mono text-label text-subtle tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-heading font-semibold text-text">{t(step.titleKey)}</h3>
              <p className="flex-1 text-body text-muted">{t(step.bodyKey)}</p>
              <StepLink step={step} t={t} tc={tc} />
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={t("modules.title")} description={t("modules.description")} flush>
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
                    {!href && <Badge dot={false}>{tc("word.planned")}</Badge>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title={t("safeguards.title")} description={t("safeguards.description")}>
            <ul className="flex flex-col gap-4">
              {SAFEGUARDS.map(({ icon: Icon, titleKey, bodyKey }) => (
                <li key={titleKey} className="flex gap-3">
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-accent"
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className="text-body font-semibold text-text">{t(titleKey)}</p>
                    <p className="text-label text-muted">
                      {t(bodyKey, { minutes: SESSION_IDLE_MS / 60_000 })}
                    </p>
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
