import type { Course } from "./content";

/**
 * DenialDesk University courses (docs/specs/denialdesk-university.md). Reviewed like code.
 *
 * Writing rules:
 * - Describe how DenialDesk behaves. Cite a spec in a comment when a statement depends on one.
 * - Never type a statutory deadline, rate, or threshold: use a `rules` block (rules/catalog.ts).
 * - Never retype a CARC meaning: use a `carcs` block (src/domain/carc.ts).
 * - Never quote a payer's policy; say where the value comes from in the product.
 * - Sentence case, plain voice (DESIGN.md §10). No PHI, not even invented names.
 */

const NOT_ADVICE =
  "This lesson describes how DenialDesk behaves. It is not legal or compliance advice: your practice's policies and its privacy and security officers decide how patient data is handled, and Florida healthcare counsel decides what the law requires.";

const RULES_NOTE =
  'Every deadline below is read from DenialDesk\'s rules catalog as of today, with its citation. A rule marked "Pending counsel verification" has not yet been confirmed by Florida healthcare counsel; the product still uses it, and the flag is only cleared by a person.';

export const COURSES: Course[] = [
  {
    id: "getting-started",
    title: "Getting started with DenialDesk",
    description:
      "How the app is laid out, the path a claim takes through it, and where each kind of record lives.",
    audience: "Everyone: new users in any role",
    lessons: [
      {
        id: "finding-your-way",
        title: "Finding your way around",
        summary: "The global header, the module switcher, the tab bar, and the user menu.",
        blocks: [
          {
            kind: "p",
            text: "DenialDesk is organized as modules. A module groups the pages for one kind of work, and the navy bar under the header shows the pages of the module you are in as tabs. You move between modules with the module switcher.",
          },
          {
            kind: "callout",
            title: "Go to a module or page",
            text: 'The "Go to a module or page" field in the header, or Ctrl K (⌘ K on a Mac), opens the switcher. Type part of a module or page name to filter; Escape closes it. The white DenialDesk mark at the left of the navy bar opens the same switcher.',
          },
          {
            kind: "table",
            caption: "Modules and what they hold",
            columns: ["Module", "Pages", "Who sees it"],
            rows: [
              ["Denials", "Overview, Denial queue, Appeals", "Every role"],
              ["Patients", "Patient records and charts", "Every role"],
              ["Claims", "Claims, Remittances, Prompt pay", "Every role"],
              [
                "Revenue cycle",
                "Monthly files, journal vouchers, A/R aging, deposits, rules and ledger, dashboard, statements",
                "Administrators, managers, and compliance",
              ],
              ["Insight", "Standard reports", "Every role (export is limited by role)"],
              [
                "Settings",
                "Practice profile, custom fields",
                "Every signed-in user; changes need an administrator",
              ],
            ],
          },
          {
            kind: "p",
            text: "The switcher is a menu, not access control. Every page checks your role on the server, so a page you cannot use is not listed, and would refuse you if you typed its address.",
          },
          {
            kind: "list",
            items: [
              "The logo in the header always returns to the welcome page.",
              "Your name and role are in the user menu at the right of the header, with the practice you are signed in to, a link to this University, and Sign out.",
              "Page titles are in a serif face; codes and identifiers are in a monospace face so they can be told apart from words.",
            ],
          },
          {
            kind: "callout",
            title: "Welcome page",
            text: "The welcome page lists your modules and the safeguards in place. It is where sign-in lands.",
            href: "/",
            linkLabel: "Open the welcome page",
          },
        ],
      },
      {
        id: "the-claim-path",
        title: "The path a claim takes",
        summary:
          "From claim record to denial, queue, appeal, and outcome; what is shipped and what is planned.",
        blocks: [
          {
            kind: "p",
            text: "DenialDesk follows a claim from the moment it is recorded until the practice is paid or decides to stop pursuing it. Five steps repeat for every claim.",
          },
          {
            kind: "table",
            caption: "The five steps",
            columns: ["Step", "What happens", "Where"],
            rows: [
              [
                "1. Record the claim",
                "The claim is kept with its service lines, diagnosis and procedure codes, payer, and the filing deadline that applies.",
                "Claims",
              ],
              [
                "2. Classify the denial",
                "A denial is read by its CARC and RARC codes and grouped into a category that points to the likely fix.",
                "Denial queue",
              ],
              [
                "3. Work what matters first",
                "Open denials are sorted by appeal deadline and amount at stake.",
                "Denial queue",
              ],
              [
                "4. Appeal",
                "An appeal record tracks the deadline, the submission, and the payer's decision.",
                "Appeals",
              ],
              [
                "5. Track the outcome",
                "Recoveries, write-offs, and payer response times are reported by payer and by reason.",
                "Insight",
              ],
            ],
          },
          {
            kind: "callout",
            title: "Planned, not yet in the product",
            text: "Charge import from your practice management system, 837P claim submission through a clearinghouse, and automatic denial capture from a clearinghouse 835 feed are planned. Today, remittance files are uploaded by hand on the Remittances page, and denials are captured from the adjustments posted from them.",
          },
          {
            kind: "callout",
            title: "Claims",
            text: "The claims list shows each claim's status, payer, amounts, and a timely-filing warning when a filing deadline is near or past.",
            href: "/claims",
            linkLabel: "Open Claims",
          },
        ],
      },
      {
        id: "where-records-live",
        title: "Where records live",
        summary: "Patient, claim, denial, and appeal records, and how they link to each other.",
        blocks: [
          {
            kind: "p",
            text: "Every record in DenialDesk is linked to the records around it, so you can move from a denial to its claim, from the claim to the patient chart, and back.",
          },
          {
            kind: "list",
            items: [
              "A patient record holds demographics and primary coverage (payer, plan, and an encrypted member ID). The chart lists every claim and denial for the patient.",
              "A claim belongs to one patient and one payer. Corrections to a draft or rejected claim need a reason, and every version is kept.",
              "A denial belongs to one claim. It carries the CARC, RARC, and group codes, the category, the appeal deadline and its basis, notes, and an activity trail.",
              "An appeal belongs to one denial. It records the deadline, the submission, and the decision, and it updates the denial's status as it moves.",
            ],
          },
          {
            kind: "callout",
            title: "Page addresses never carry patient data",
            text: "Records are addressed by opaque IDs. Patient searches are sent as a form, not in the address, so a bookmarked or shared link never contains a name, date of birth, or member ID.",
            href: "/patients",
            linkLabel: "Open Patients",
          },
          {
            kind: "p",
            text: "Every view of a patient, claim, or denial record, and every change to one, is written to the audit trail with who, what, and when. That is by design; there is nothing to switch off.",
          },
        ],
      },
    ],
  },
  {
    id: "reading-a-denial",
    title: "Reading a denial",
    description:
      "What the codes on a denial mean, how DenialDesk groups them into categories, and how the queue is worked.",
    audience: "Billers and denial specialists",
    lessons: [
      {
        id: "codes-on-a-denial",
        title: "The codes on a denial",
        summary:
          "Group codes, claim adjustment reason codes (CARC), and remittance advice remark codes (RARC).",
        blocks: [
          {
            kind: "p",
            text: "A payer explains an adjustment or denial with standard codes on the remittance (the 835 file or the paper explanation of payment). DenialDesk shows three kinds.",
          },
          {
            kind: "table",
            caption: "Claim adjustment group codes (X12 835; summaries, not the official text)",
            columns: ["Group code", "Summary"],
            rows: [
              [
                "CO",
                "Contractual obligation: the amount is the provider's responsibility under the contract and cannot be billed to the patient.",
              ],
              [
                "PR",
                "Patient responsibility: the amount may be billed to the patient (deductible, copay, coinsurance).",
              ],
              ["OA", "Other adjustment: neither of the above applies."],
              [
                "PI",
                "Payer-initiated reduction: the payer reduced the payment for a reason that is not a contractual obligation.",
              ],
            ],
          },
          {
            kind: "list",
            items: [
              "A CARC (claim adjustment reason code) is a number that says why the payment differs from the charge. It is the code DenialDesk classifies on.",
              "A RARC (remittance advice remark code) adds detail to a CARC, for example which piece of information was missing. Remark codes start with a letter (M, N, MA).",
              "Both lists are published by X12 and updated several times a year. DenialDesk shows a short summary next to each code; the official wording is in the current X12 release.",
            ],
          },
          {
            kind: "callout",
            title: "Denial detail",
            text: "The denial page shows the CARC with its summary, the group and remark codes, the claim and its lines, the deadline with its basis, and the patient with a masked member ID.",
            href: "/denials",
            linkLabel: "Open the denial queue",
          },
        ],
      },
      {
        id: "denial-categories",
        title: "Denial categories",
        summary: "How DenialDesk turns a reason code into a category that points to the likely fix.",
        blocks: [
          {
            kind: "p",
            text: "Each CARC that DenialDesk knows is mapped to one category. The category is DenialDesk's own work-queue classification, not part of the X12 standard, and it is what the queue filters and the Insight reports group by.",
          },
          {
            kind: "carcs",
            caption: "Common reason codes and their DenialDesk category",
            codes: ["197", "29", "50", "16", "252", "18", "22", "4", "11", "27", "97"],
          },
          {
            kind: "p",
            text: 'A code that DenialDesk does not know goes to the "Other" category so a person can classify it. Categories never change a claim\'s codes: a coding denial is a prompt to review the claim, and any change to a procedure or diagnosis code is made by a person and recorded.',
          },
          {
            kind: "table",
            caption: "What each category usually points to",
            columns: ["Category", "Typical next step"],
            rows: [
              [
                "Eligibility",
                "Check coverage dates and the payer billed; the patient chart shows primary coverage.",
              ],
              ["Authorization", "Find the authorization or notification that should have been on the claim."],
              ["Coding", "Review the procedure, modifier, and diagnosis combination with the coder."],
              ["Medical necessity", "Gather clinical documentation for an appeal."],
              ["Timely filing", "Check the filing date against the deadline shown on the claim."],
              ["Duplicate", "Confirm whether the original claim was paid before resubmitting anything."],
              ["Bundling", "Check whether the service is included in another service on the claim."],
              ["Coordination of benefits", "Confirm which payer is primary and bill in the right order."],
              ["Missing information", "Supply the attachment or field the payer asked for."],
              ["Credentialing", "Check the provider's enrollment with the payer."],
              ["Other", "Classify by hand and add a note explaining the reason."],
            ],
          },
        ],
      },
      {
        id: "working-the-queue",
        title: "Working the queue",
        summary: "Sorting, filters, statuses, assignment, notes, and what the totals mean.",
        blocks: [
          {
            kind: "p",
            text: "The denial queue lists open denials. By default it sorts by appeal deadline, then by amount, so the denial most at risk of missing its deadline is first.",
          },
          {
            kind: "list",
            items: [
              "Filter by status, payer, category, or assignee; sort by deadline, amount, or newest notice. Pages hold 25 denials.",
              "Totals above the list: open denials, amount at risk, due in 7 days, past deadline, and denials with no deadline configured. Deadline counts include only denials still awaiting the practice's action; once an appeal is submitted the deadline has been met.",
              '"Not configured" as a deadline means DenialDesk has no rule or payer setting to compute one from. It never guesses.',
            ],
          },
          {
            kind: "table",
            caption: "Denial statuses",
            columns: ["Status", "Meaning"],
            rows: [
              ["New", "Captured, not yet looked at."],
              ["In review", "Someone is working it."],
              ["Needs records", "Waiting on documentation."],
              ["Appeal drafted", "An appeal record exists and has not been submitted."],
              ["Appeal submitted", "The appeal is with the payer; the deadline has been met."],
              ["Overturned", "Closed: the payer reversed the denial."],
              ["Upheld", "Closed: the payer kept the denial."],
              ["Written off", "Closed: the practice stopped pursuing it."],
              ["Closed", "Closed for another recorded reason."],
            ],
          },
          {
            kind: "callout",
            title: "Actions on a denial",
            text: "Change the status, assign the denial to a team member, or add a note. Each action is recorded in the audit trail with who did it and when. The compliance role can read denials and notes but cannot change them.",
            href: "/denials",
            linkLabel: "Open the denial queue",
          },
          {
            kind: "callout",
            title: "Overview",
            text: "The Overview page shows the same totals for the practice, the next deadlines, and open denials by reason.",
            href: "/overview",
            linkLabel: "Open Overview",
          },
        ],
      },
    ],
  },
  {
    id: "florida-prompt-pay",
    title: "Florida prompt pay",
    description:
      "Which claims the Florida prompt-pay clock covers, the milestones DenialDesk tracks, and how late-payment interest is worked out.",
    audience: "Billers, denial specialists, and managers",
    lessons: [
      {
        id: "which-claims-it-covers",
        title: "Which claims it covers",
        summary: "Regulatory regimes, and why the Florida clock does not run for every payer.",
        blocks: [
          { kind: "notice", text: NOT_ADVICE },
          {
            kind: "p",
            text: "Every payer in DenialDesk carries a regulatory regime: the body of rules that governs how its claims are paid and appealed. The regime decides which clocks DenialDesk runs for a claim.",
          },
          {
            kind: "table",
            caption: "Regimes and the Florida prompt-pay clock",
            columns: ["Regime", "Florida prompt-pay clock in DenialDesk"],
            rows: [
              ["FL commercial (Florida-regulated insurer)", "Runs"],
              [
                "FL HMO (Florida-licensed HMO)",
                "Runs, from its own rule set under the HMO statute; its values are assumed to mirror the insurer rules until counsel confirms them",
              ],
              ["Medicare", "Does not run; Medicare has its own timelines"],
              [
                "Medicare Advantage",
                "Does not run; payment timing follows the plan contract (pending counsel confirmation)",
              ],
              ["Self-funded ERISA", "Does not run; federal law generally preempts the state clock"],
              ["Medicaid, workers' comp, PIP", "Not in the product yet (later phases)"],
            ],
          },
          {
            kind: "callout",
            title: "Unverified payers",
            text: 'A payer whose regime has not been verified shows "Regime not verified" wherever its regime would appear, and no deadline is computed for its claims. Verifying a payer is part of payer setup, planned for the payer catalog\'s next phase.',
          },
          {
            kind: "callout",
            title: "Prompt pay",
            text: "The Prompt pay page lists every claim with a running clock, and each clock record shows its milestones, the payer's responses, and the interest worksheet.",
            href: "/prompt-pay",
            linkLabel: "Open Prompt pay",
          },
        ],
      },
      {
        id: "the-electronic-clock",
        title: "The electronic-claim clock",
        summary:
          "The milestones after a payer receives an electronic claim, and what a contest does to them.",
        blocks: [
          { kind: "notice", text: RULES_NOTE },
          {
            kind: "p",
            text: "The clock starts on the date the payer received the claim. DenialDesk counts calendar days in Eastern time and shows each milestone with its date and the days remaining. Each rule below says which regime it belongs to and what it is counted from.",
          },
          {
            kind: "rules",
            caption: "Electronic claims: payer milestones and the provider's response window",
            ruleIds: [
              "fl.promptpay.electronic.acknowledgment",
              "fl.promptpay.electronic.pay_or_contest",
              "fl.promptpay.electronic.provider_response",
              "fl.promptpay.electronic.pay_or_deny",
              "fl.promptpay.electronic.uncontestable",
              "fl.hmo.promptpay.electronic.acknowledgment",
              "fl.hmo.promptpay.electronic.pay_or_contest",
              "fl.hmo.promptpay.electronic.provider_response",
              "fl.hmo.promptpay.electronic.pay_or_deny",
              "fl.hmo.promptpay.electronic.uncontestable",
            ],
          },
          {
            kind: "list",
            items: [
              "Pay-or-contest is met by the payer's first response of any kind: a payment, a denial, or a contest (a request for more information).",
              "Pay-or-deny and the uncontestable milestone are met only by a payment or a denial. A response on the due date counts as on time.",
              "A contest recorded on or before the pay-or-contest date starts the provider's response window. Contests are recorded by a person on the clock record; DenialDesk does not infer them from codes.",
              "If neither a payment nor a denial arrives by the uncontestable date, DenialDesk flags the claim as an uncontestable obligation. A demand letter for it is planned.",
              "When a milestone's last day falls on a weekend or a Florida legal holiday, the unrolled date governs until counsel confirms that deadlines roll forward to the next business day; the rolled date is shown beside it as informational, pending counsel.",
            ],
          },
          {
            kind: "callout",
            title: "Recording a contest in error",
            text: 'A contest recorded by mistake is marked "recorded in error" with a reason. Nothing on a clock record is deleted.',
          },
        ],
      },
      {
        id: "paper-claims-and-interest",
        title: "Paper claims and late-payment interest",
        summary: "The paper-claim milestones and how the interest worksheet is calculated.",
        blocks: [
          { kind: "notice", text: RULES_NOTE },
          {
            kind: "rules",
            caption: "Paper (non-electronic) claims: payer milestones",
            ruleIds: [
              "fl.promptpay.paper.acknowledgment",
              "fl.promptpay.paper.pay_or_contest",
              "fl.promptpay.paper.pay_or_deny",
              "fl.promptpay.paper.uncontestable",
              "fl.hmo.promptpay.paper.acknowledgment",
              "fl.hmo.promptpay.paper.pay_or_contest",
              "fl.hmo.promptpay.paper.pay_or_deny",
              "fl.hmo.promptpay.paper.uncontestable",
            ],
          },
          {
            kind: "p",
            text: "The rules catalog has no paper-claim value for the provider's response window, so DenialDesk does not show one for paper claims.",
          },
          {
            kind: "rules",
            caption: "Interest on overdue payments",
            ruleIds: ["fl.promptpay.interest_rate", "fl.hmo.promptpay.interest_rate"],
          },
          {
            kind: "list",
            items: [
              "Interest is simple interest per late payment: the late amount, times the annual rate, times the days late, divided by 365, rounded to whole cents.",
              "Interest runs from the first calendar day after the payment due date (the owner's reading, pending counsel confirmation); the worksheet states the assumption it uses.",
              "The rate applied to a payment is the rate in force on that payment's date, so a rate change never rewrites earlier payments.",
            ],
          },
          {
            kind: "callout",
            title: "Interest worksheet",
            text: "Each prompt-pay clock record itemizes the late payments, the days late, and the interest for each, so the practice can document a payer's violation for an Office of Insurance Regulation complaint.",
            href: "/prompt-pay",
            linkLabel: "Open Prompt pay",
          },
        ],
      },
    ],
  },
  {
    id: "appeals-and-deadlines",
    title: "Appeals and deadlines",
    description:
      "Timely filing, appeal deadlines by regime, the appeal record's lifecycle, and the Medicare appeal levels.",
    audience: "Denial specialists and managers",
    lessons: [
      {
        id: "timely-filing",
        title: "Timely filing",
        summary: "How long the practice has to file a claim, and how DenialDesk warns about it.",
        blocks: [
          { kind: "notice", text: RULES_NOTE },
          {
            kind: "rules",
            caption: "Filing windows",
            ruleIds: [
              "fl.timely_filing.initial",
              "fl.timely_filing.secondary",
              "fl.hmo.timely_filing.initial",
              "fl.hmo.timely_filing.secondary",
              "medicare.timely_filing",
            ],
          },
          {
            kind: "list",
            items: [
              "The claims list shows a warning when a claim's filing deadline is near or past. Today this is a warning only; blocking a late submission is planned for clearinghouse submission.",
              "A window counted in months or years ends on the same day of the target month, or on its last day when that month is shorter.",
              "Medicare Advantage filing windows are assumed to come from the plan contract and are not computed by DenialDesk.",
              "A claim billed to an unverified payer gets no filing deadline until the payer's regime is verified.",
            ],
          },
          {
            kind: "callout",
            title: "Claims",
            text: "The filing status is on every claim and in the claims list.",
            href: "/claims",
            linkLabel: "Open Claims",
          },
        ],
      },
      {
        id: "appeal-deadlines",
        title: "Appeal deadlines",
        summary: "Where the deadline on a denial comes from, by regime.",
        blocks: [
          { kind: "notice", text: RULES_NOTE },
          {
            kind: "p",
            text: "DenialDesk computes an appeal deadline from the denial's notice date and the payer's regime. The deadline is shown with its date, the days remaining, and the basis it was computed from.",
          },
          {
            kind: "rules",
            caption: "Medicare first level (redetermination)",
            ruleIds: [
              "medicare.redetermination.receipt_presumption",
              "medicare.redetermination.filing_window",
            ],
          },
          {
            kind: "list",
            items: [
              "Medicare: the notice is presumed received a set number of days after its date, and the filing window runs from that presumed receipt.",
              "FL commercial and FL HMO: the appeal window comes from the payer's contract, entered in the payer's setup as a number of days. Until it is entered, the denial shows \"Not configured\" rather than a guessed date.",
              'When a deadline\'s last day falls on a weekend or holiday, the earlier, unrolled date governs alerts, sorting, and "past deadline" until counsel confirms that deadlines roll forward to the next business day. The rolled date is shown beside it as pending counsel.',
            ],
          },
          {
            kind: "callout",
            title: "Deadlines are always explicit",
            text: 'A deadline shows its date, the days remaining, and the time zone (Eastern). "Due soon" and "overdue" tones come from the practice\'s own reminder window, never from a legal value.',
            href: "/denials",
            linkLabel: "Open the denial queue",
          },
        ],
      },
      {
        id: "the-appeal-record",
        title: "The appeal record",
        summary: "Starting an appeal, recording its submission and decision, and what happens to the denial.",
        blocks: [
          {
            kind: "p",
            text: '"Start appeal" on a denial creates an appeal record with its deadline computed fresh from the rules. A denial can have one open appeal at a time.',
          },
          {
            kind: "table",
            caption: "Appeal statuses, in order",
            columns: ["Status", "Meaning"],
            rows: [
              ["Draft", "Created; the letter and attachments are being prepared."],
              ["In review", "Someone is checking the draft."],
              ["Ready", "Approved to send."],
              ["Submitted", "Sent to the payer; the method, date, and tracking reference are recorded."],
              ["Awaiting decision", "The payer has acknowledged it and is deciding."],
              ["Decided", "The outcome, decision date, recovered amount, and close reason are recorded."],
              ["Withdrawn or dismissed", "Left the process from Submitted or Awaiting decision."],
            ],
          },
          {
            kind: "list",
            items: [
              "The status can only move forward through this order; the database refuses any other change.",
              "Recording a submission after the deadline is allowed and flagged, so a late filing is visible rather than hidden.",
              "The linked denial's status follows the appeal: Appeal drafted, Appeal submitted, then Overturned or Upheld.",
              "A practice-configurable follow-up reminder is set when an appeal is submitted; it is a reminder, not a legal date.",
            ],
          },
          {
            kind: "callout",
            title: "Appeals work list",
            text: "The Appeals page lists appeals by level, payer, and status, sorted by deadline or amount, with a totals row.",
            href: "/appeals",
            linkLabel: "Open Appeals",
          },
          {
            kind: "callout",
            title: "Planned",
            text: "Appeal letter templates with merge fields (a person reviews before export), escalation through the Medicare levels, and attachment storage are planned.",
          },
        ],
      },
      {
        id: "medicare-levels",
        title: "The Medicare appeal levels",
        summary: "The five levels and the window for each, as DenialDesk records them.",
        blocks: [
          { kind: "notice", text: RULES_NOTE },
          {
            kind: "p",
            text: "A Medicare Part B denial can be appealed through up to five levels. Each level's window runs from receipt of the previous level's decision, and receipt is presumed a set number of days after the notice date.",
          },
          {
            kind: "rules",
            caption: "Levels two to five",
            ruleIds: [
              "medicare.appeals.receipt_presumption",
              "medicare.reconsideration.filing_window",
              "medicare.alj_hearing.filing_window",
              "medicare.council_review.filing_window",
              "medicare.judicial_review.filing_window",
            ],
          },
          {
            kind: "list",
            items: [
              'Level one, redetermination, is in the "Appeal deadlines" lesson.',
              "Levels three and five have a minimum amount in controversy that changes each year. Those amounts are not yet in DenialDesk's rules catalog, so DenialDesk does not check them; confirm the current threshold before filing.",
              "Escalating an appeal record to the next level is planned; today each level is recorded as its own appeal.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "protecting-patient-data",
    title: "Protecting patient data in DenialDesk",
    description:
      "What each role can do, how identifiers are masked and reveals recorded, and how sessions and sign-in protect the practice.",
    audience: "Everyone: required reading for anyone who opens a patient, claim, or denial",
    lessons: [
      {
        id: "roles-and-minimum-necessary",
        title: "Roles and minimum necessary",
        summary: "The four roles and what each can see and change.",
        blocks: [
          { kind: "notice", text: NOT_ADVICE },
          {
            kind: "p",
            text: "DenialDesk gives each user one role in the practice. Roles are designed around the least access needed to do the job: people who bill can change records; compliance reviews them.",
          },
          {
            kind: "table",
            caption: "What each role can do",
            columns: ["Role", "Can do", "Cannot do"],
            rows: [
              [
                "Administrator",
                "Everything below, plus practice settings, custom fields, sensitivity tags, and revenue-cycle configuration.",
                "Create the practice or its Business Associate Agreement (the platform operator does that).",
              ],
              [
                "RCM manager",
                "Work denials, appeals, claims, patients, and remittances; run month-end in Revenue cycle; export Insight reports.",
                "Change practice settings or sensitivity tags.",
              ],
              [
                "Denial specialist",
                "Work denials, appeals, claims, patients, and remittances; view Insight reports.",
                "Open Revenue cycle; export Insight reports; change settings.",
              ],
              [
                "Compliance",
                "Read denials, appeals, claims, and patients; view Revenue cycle; view and export Insight reports.",
                "Change any denial, appeal, claim, or patient record.",
              ],
            ],
          },
          {
            kind: "callout",
            title: "Your account",
            text: "Settings shows the role you are signed in with and whether you can change settings.",
            href: "/settings",
            linkLabel: "Open Settings",
          },
          {
            kind: "p",
            text: "Roles are assigned by the practice; DenialDesk does not change a role on its own. If you can see something your job does not need, tell your administrator.",
          },
        ],
      },
      {
        id: "masked-identifiers-and-the-audit-trail",
        title: "Masked identifiers and the audit trail",
        summary: "Why member IDs are hidden, what a reveal records, and what the audit trail holds.",
        blocks: [
          { kind: "notice", text: NOT_ADVICE },
          {
            kind: "list",
            items: [
              "Member IDs are encrypted in the database and shown masked, with only the last digits visible.",
              "Revealing a member ID asks for a reason and writes an audit event with your name, the record, the reason, and the time. Reveal only when the work needs the full number.",
              "Every view of a queue, list, or record, and every change, is audited. The audit trail is append-only; nothing in it can be edited or removed from the product.",
              "Patient names never appear in page addresses, browser titles, or notifications, so sharing a link inside the practice shares only an opaque ID.",
            ],
          },
          {
            kind: "callout",
            title: "Notes are part of the record",
            text: "A note on a denial or appeal is stored with the record and audited like any other change. Write only what the work needs, and keep anything outside DenialDesk (email, chat, paper) to your practice's policy.",
          },
          {
            kind: "callout",
            title: "Insight reports are aggregate only",
            text: "Standard reports show counts and amounts by payer, category, and status, never a patient or claim list. Small groups tied to sensitivity-tagged patients are suppressed on screen and in exports.",
            href: "/insight",
            linkLabel: "Open Insight",
          },
        ],
      },
      {
        id: "sessions-and-sign-in",
        title: "Sessions and sign-in",
        summary:
          "Two-step sign-in, idle timeouts, shared workstations, and what to do if something looks wrong.",
        blocks: [
          { kind: "notice", text: NOT_ADVICE },
          {
            kind: "list",
            items: [
              "Every practice account signs in with a password and a six-digit code from an authenticator app. There is no way to skip the second step.",
              "An idle session shows a warning after 13 minutes and ends after 15. Signing back in returns you to the welcome page.",
              "Repeated wrong passwords lock the account for a period; an administrator can help, and the attempts are recorded.",
              "On a shared workstation, use Sign out in the user menu when you step away; do not rely on the timeout.",
            ],
          },
          {
            kind: "callout",
            title: "If something looks wrong",
            text: "A record you did not expect to see, a sign-in you did not make, or a colleague using someone else's account: report it to your practice's privacy or security officer the same day, following your practice's incident procedure. DenialDesk's audit trail lets them see exactly what was accessed.",
          },
          {
            kind: "callout",
            title: "Pre-production environments use synthetic data only",
            text: 'A preview or test copy of DenialDesk shows a "Synthetic data only" banner and must never receive real patient data. Real records go only into the production practice.',
          },
        ],
      },
    ],
  },
];

export function findCourse(courseId: string): Course | undefined {
  return COURSES.find((course) => course.id === courseId);
}

export function findLesson(courseId: string, lessonId: string) {
  const course = findCourse(courseId);
  if (!course) return undefined;
  const index = course.lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index < 0) return undefined;
  return {
    course,
    lesson: course.lessons[index]!,
    previous: course.lessons[index - 1] ?? null,
    next: course.lessons[index + 1] ?? null,
  };
}
