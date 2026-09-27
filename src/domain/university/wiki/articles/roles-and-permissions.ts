import type { WikiArticle } from "../types";

export const rolesAndPermissions: WikiArticle = {
  slug: "roles-and-permissions",
  title: "Roles and what each can do",
  summary: "The four practice roles in DenialDesk and which actions each one is allowed to take.",
  category: "getting-started",
  tags: ["roles", "permissions", "administrator", "manager", "specialist", "compliance", "access"],
  reviewedOn: "2026-09-27",
  sources: [{ label: "Requirements baseline R-5.1.2, minimum necessary (internal)" }],
  related: ["welcome-to-denialdesk", "data-safety-in-denialdesk"],
  body: `
Access follows the minimum-necessary principle: each role can do what its job needs and no more.
Every page checks the role on the server, so the menus are a convenience, not the control.

| Action | Administrator | Manager | Billing specialist | Compliance |
| --- | --- | --- | --- | --- |
| Work denials and appeals (status, assign, notes) | Yes | Yes | Yes | View only |
| Register and edit patients | Yes | Yes | Yes | View only |
| Correct draft or rejected claims | Yes | Yes | Yes | View only |
| Load and post remittances | Yes | Yes | Yes | View only |
| Void a remittance loaded in error | Yes | Yes | No | No |
| Record payer contests on a prompt-pay clock | Yes | Yes | Yes | View only |
| Open the Revenue cycle module | Yes | Yes | No | Yes |
| Import monthly files and prepare vouchers | Yes | Yes | No | No |
| Change accounting rules and accounts | Yes | No | No | No |
| View Insight reports | Yes | Yes | Yes | Yes |
| Export an Insight report to Excel | Yes | Yes | No | Yes |
| Define custom fields and change settings | Yes | No | No | No |
| Set a patient's sensitivity tags | Yes | No | No | No |
| Read this wiki | Yes | Yes | Yes | Yes |

## Notes

- **Compliance** reviews; it never changes a claim, denial, or patient. That keeps review
  independent of the work it reviews.
- **Exports** leave the audited system as a file, so they are limited to roles above the front-line
  specialist.
- Roles are assigned when a user is created. A user-management page for administrators is planned.
`,
};
