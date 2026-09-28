/** App chrome: header, tab bar, module switcher, user menu, session timeout, environment banner. */
export const shell = {
  skipToContent: "Skip to content",
  "brand.home": "DenialDesk home",
  "meta.description": "Claims and denial management for Florida physician practices.",
  "header.goTo": "Go to a module or page",
  "header.practice": "Practice",
  "header.styleGuide": "Style guide",
  "tabBar.switchModule": "{module}, switch module",
  "tabBar.switchModuleTitle": "{module} · switch module",
  "nav.primary": "Primary",

  // Module switcher
  "switcher.title": "Go to",
  "switcher.searchLabel": "Search modules and pages",
  "switcher.placeholder": "Go to a module or page…",
  "switcher.close": "Close",
  "switcher.columnModule": "Module",
  "switcher.columnPages": "Pages",
  "switcher.noMatch": "Nothing matches “{query}”. Try a module or page name, like “{example}”.",
  "switcher.moduleLink": "{module} module",
  "switcher.count":
    "{modules, plural, one {# module} other {# modules}} · {pages, plural, one {# page} other {# pages}}",
  "switcher.hintMove": "move",
  "switcher.hintOpen": "open",
  "switcher.hintClose": "close",

  // Modules and pages (components/shell/navigation.ts)
  "module.denials": "Denials",
  "module.denials.description": "Open denials, appeal deadlines, and the work queue.",
  "module.patients": "Patients",
  "module.patients.description": "Patient records: demographics, insurance, and every claim and denial.",
  "module.claims": "Claims",
  "module.claims.description": "Claims, corrections, remittances, and prompt-pay tracking.",
  "module.revenueCycle": "Revenue cycle",
  "module.revenueCycle.description": "Monthly files, journal vouchers, A/R aging, deposits, and the ledger.",
  "module.insight": "Insight",
  "module.insight.description": "Reports on denial trends, recovery, and payer performance.",
  "module.settings": "Settings",
  "module.settings.description": "Practice profile, custom fields, and access.",
  "page.overview": "Overview",
  "page.denialQueue": "Denial queue",
  "page.appeals": "Appeals",
  "page.patients": "Patients",
  "page.claims": "Claims",
  "page.remittances": "Remittances",
  "page.promptPay": "Prompt pay",
  "page.monthlyFiles": "Monthly files",
  "page.journalVouchers": "Journal vouchers",
  "page.arAging": "A/R aging",
  "page.deposits": "Deposits",
  "page.rulesAndLedger": "Rules and ledger",
  "page.rcmDashboard": "RCM dashboard",
  "page.statements": "Statements",
  "page.reports": "Reports",
  "page.settings": "Settings",

  // User menu
  "userMenu.practice": "Practice",
  "userMenu.language": "Language",
  "userMenu.university": "DenialDesk University",
  "userMenu.signOut": "Sign out",

  // Session timeout dialog
  "timeout.title": "Your session is about to end",
  "timeout.body":
    "For security, you'll be signed out after {minutes} minutes without activity. Time remaining:",
  "timeout.signOut": "Sign out",
  "timeout.stay": "Stay signed in",

  // Environment banner (outside production)
  "preview.label": "Environment notice",
  "preview.body": "Synthetic data only. Do not enter real patient information.",

  // Operator console chrome
  "operator.console": "Platform console",
  "operator.badge": "Operator",

  // Patients data-source drop-down (docs/specs/erp-shell.md, docs/specs/patient-integrations.md
  // "PI1b"): the menu button in the navy tab bar, right after the Patients tab.
  "dataSource.accessibleName": "Patients data source: {state}",
  "dataSource.manual": "Source: Manual",
  "dataSource.label": "Source: {name} · {state}",
  "dataSource.state.manual": "Manual",
  "dataSource.state.awaitingApproval": "Awaiting approval",
  "dataSource.state.active": "Synced {relative}",
  "dataSource.state.neverSynced": "Not yet synced",
  "dataSource.state.paused": "Paused",
  "dataSource.state.error": "Needs attention",
  "dataSource.state.revoked": "Revoked",
  "dataSource.menu.currentState": "Current state",
  "dataSource.menu.lastSuccessfulSync": "Last successful sync",
  "dataSource.menu.connectIntegration": "Connect an integration…",
  "dataSource.menu.manageConnection": "Manage connection",
  "dataSource.menu.pauseSync": "Pause sync",
  "dataSource.menu.resumeSync": "Resume sync",
  "dataSource.menu.syncHistory": "Sync history",
  "dataSource.relative.justNow": "just now",
  "dataSource.relative.minutesAgo": "{count, plural, one {# minute ago} other {# minutes ago}}",
  "dataSource.relative.hoursAgo": "{count, plural, one {# hour ago} other {# hours ago}}",
  "dataSource.relative.daysAgo": "{count, plural, one {# day ago} other {# days ago}}",
} as const;
