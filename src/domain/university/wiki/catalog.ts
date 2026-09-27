import { appealsInDenialDesk } from "./articles/appeals-in-denialdesk";
import { dataSafetyInDenialDesk } from "./articles/data-safety-in-denialdesk";
import { floridaPromptPayClock } from "./articles/florida-prompt-pay-clock";
import { glossary } from "./articles/glossary";
import { howAClaimBecomesADenial } from "./articles/how-a-claim-becomes-a-denial";
import { overpaymentsAndRefunds } from "./articles/overpayments-and-refunds";
import { readingADenial } from "./articles/reading-a-denial";
import { remittancesAndPosting } from "./articles/remittances-and-posting";
import { rolesAndPermissions } from "./articles/roles-and-permissions";
import { timelyFilingWindows } from "./articles/timely-filing-windows";
import { welcomeToDenialDesk } from "./articles/welcome-to-denialdesk";
import { workingTheDenialQueue } from "./articles/working-the-denial-queue";
import type { WikiArticle, WikiCategory, WikiCategoryId } from "./types";

/** Categories in the order the index shows them. */
export const WIKI_CATEGORIES: WikiCategory[] = [
  {
    id: "getting-started",
    label: "Getting started",
    description: "What DenialDesk is and how its parts fit together.",
  },
  {
    id: "denials-and-appeals",
    label: "Denials and appeals",
    description: "Reading, working, and appealing a denial.",
  },
  {
    id: "claims-and-payments",
    label: "Claims and payments",
    description: "Claims, remittances, and posting.",
  },
  {
    id: "florida-and-medicare-rules",
    label: "Florida and Medicare rules",
    description: "The legal clocks DenialDesk tracks, with values read live from the rules engine.",
  },
  { id: "data-safety", label: "Data safety", description: "Safeguards every user should know." },
  { id: "glossary", label: "Glossary", description: "Terms and file names." },
];

/** Every article, in index order within its category. Adding an article means adding it here. */
export const WIKI_ARTICLES: WikiArticle[] = [
  welcomeToDenialDesk,
  howAClaimBecomesADenial,
  rolesAndPermissions,
  readingADenial,
  workingTheDenialQueue,
  appealsInDenialDesk,
  remittancesAndPosting,
  floridaPromptPayClock,
  timelyFilingWindows,
  overpaymentsAndRefunds,
  dataSafetyInDenialDesk,
  glossary,
];

export function findArticle(slug: string): WikiArticle | null {
  return WIKI_ARTICLES.find((article) => article.slug === slug) ?? null;
}

export function findCategory(id: WikiCategoryId): WikiCategory {
  return WIKI_CATEGORIES.find((category) => category.id === id)!;
}

export function articlesInCategory(
  id: WikiCategoryId,
  articles: WikiArticle[] = WIKI_ARTICLES,
): WikiArticle[] {
  return articles.filter((article) => article.category === id);
}
