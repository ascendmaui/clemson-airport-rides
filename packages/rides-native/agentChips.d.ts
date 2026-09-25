export type AgentChip = { label: string; text: string }

export const HELP_CHIPS: { rider: AgentChip[]; driver: AgentChip[] }
export const SUPPORT_CHIPS: { rider: AgentChip[]; driver: AgentChip[] }

export function categoryLabel(category: unknown): string
