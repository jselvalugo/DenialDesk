/** Messages for the welcome pages. Flat keys, dotted for grouping; values are the English source text. */
export const welcome = {
  "meta.title": "Welcome",
  heading: "Welcome, {name}",
  intro:
    "DenialDesk follows each claim from submission to payment: it classifies denials, ranks them by value and deadline, and keeps the Florida clocks that decide what can still be recovered.",
  openQueue: "Open denial queue",

  "howItWorks.title": "How DenialDesk works",
  "howItWorks.description": "The path a claim takes through the platform",

  "step1.title": "Record the claim",
  "step1.body":
    "Claims are kept with their service lines, diagnosis and procedure codes, payer, and the filing deadline that applies to them.",
  "step1.link": "Claims",
  "step2.title": "Classify the denial",
  "step2.body":
    "Each denial is read by its CARC and RARC reason codes and grouped into a category that points to the likely fix.",
  "step2.link": "Denials",
  "step3.title": "Work what matters first",
  "step3.body":
    "The queue sorts open denials by appeal deadline or amount at stake, with deadlines computed from versioned Florida and payer rules.",
  "step3.link": "Denial queue",
  "step4.title": "Appeal with approval",
  "step4.body":
    "Appeals are drafted from the denial and the claim record. No procedure or diagnosis code changes without a recorded human approval.",
  "step5.title": "Track the outcome",
  "step5.body":
    "Recoveries, write-offs, and payer response times are reported so the practice can see which payers and reasons cost it most.",

  "recordFlow.title": "From patient record to claim and denial",
  "recordFlow.description": "How the patient record feeds every claim, and where each denial comes back to",

  "record1.title": "Patient record",
  "record1.body":
    "Registration keeps demographics and primary coverage: payer, plan, and member ID (encrypted). Each claim is linked to the patient and the payer billed, so the record behind every claim is one click away.",
  "record1.link": "Patients",
  "record2.title": "Charges become claims",
  "record2.body":
    "Charges from your practice management or EHR system will arrive by CSV file and become draft claims tied to the patient and payer. Direct EHR connections are not planned for launch.",
  "record3.title": "Claim filed and answered",
  "record3.body":
    "Claims will go to the clearinghouse as 837P files; acknowledgments and 835 remittances will come back and be matched to the claim.",
  "record4.title": "Denial back on the chart",
  "record4.body":
    "Each denial is linked to its claim and patient. The patient chart lists every claim and denial, so a coverage or registration error can be found and corrected on the patient record.",
  "record4.link": "Patient charts",

  "modules.title": "Your modules",
  "modules.description": "Also available from the module switcher (Ctrl K)",

  "safeguards.title": "Safeguards",
  "safeguards.description": "Security and compliance controls in place today",

  "safeguard1.title": "Practice data stays separate",
  "safeguard1.body": "Every record is scoped to your practice at the database layer.",
  "safeguard2.title": "Every access is recorded",
  "safeguard2.body": "Reads and changes to patient data are written to an audit trail: who, what, and when.",
  "safeguard3.title": "Deadlines come from cited rules",
  "safeguard3.body":
    "Filing, prompt-pay, and appeal clocks are versioned, effective-dated rules with their statutory source.",
  "safeguard4.title": "People approve coding changes",
  "safeguard4.body": "No procedure or diagnosis code will be changed without a recorded human approval.",
  "safeguard5.title": "Sign-in needs a second factor",
  "safeguard5.body":
    "Every practice account uses an authenticator code, and idle sessions end after {minutes} minutes.",
  "safeguard6.title": "Identifiers are encrypted",
  "safeguard6.body":
    "Member IDs are encrypted field by field, and patient names are kept out of page addresses.",
  "safeguard7.title": "Business Associate Agreements on file",
  "safeguard7.body":
    "Each practice's signed agreement is recorded with its dates and signers; a missing one is flagged.",
} as const;
