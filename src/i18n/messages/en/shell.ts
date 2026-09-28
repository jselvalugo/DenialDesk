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

  // Data-source drop-down beside a synced table's tab (specs/erp-shell.md)
  "dataSource.source": "Source:",
  "dataSource.table.patients": "Patients",
  // The accessible name must contain the button's visible text ("Source: …") in every language
  // (WCAG 2.5.3 label in name; data-source.test.ts checks it).
  "dataSource.ariaLabel": "{table} data source: {state}",
  "dataSource.ariaState": "{name}, {state}",
  "dataSource.state.manual": "Manual",
  "dataSource.state.synced": "Synced {when}",
  "dataSource.state.notSynced": "Not synced yet",
  "dataSource.state.running": "Sync running",
  "dataSource.state.awaitingApproval": "Awaiting approval",
  "dataSource.state.paused": "Paused",
  "dataSource.state.needsAttention": "Needs attention",
  "dataSource.state.revoked": "Revoked",
  "dataSource.panel.title": "Data source",
  "dataSource.panel.manual": "Staff register patients by hand in DenialDesk.",
  "dataSource.panel.connected": "Patients sync read-only from {name}.",
  "dataSource.panel.revoked":
    "The connection to {name} was revoked. Staff register new patients by hand; patients already synced can't be edited here for now.",
  "dataSource.panel.status": "Status",
  "dataSource.panel.lastSync": "Last successful sync",
  "dataSource.panel.never": "Never",
  "dataSource.panel.lastRun": "Last sync run",
  "dataSource.run.none": "No runs yet",
  "dataSource.run.queued": "Queued",
  "dataSource.run.running": "Running",
  "dataSource.run.succeeded": "Succeeded",
  "dataSource.run.failed": "Failed",
  "dataSource.run.abandoned": "Abandoned",
  "dataSource.action.connect": "Connect an integration…",
  "dataSource.action.settings": "Connection settings",
} as const;
