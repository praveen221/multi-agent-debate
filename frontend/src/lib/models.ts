export function shortModelName(id: string): string {
  const slug = id.split("/")[1] || id;
  return slug
    .split("-")
    .map((w) => (w.length <= 3 && /\d/.test(w) ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}
