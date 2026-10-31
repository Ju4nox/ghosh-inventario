const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 3,
});

const weightFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 4,
});

const chileDateFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Santiago',
});

export function formatMoney(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return '$0';
  return clpFormatter.format(num);
}

export function formatQuantity(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return '0';
  return quantityFormatter.format(num);
}

export function formatWeight(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return '0';
  return weightFormatter.format(num);
}

export function formatChileDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return chileDateFormatter.format(date);
}
