// Shared constants: colors, node templates, priorities.

// ─── CONSTANTS ──────────────────────────────────────────────────
const NODE_COLORS = [
  '#c8f064', '#64b4f0', '#f06464', '#f0c864', '#a064f0',
  '#64f0c8', '#f064c8', '#8a8780', '#e8e6e0'
];

const NODE_TEMPLATES = {
  idea:     { label: 'Idee',       icon: '💡', color: '#f0c864' },
  task:     { label: 'Aufgabe',    icon: '☑️',  color: '#64b4f0' },
  question: { label: 'Frage',      icon: '❓', color: '#f06464' },
  procon:   { label: 'Pro/Contra', icon: '⚖️',  color: '#64f0c8' },
  note:     { label: 'Notiz',      icon: '📝', color: '#8a8780' },
  formula:  { label: 'Formel',     icon: '🧮', color: '#a064f0' },
  hardware: { label: 'Hardware',   icon: '🔧', color: '#f09050' },
  concept:  { label: 'Konzept',    icon: '🧠', color: '#50b0d0' },
  config:   { label: 'Config',     icon: '⚙️',  color: '#b0b060' },
  code:     { label: 'Code',       icon: '💻', color: '#60c080' }
};

const PRIORITIES = {
  high:   { label: 'Hoch',    color: '#f06464' },
  medium: { label: 'Mittel',  color: '#f0c864' },
  low:    { label: 'Niedrig', color: '#64f0c8' }
};
