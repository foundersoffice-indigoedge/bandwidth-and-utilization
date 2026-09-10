export function formatExcludedProjectsNotice(count: number): string {
  if (count === 1) {
    return '1 project entry was excluded by an older report. Its submitted hours remain in the underlying record.';
  }
  return `${count} project entries were excluded by an older report. Their submitted hours remain in the underlying records.`;
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
