# src/jobs

Background job functions (imports, X12 exchange, deadline alerts, PDF generation). Plain async functions; platform runners in `src/platform/*` invoke them. Nothing slow runs inside a web request (ADR 0001).
