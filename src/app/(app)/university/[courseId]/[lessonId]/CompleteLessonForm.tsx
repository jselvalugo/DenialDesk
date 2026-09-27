"use client";

import { useActionState } from "react";
import { CircleCheck } from "lucide-react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatDateTime } from "@/lib/format";
import { completeLesson, type CompleteLessonState } from "../../actions";

/** "Mark lesson complete", or the completion time once it is done. Completions can't be undone. */
export function CompleteLessonForm({
  courseId,
  lessonId,
  completedAt,
}: {
  courseId: string;
  lessonId: string;
  /** ISO timestamp when already complete. */
  completedAt: string | null;
}) {
  const [state, action] = useActionState<CompleteLessonState, FormData>(completeLesson, {});
  const done = state.completedAt ?? completedAt;
  if (done) {
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-body font-medium text-success-fg">
        <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
        Lesson completed {formatDateTime(new Date(done))}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      {state.error && (
        <p role="alert" className="text-label font-medium text-danger-fg">
          {state.error}
        </p>
      )}
      <SubmitButton variant="primary" pendingLabel="Saving…">
        Mark lesson complete
      </SubmitButton>
    </form>
  );
}
