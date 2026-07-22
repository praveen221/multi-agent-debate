// The xAI-derived accent palette (DESIGN.md) is reserved for illustrative
// moments — agent identity avatars qualify. Everything else stays monochrome.
const PALETTE = [
  "bg-[#ff7a17]/15 text-[#ffc285]",
  "bg-[#7c3aed]/20 text-[#c4b5fd]",
  "bg-[#a0c3ec]/15 text-[#a0c3ec]",
  "bg-[#ffc285]/15 text-[#ffc285]",
  "bg-[#c4b5fd]/15 text-[#c4b5fd]",
  "bg-[#0d1726] text-[#a0c3ec]",
];

const AVATAR_PALETTE = [
  "bg-[#ff7a17] text-[#0a0a0a]",
  "bg-[#7c3aed] text-white",
  "bg-[#a0c3ec] text-[#0a0a0a]",
  "bg-[#ffc285] text-[#0a0a0a]",
  "bg-[#c4b5fd] text-[#0a0a0a]",
  "bg-[#0d1726] text-white",
];

// A quiet left-border accent for turn blocks, same identity colors as the
// avatars — lets the eye tell speakers apart while scanning without reading names.
const BORDER_PALETTE = [
  "border-[#ff7a17]/50",
  "border-[#7c3aed]/50",
  "border-[#a0c3ec]/50",
  "border-[#ffc285]/50",
  "border-[#c4b5fd]/50",
  "border-[#a0c3ec]/30",
];

export function agentColorClass(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function agentAvatarClass(index: number): string {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

export function agentBorderClass(index: number): string {
  return BORDER_PALETTE[index % BORDER_PALETTE.length];
}
