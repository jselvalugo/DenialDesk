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

/** Categories in the order the index shows them. Labels/descriptions: message keys, `university` namespace. */
export const WIKI_CATEGORIES: WikiCategory[] = [
  {
    id: "getting-started",
    labelKey: "wikiCategory.gettingStarted.label",
    descriptionKey: "wikiCategory.gettingStarted.description",
  },
  {
    id: "denials-and-appeals",
    labelKey: "wikiCategory.denialsAndAppeals.label",
    descriptionKey: "wikiCategory.denialsAndAppeals.description",
  },
  {
    id: "claims-and-payments",
    labelKey: "wikiCategory.claimsAndPayments.label",
    descriptionKey: "wikiCategory.claimsAndPayments.description",
  },
  {
    id: "florida-and-medicare-rules",
    labelKey: "wikiCategory.floridaAndMedicareRules.label",
    descriptionKey: "wikiCategory.floridaAndMedicareRules.description",
  },
  {
    id: "data-safety",
    labelKey: "wikiCategory.dataSafety.label",
    descriptionKey: "wikiCategory.dataSafety.description",
  },
  {
    id: "glossary",
    labelKey: "wikiCategory.glossary.label",
    descriptionKey: "wikiCategory.glossary.description",
  },
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
