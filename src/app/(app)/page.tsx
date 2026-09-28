import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Gavel,
  KeyRound,
  ListOrdered,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import { todayIn } from "@rules/calendar";
import { canViewRevenueCycle } from "@/auth/permissions";
import { SESSION_IDLE_MS } from "@/auth/policy";
import { requireAuth } from "@/auth/session";
import { FlowSteps, type FlowStep } from "@/components/home/FlowSteps";
import { appHome, navApps, type NavApp } from "@/components/shell/navigation";
import { toneClasses } from "@/components/shell/tones";
import { Badge } from "@/components/ui/Badge";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { DUE_SOON_DAYS, queueSummary } from "@/domain/denials/queries";
import { getFormat, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("welcome");
  return { title: t("meta.title") };
}

interface Step {
  titleKey: MessageKey<"welcome">;
  bodyKey: MessageKey<"welcome">;
  icon: LucideIcon;
  /** The module the step happens in (DESIGN.md §4 tile colors). */
  tone: NavApp["tone"];
  /** Null until the step ships: shown as "Planned", never a link. */
  href: string | null;
  linkKey?: MessageKey<"welcome">;
}

const STEPS: Step[] = [
  {
    titleKey: "step1.title",
    bodyKey: "step1.body",
    icon: FileText,
    tone: "blue",
    href: "/claims",
    linkKey: "step1.link",
  },
  {
    titleKey: "step2.title",
    bodyKey: "step2.body",
    icon: Tags,
    tone: "teal",
    href: "/denials",
    linkKey: "step2.link",
  },
  {
    titleKey: "step3.title",
    bodyKey: "step3.body",
    icon: ListOrdered,
    tone: "teal",
    href: "/denials",
    linkKey: "step3.link",
  },
  { titleKey: "step4.title", bodyKey: "step4.body", icon: Gavel, tone: "teal", href: null },
  { titleKey: "step5.title", bodyKey: "step5.body", icon: BarChart3, tone: "amber", href: null },
];

/** How the patient record feeds claims and denials. Same shipped/planned rule as STEPS. */
const RECORD_FLOW: Step[] = [
  {
    titleKey: "record1.title",
    bodyKey: "record1.body",
    icon: Users,
    tone: "slate",
    href: "/patients",
    linkKey: "record1.link",
  },
  { titleKey: "record2.title", bodyKey: "record2.body", icon: FileSpreadsheet, tone: "blue", href: null },
  { titleKey: "record3.title", bodyKey: "record3.body", icon: ArrowLeftRight, tone: "blue", href: null },
  {
    titleKey: "record4.title",
    bodyKey: "record4.body",
    icon: ClipboardList,
    tone: "slate",
    href: "/patients",
    linkKey: "record4.link",
  },
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

function toFlow(steps: Step[], t: WelcomeT): FlowStep[] {
  return steps.map((step) => ({
    id: step.titleKey,
    icon: step.icon,
    tone: step.tone,
    title: t(step.titleKey),
    body: t(step.bodyKey),
    href: step.href,
    linkLabel: step.linkKey && t(step.linkKey),
  }));
}

/** "3 of 5 steps available": counted from the step list, so it moves as steps ship. */
function shippedCount(steps: Step[], t: WelcomeT) {
  return (
    <span className="text-label whitespace-nowrap text-subtle">
      {t("flow.available", { shipped: steps.filter((step) => step.href).length, total: steps.length })}
    </span>
  );
}

/** One live figure in the header strip; the whole cell links to where the number can be worked. */
function Figure({
  href,
  label,
  value,
  detail,
  emphasis,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
  emphasis?: "danger" | "warning";
}) {
  return (
    <li className="group relative bg-surface px-5 py-3.5 transition-colors duration-150 ease-out hover:bg-surface-muted motion-reduce:transition-none">
      <Link
        href={href}
        className="text-label font-semibold tracking-wider text-muted uppercase after:absolute after:inset-0"
      >
        {label}
      </Link>
      <p
        className={cn(
          "mt-1 flex items-center gap-1 font-mono text-[1.5rem] leading-8 font-bold tabular-nums",
          emphasis === "danger"
            ? "text-danger-fg"
            : emphasis === "warning"
              ? "text-warning-fg"
              : "text-primary",
        )}
      >
        {value}
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-subtle opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 motion-reduce:transition-none"
          strokeWidth={2}
        />
      </p>
      <p className="text-label text-muted">{detail}</p>
    </li>
  );
}

/** Home: where sign-in and the logo land: a plain-language map of the platform and a way into each module. */
export default async function HomePage() {
  const auth = await requireAuth();
  const t = await getT("welcome");
  const tc = await getT("common");
  const td = await getT("denials");
  const tShell = await getT("shell");
  const f = await getFormat();
  const today = todayIn();
  const firstName = auth.displayName.trim().split(/\s+/)[0] || auth.displayName;
  const apps = navApps(
    {
      showRevenueCycle: canViewRevenueCycle(auth.role),
      showSettings: true,
    },
    tShell,
  );
  // Practice-wide totals only (counts and sums, no claim, patient, or payer rows): not a PHI read.
  const summary = await withTenant(auth, (tx) => queueSummary(tx, today));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="rounded-panel border border-border bg-surface shadow-xs">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <p className="text-label font-semibold tracking-wider text-muted uppercase">
              {auth.tenantName} · {f.date(today)}
            </p>
            <h1 className="mt-0.5 font-serif text-display font-bold text-primary">
              {t("heading", { name: firstName })}
            </h1>
            <p className="mt-1 max-w-3xl text-body text-muted">{t("intro")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/university"
              title="University of DenialDesk"
              className="inline-flex h-9 items-center rounded-control border border-border px-2 transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-muted motion-reduce:transition-none"
            >
              <Image
                src="/brand/university-of-denialdesk.png"
                alt="University of DenialDesk"
                width={125}
                height={29}
              />
            </Link>
            <Link
              href="/university/wiki"
              title="DenialDesk Wiki"
              className="inline-flex h-9 items-center rounded-control border border-border px-2 transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-muted motion-reduce:transition-none"
            >
              <Image src="/brand/denialdesk-wiki.png" alt="DenialDesk Wiki" width={100} height={30} />
            </Link>
            <Link href="/denials" className={cn(primaryLinkButtonClass, "h-9")}>
              {t("openQueue")}
            </Link>
          </div>
        </div>
        <section
          aria-label={t("today.ariaLabel")}
          className="overflow-hidden rounded-b-panel border-t border-border"
        >
          <ul className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            <Figure
              href="/overview"
              label={td("stat.openDenials")}
              value={f.number(summary.open)}
              detail={t("today.openDetail")}
            />
            <Figure
              href="/denials?sort=amount"
              label={td("stat.amountAtRisk")}
              value={formatCents(summary.atRiskCents)}
              detail={td("stat.amountAtRiskDetail")}
            />
            <Figure
              href="/denials"
              label={td("stat.dueInDays", { count: DUE_SOON_DAYS })}
              value={f.number(summary.dueSoon)}
              detail={td("stat.dueSoonDetail")}
              emphasis={summary.dueSoon > 0 ? "warning" : undefined}
            />
            <Figure
              href="/denials"
              label={td("stat.pastDeadline")}
              value={f.number(summary.overdue)}
              detail={td("stat.pastDeadlineDetailDefault")}
              emphasis={summary.overdue > 0 ? "danger" : undefined}
            />
          </ul>
        </section>
      </header>

      <Panel
        title={t("howItWorks.title")}
        description={t("howItWorks.description")}
        actions={shippedCount(STEPS, t)}
        flush
      >
        <FlowSteps steps={toFlow(STEPS, t)} dataAttribute="data-step" plannedLabel={tc("word.planned")} />
      </Panel>

      <Panel
        title={t("recordFlow.title")}
        description={t("recordFlow.description")}
        actions={shippedCount(RECORD_FLOW, t)}
        flush
      >
        <FlowSteps
          steps={toFlow(RECORD_FLOW, t)}
          dataAttribute="data-record-step"
          plannedLabel={tc("word.planned")}
        />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={t("modules.title")} description={t("modules.description")}>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {apps.map((app) => {
                const href = appHome(app);
                const pages = app.items.filter((item) => item.available);
                return (
                  <li
                    key={app.id}
                    className={cn(
                      "group relative flex gap-3 rounded-control border border-border p-3",
                      href &&
                        "transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-muted motion-reduce:transition-none",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-control border",
                        toneClasses[app.tone],
                      )}
                    >
                      <app.icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        {href ? (
                          <Link
                            href={href}
                            className="text-body font-semibold text-text group-hover:text-link after:absolute after:inset-0"
                          >
                            {app.label}
                          </Link>
                        ) : (
                          <span className="text-body font-semibold text-text">{app.label}</span>
                        )}
                        {href ? (
                          <span className="text-label whitespace-nowrap text-subtle">
                            {t("modules.pages", { count: pages.length })}
                          </span>
                        ) : (
                          <Badge dot={false}>{tc("word.planned")}</Badge>
                        )}
                      </div>
                      <p className="text-label text-muted">{app.description}</p>
                      {pages.length > 1 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {pages.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className="relative z-10 inline-flex h-6 items-center rounded-control border border-border bg-surface px-1.5 text-label text-muted transition-colors duration-150 ease-out hover:border-border-strong hover:text-link motion-reduce:transition-none"
                              >
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-control border",
                      toneClasses.teal,
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
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
