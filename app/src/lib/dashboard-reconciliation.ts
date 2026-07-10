export function formatExcludedProjectsNotice(count: number): string {
  if (count === 1) {
    return '1 submitted project was excluded because its Airtable stage or team assignment changed after submission.';
  }
  return `${count} submitted projects were excluded because their Airtable stage or team assignment changed after submission.`;
}

export function findSubmissionRemarks(
  submissions: Array<{ remarks: string | null }>,
): string | null {
  for (const submission of submissions) {
    const trimmed = submission.remarks?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}
