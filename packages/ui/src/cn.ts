export type ClassValue = string | false | null | undefined;

/** Joins class names without pulling in clsx/tailwind-merge for five components. */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
