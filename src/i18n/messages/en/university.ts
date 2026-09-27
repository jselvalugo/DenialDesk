/**
 * DenialDesk University: course catalog, lesson pages, and the Wiki (docs/specs/denialdesk-university.md,
 * docs/specs/university-wiki.md). Course titles, lesson titles/bodies, and wiki article titles/bodies are
 * authored content and are NOT translated (they come from src/domain/university/catalog.ts and
 * src/domain/university/wiki/articles/*.ts as English, per that spec). This namespace covers the chrome
 * around that content: headings, navigation, badges, table headers, forms, and search.
 */
export const university = {
  eyebrow: "DenialDesk University",
  "nav.breadcrumb": "Breadcrumb",
  "nav.lesson": "Lesson navigation",
  "breadcrumb.university": "University",

  // Course catalog (/university)
  "catalog.title": "Courses",
  "catalog.description":
    "Short courses on how DenialDesk works, how to read a denial, the Florida clocks the product enforces, and how patient data is protected. Your completions are kept for your account.",
  "catalog.openWiki": "Open the Wiki",
  "catalog.lessonsCompleted": "{done} of {total} lessons completed",
  "catalog.audience": "For: {audience}",
  "catalog.lessonsLabel": "Lessons",
  "catalog.readingLabel": "Reading",
  "catalog.readingMinutes": "{count} min",
  "catalog.progressLabel": "Progress",
  "catalog.openCourse": "Open course",
  "catalog.openCourseAria": "Open course: {title}",
  "catalog.disclaimer":
    "Courses describe how DenialDesk behaves and are not legal or compliance advice. Deadlines shown in a lesson are read from the same versioned rules the product uses, with their citations.",

  // Progress wording (domain/university/content.ts progressLabel)
  "progress.complete": "Complete",
  "progress.notStarted": "Not started",
  "progress.ofLessons": "{completed} of {total} lessons",

  // Course page (/university/[courseId])
  "course.startCourse": "Start course",
  "course.continueCourse": "Continue course",
  "course.complete": "Course complete",
  "course.lessonsDescription": "For: {audience} · {minutes} min reading · {progress}",
  "course.completedOn": "Completed {date}",
  "course.openLesson": "Open",
  "course.openLessonAria": "Open lesson: {title}",

  // Lesson page (/university/[courseId]/[lessonId])
  "lesson.eyebrow": "{course} · Lesson {position} of {total}",
  "lesson.progressTitle": "Your progress",
  "lesson.progressDescription": "Completions are kept for your account and can't be undone.",
  "lesson.previous": "Previous: {title}",
  "lesson.next": "Next: {title}",
  "lesson.backToCourse": "Back to the course",

  // CompleteLessonForm.tsx / actions.ts
  "complete.completed": "Lesson completed {date}",
  "complete.action": "Mark lesson complete",
  "complete.lessonGone": "This lesson no longer exists.",

  // LessonBody.tsx block chrome
  "lessonBody.inDenialDesk": "In DenialDesk",
  "lessonBody.rule": "Rule",
  "lessonBody.appliesTo": "Applies to",
  "lessonBody.countedFrom": "Counted from",
  "lessonBody.value": "Value",
  "lessonBody.source": "Source",
  "lessonBody.noVersion": "No version of this rule is in force today.",
  "lessonBody.referenceOnly": "Reference only",
  "lessonBody.confirmedByCounsel": "Confirmed by counsel {date}",
  "lessonBody.pendingCounselVerification": "Pending counsel verification",
  "lessonBody.code": "Code",
  "lessonBody.summary": "Summary",
  "lessonBody.category": "DenialDesk category",
  "lessonBody.carcFootnote":
    "Summaries, not the official X12 wording; categories are DenialDesk’s own classification.",
  "lessonBody.groupCode": "Group code",
  "lessonBody.groupCodeFootnote": "Summaries of the X12 835 group codes, not the official wording.",

  // Wiki index (/university/wiki)
  "wiki.eyebrow": "DenialDesk University · Wiki",
  "wiki.metaTitle": "University — Wiki",
  "wiki.title": "Wiki",
  "wiki.description":
    "Reference articles on how denials, claims, appeals, and Florida payment rules work in DenialDesk. Legal values are read from the rules engine, never typed in.",
  "wiki.categoriesAria": "Categories",
  "wiki.emptyCategoryTitle": "No articles yet",
  "wiki.emptyCategoryDescription": "Articles for this category are still being written.",

  // Wiki categories (domain/university/wiki/catalog.ts WIKI_CATEGORIES)
  "wikiCategory.gettingStarted.label": "Getting started",
  "wikiCategory.gettingStarted.description": "What DenialDesk is and how its parts fit together.",
  "wikiCategory.denialsAndAppeals.label": "Denials and appeals",
  "wikiCategory.denialsAndAppeals.description": "Reading, working, and appealing a denial.",
  "wikiCategory.claimsAndPayments.label": "Claims and payments",
  "wikiCategory.claimsAndPayments.description": "Claims, remittances, and posting.",
  "wikiCategory.floridaAndMedicareRules.label": "Florida and Medicare rules",
  "wikiCategory.floridaAndMedicareRules.description":
    "The legal clocks DenialDesk tracks, with values read live from the rules engine.",
  "wikiCategory.dataSafety.label": "Data safety",
  "wikiCategory.dataSafety.description": "Safeguards every user should know.",
  "wikiCategory.glossary.label": "Glossary",
  "wikiCategory.glossary.description": "Terms and file names.",

  // Wiki article page (/university/wiki/[slug])
  "article.metaTitle": "Wiki — {title}",
  "article.onThisPage": "On this page",
  "article.rulesReferenced": "Rules referenced",
  "article.rulesReferencedDescription": "Read from the rules engine as of today.",
  "article.unconfirmedNote":
    "“Unconfirmed” means Florida healthcare counsel has not yet confirmed the value; DenialDesk still applies it.",
  "article.relatedArticles": "Related articles",
  "article.sources": "Sources",
  "article.opensNewTab": "(opens in a new tab)",
  "article.lastReviewed": "Last reviewed {date}.",
  "article.notInForce": "value not in force today",
  "article.unconfirmedMarker": "; unconfirmed",

  // WikiSearch.tsx / wiki/actions.ts
  "search.label": "Search the wiki",
  "search.placeholder": "Title, term, or code, e.g. prompt pay",
  "search.searching": "Searching…",
  "search.hint": "Product terms only, never patient details.",
  "search.resultsAria": "Search results",
  "search.resultCount": "{count, plural, one {# article matches} other {# articles match}} “{query}”",
  "search.emptyTitle": "No article matches",
  "search.emptyDescription":
    "Try a shorter word or a code type such as CARC, or browse the categories below.",
  "search.roleDenied": "Your role cannot read the wiki.",

  // AccessPrompt.tsx (the offer shown on every visit to the catalog)
  "access.title": "Get access to DenialDesk University",
  "access.body":
    "A self-paced training program for practice staff: how DenialDesk works, how to read a denial, the Florida prompt-pay and appeal clocks the product enforces, and how patient data is protected, plus the reference Wiki.",
  "access.coursesLabel": "Courses",
  "access.lengthLabel": "Length",
  "access.lengthMinutes": "about {count, plural, one {# minute} other {# minutes}}",
  "access.wikiLabel": "Wiki articles",
  "access.price": "Access starts at {price}",
  "access.unlocks":
    "Once your practice has access, the courses unlock for everyone on your team. The Wiki stays open to everyone.",
  "access.request": "Request access",
  "access.requested":
    "Request recorded for your practice. The courses unlock once DenialDesk confirms access.",
  "access.requestedOn": "Access requested on {date}. The courses unlock once DenialDesk confirms access.",
  "access.failed": "The request could not be recorded. Try again.",
  "access.locked": "The courses are locked until your practice has access to DenialDesk University.",
  "access.lockedBadge": "Locked",
  "access.lockedDescription": "Locked until your practice has access to DenialDesk University.",
  "access.continue": "Continue to the courses",
} as const;
