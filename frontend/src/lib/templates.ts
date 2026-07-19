import type { AgentDraft } from "@/lib/api";

// Debate templates are input transforms, not text pre-fills: selecting one
// never types into the topic box. It swaps the placeholder, and at submit
// time composeTopic/composeStances bake the user's actual subject into the
// real topic and stances. Adding a use case = adding an entry here — no new
// code paths, no schema changes.

export const DEFAULT_AGENTS: AgentDraft[] = [
  { name: "Agent A", model: "deepseek/deepseek-v4-pro", use_search: true },
  { name: "Agent B", model: "moonshotai/kimi-k2.5", use_search: true },
];

const MODEL_A = "deepseek/deepseek-v4-pro";
const MODEL_B = "moonshotai/kimi-k2.5";

export type DebateTemplate = {
  id: string;
  label: string;
  placeholder: string;
  agents: AgentDraft[];
  composeTopic?: (input: string) => string;
  // Per-agent stances composed from the user's subject. Only fills agents
  // whose stance the user hasn't set by hand. Also shown live as the stance
  // field's placeholder in the config sheet.
  composeStances?: (input: string) => (string | undefined)[];
  // Template-flavored example for the "Voice & style" field.
  personaPlaceholder?: string;
};

export const TEMPLATES: DebateTemplate[] = [
  {
    id: "open",
    label: "Open discussion",
    placeholder:
      "What should the agents discuss? e.g. Can a discussion between multiple models lead to more factually correct research than using one model alone?",
    agents: DEFAULT_AGENTS,
    personaPlaceholder: "e.g. A cautious economist who prioritizes empirical evidence over theory",
  },
  {
    id: "validate",
    label: "Validate my idea",
    placeholder:
      "Describe the idea you want stress-tested — a product, a feature, a plan. e.g. a marketplace for renting camera gear",
    agents: [
      { name: "Advisor A", model: MODEL_A, use_search: true, mode: "advise" },
      { name: "Advisor B", model: MODEL_B, use_search: true, mode: "advise" },
    ],
    composeTopic: (input) =>
      `I'm building this and want it stress-tested — poke holes in it, test the assumptions, and tell me how to make it better: ${input}`,
    personaPlaceholder: "e.g. A skeptical venture investor who has heard a thousand pitches",
  },
  {
    id: "bull-bear",
    label: "Bull vs Bear",
    placeholder: "Which stock, asset, or bet? e.g. HDFC Bank",
    agents: [
      { name: "Bull", model: MODEL_A, use_search: true, mode: "advocate" },
      { name: "Bear", model: MODEL_B, use_search: true, mode: "advocate" },
    ],
    composeTopic: (input) => `Bull case vs bear case: ${input}`,
    composeStances: (input) => {
      const subject = input || "the subject of this debate";
      return [
        `Argue the bull case for ${subject} — make the strongest honest case that it is a strong bet.`,
        `Argue the bear case for ${subject} — make the strongest honest case that it is weak or risky.`,
      ];
    },
    personaPlaceholder: "e.g. A blunt fund manager who argues in numbers",
  },
  {
    id: "prosecute",
    label: "Prosecute a claim",
    placeholder: 'The claim to put on trial, e.g. "Remote work reduces productivity"',
    agents: [
      { name: "Defense", model: MODEL_A, use_search: true, mode: "advocate" },
      { name: "Prosecution", model: MODEL_B, use_search: true, mode: "advocate" },
    ],
    composeTopic: (input) => `Is this claim actually true: ${input}`,
    composeStances: (input) => {
      const claim = input || "the claim under debate";
      return [
        `Argue that this claim is true and well-supported by evidence: ${claim}`,
        `Argue that this claim is false, overstated, or unsupported: ${claim}`,
      ];
    },
    personaPlaceholder: "e.g. A meticulous trial lawyer who cross-examines every claim",
  },
];
