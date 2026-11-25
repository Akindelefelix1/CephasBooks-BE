export function addPaymentTermDays(issueDate: string | Date, days: number): Date {
  const datePart = issueDate instanceof Date
    ? issueDate.toISOString().slice(0, 10)
    : issueDate.slice(0, 10);
  const dueDate = new Date(`${datePart}T00:00:00.000Z`);
  dueDate.setUTCDate(dueDate.getUTCDate() + days);
  return dueDate;
}

export function paymentTermLabel(days: number): string {
  return days === 0 ? 'Due on receipt' : `Net ${days}`;
}

export function parsePaymentTermDays(value?: string): number {
  if (!value?.trim()) return 30;
  if (/^(due on receipt|due immediately|immediate)$/i.test(value.trim())) return 0;
  const days = value.match(/\d+/)?.[0];
  return days ? Math.min(3650, Math.max(0, Number(days))) : 30;
}
