// Two overlapping speech shapes, monochrome per the xAI-derived system —
// white ink over near-black, the back shape in canvas-mid.
function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="6" width="20" height="14" rx="5" fill="#363a3f" />
      <rect x="9" y="12" width="20" height="14" rx="5" fill="#ffffff" />
    </svg>
  );
}

export function MadWorldWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-display)] text-foreground ${className}`}>
      Mad World
    </span>
  );
}

export function MadWorldLogo({
  size = "sm",
  className = "",
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const markSize = size === "lg" ? 40 : 22;
  const textClass = size === "lg" ? "text-4xl" : "text-lg";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={markSize} />
      <MadWorldWordmark className={textClass} />
    </span>
  );
}
