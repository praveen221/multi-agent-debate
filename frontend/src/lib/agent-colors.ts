const PALETTE = [
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
];

export function agentColorClass(index: number): string {
  return PALETTE[index % PALETTE.length];
}
