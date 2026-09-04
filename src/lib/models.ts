// Friendly model modes mapped to real Groq model IDs.
// Check https://console.groq.com/docs/models for the current list —
// providers rename/retire model IDs over time, so verify these before relying on them.
export const MODELS = {
  flash: {
    label: "Flash",
    description: "Fastest, good for quick answers",
    groqModel: "openai/gpt-oss-20b",
  },
  smart: {
    label: "Smart",
    description: "Stronger reasoning, a bit slower",
    groqModel: "openai/gpt-oss-120b",
  },
  coder: {
    label: "Coder",
    description: "Tuned for programming help",
    groqModel: "openai/gpt-oss-120b",
  },
} as const;

export type ModelKey = keyof typeof MODELS;

export function isValidModel(key: string): key is ModelKey {
  return key in MODELS;
}
