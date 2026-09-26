"""Owner action-item workbook (docs/OWNER_ACTIONS.md).

  python3 scripts/owner_actions.py            # create the workbook if missing
  python3 scripts/owner_actions.py add "<Priority>" "<Category>" "<Action>" "<Why>" "<Needs back>" "<Req/spec>" "<Raised by>" "<Due>"
  python3 scripts/owner_actions.py close OA-001

Requires openpyxl (`pip install openpyxl`). One tab only; never put secrets or PHI here.
"""

import datetime
import pathlib
import sys

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

PATH = pathlib.Path(__file__).resolve().parent.parent / "docs/owner/OWNER_ACTION_ITEMS.xlsx"
SHEET = "Action Items"
HEADERS = [
    ("ID", 9), ("Status", 12), ("Priority", 9), ("Category", 16), ("Action item", 55),
    ("Why it matters", 40), ("What the agent needs back", 40), ("Requirement / spec", 24),
    ("Raised by / date", 20), ("Due / needed by", 16), ("Owner notes / answer", 40), ("Resolved on", 13),
]
TODAY = datetime.date.today().isoformat()
SRC = f"agent {TODAY}"

SEED = [
    ("P0", "Decision", "Rename the default branch to `main` and turn on branch protection.",
     "Required control before more PRs land.", "Confirmation it is done.", "R-7.4.4", "Phase 1"),
    ("P0", "Business", "Set budget, timeline, team, and success targets.",
     "Scopes the roadmap and what 'best in the world' is measured by.", "Filled TODOs in PRODUCT_BRIEF.md.", "docs/PRODUCT_BRIEF.md", "Phase 1"),
    ("P0", "Vendor/Account", "Choose the clearinghouse and open a sandbox account.",
     "Blocks 837P submission and 999/277CA/835 intake (C3, C4).", "Vendor name, companion guides, sandbox access set up by owner.", "specs/claims.md", "Before C3"),
    ("P0", "Legal/Compliance", "Engage healthcare counsel and get the regulatory role memo.",
     "Defines business-associate duties and product limits.", "Memo or counsel contact.", "ROADMAP Phase 0", "Before real data"),
    ("P1", "Data source", "Provide verified payer list with EDI payer IDs and regimes (commercial/HMO/Medicaid/Medicare).",
     "Unverified payers get no computed deadlines and cannot be billed.", "Spreadsheet of payers + source (payer sheet, clearinghouse list).", "specs/payer-catalog.md", "Before C3"),
    ("P1", "Clarification", "Decide which Florida timely-filing exceptions (§ 627.6131(2)) the submission block must honor; confirm Medicare Advantage windows come from contracts.",
     "Filing block logic depends on it.", "Answer, ideally with counsel citation.", "specs/claims.md", "Before C3"),
    ("P1", "Data source", "Provide PIP, workers' comp, and Medicaid filing rules and the HMO timely-filing citation.",
     "Rules engine cannot encode unverified deadlines.", "Citations or source documents.", "specs/claims.md; rules/", "Before C3"),
    ("P1", "Data source", "Decide whether real sample 835 remits/denial letters will ever be used (default: synthetic only); if yes, counsel-approved de-identification and an intake path first.",
     "Improves CARC/RARC classification and appeal drafting quality.", "Decision only. Never commit samples or attach them to this sheet.", "R-3.1", "Phase 1"),
    ("P1", "Decision", "Deposits: accept that the DB owner role can modify deposit rows, or require a guard trigger.",
     "Closes an audit-integrity gap.", "Accept / add trigger.", "threat-models/revenue-cycle-imports.md", "Phase 1"),
    ("P1", "Decision", "Rewrite git history to remove the reference prototype's and competitor names, or leave it.",
     "IP/brand hygiene; rewrite requires a force-push.", "Rewrite / leave.", "PROJECT_STATE open questions", "Before launch"),
    ("P1", "Clarification", "Should front-desk registration be its own role? Guarantor now or with statements?",
     "Shapes patient module P2 permissions and data model.", "Yes/no for each.", "specs/patients.md", "Before P2"),
    ("P1", "Legal/Compliance", "Decide Part 2 consent handling before any SUD-tagged data; confirm address/phone requirements.",
     "Required before sensitive data is stored.", "Decision with counsel input.", "R-3.5.1, R-3.5.2", "Before real data"),
    ("P2", "Legal/Compliance", "Counsel review of look and feel (trade dress) before public launch.",
     "Reduces IP risk on UI chrome kept by ADR 0005.", "Counsel sign-off or change list.", "ADR 0005", "Before launch"),
    ("P2", "Business", "Accountant to confirm net-revenue presentation (write-offs vs. GAAP price concessions) and chart of accounts.",
     "Statements page is labelled 'management view' until then.", "Accountant sign-off.", "Revenue cycle", "Before launch"),
    ("P2", "Decision", "Confirm Azure U.S. regions for production cutover.",
     "Data residency (Fla. Stat. § 408.051(3)).", "Region names.", "ADR 0002", "Before cutover"),
    ("P2", "Design/Brand", "Get a vector (SVG) logo from a designer.",
     "Sharp branding at every size.", "SVG file + license.", "docs/DESIGN.md", "Before launch"),
    ("P2", "Design/Brand", "Confirm license and generating tool for the sign-in reception image.",
     "IP compliance for owner-supplied asset.", "License text / tool name.", "public/brand/README.md", "Before launch"),
    ("P2", "Business", "Line up 3–5 Florida practices for discovery interviews and a pilot.",
     "Real workflows and denial mix make the product best-in-class.", "Pointer to where contacts are kept outside the repo (e.g. CRM); no names here.", "docs/PRODUCT_BRIEF.md", "Phase 2"),
    ("P2", "Vendor/Account", "Decide on licensing for CARC/RARC/CPT code sets (X12, AMA).",
     "Code descriptions shown in-app need proper licenses.", "License decision / accounts.", "R-15.7", "Before launch"),
    ("P3", "Legal/Compliance", "Start SOC 2 Type I readiness (auditor shortlist).",
     "Enterprise buyers will ask for it.", "Auditor choice and target date.", "SOC 2", "Post-launch"),
]


def style(ws):
    for i, (name, width) in enumerate(HEADERS, start=1):
        c = ws.cell(row=1, column=i, value=name)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[c.column_letter].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{ws.cell(row=1, column=len(HEADERS)).column_letter}{max(ws.max_row, 2)}"
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.data_validations.dataValidation.clear()
    for col, opts in (("B", "Open,In progress,Blocked,Done,Dropped"), ("C", "P0,P1,P2,P3"),
                      ("D", "Data source,Clarification,Decision,Legal/Compliance,Vendor/Account,Design/Brand,Business")):
        dv = DataValidation(type="list", formula1=f'"{opts}"', allow_blank=True)
        dv.add(f"{col}2:{col}1000")
        ws.add_data_validation(dv)


def next_id(ws):
    nums = [int(str(r[0].value)[3:]) for r in ws.iter_rows(min_row=2) if str(r[0].value or "").startswith("OA-")]
    return f"OA-{(max(nums) + 1) if nums else 1:03d}"


PRIORITIES = ("P0", "P1", "P2", "P3")
CATEGORIES = ("Data source", "Clarification", "Decision", "Legal/Compliance", "Vendor/Account", "Design/Brand", "Business")


def add(ws, prio, cat, action, why, needs, req, raised, due):
    if prio not in PRIORITIES or cat not in CATEGORIES:
        sys.exit(f"priority must be one of {PRIORITIES}; category one of {CATEGORIES}")
    # Neutralise spreadsheet formula injection.
    action, why, needs, req, raised, due = ("'" + v if v[:1] in "=+-@" else v for v in (action, why, needs, req, raised, due))
    ws.append([next_id(ws), "Open", prio, cat, action, why, needs, req, raised, due, "", ""])


def create():
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET
    style(ws)  # header row first
    for p, cat, a, w, n, r, d in SEED:
        add(ws, p, cat, a, w, n, r, SRC, d)
    style(ws)
    wb.save(PATH)


def main(argv):
    PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PATH.exists():
        create()
        print(f"created {PATH}")
    if len(argv) < 2:
        return
    wb = load_workbook(PATH)
    ws = wb[SHEET]
    if argv[1] == "add" and len(argv) == 10:
        add(ws, *argv[2:])
    elif argv[1] == "close" and len(argv) == 3:
        for r in ws.iter_rows(min_row=2):
            if r[0].value == argv[2]:
                r[1].value, r[11].value = "Done", TODAY
                break
        else:
            sys.exit(f"no row {argv[2]}")
    else:
        sys.exit(__doc__)
    style(ws)
    wb.save(PATH)


if __name__ == "__main__":
    main(sys.argv)
