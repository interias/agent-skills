// Builders for transcript lines in the layout Claude Code writes.

export const T0 = Date.parse('2026-11-18T10:00:00Z');
export const min = (n: number) => new Date(T0 + n * 60_000).toISOString();

export function mensch(m: number, text: string): string {
  return JSON.stringify({ type: 'user', timestamp: min(m), message: { role: 'user', content: text } });
}

export function nachricht(m: number, text = 'weiter'): string {
  return mensch(m, `<cross-session-message from="x">${text}</cross-session-message>`);
}

export function meldung(m: number, toolId: string): string {
  return mensch(m, `<task-notification><tool-use-id>${toolId}</tool-use-id><status>completed</status></task-notification>`);
}

export function assistent(m: number, text: string, opts: { stop?: string; tools?: { id: string; name: string; input: unknown }[] } = {}): string {
  const content: unknown[] = [];
  if (text) content.push({ type: 'text', text });
  for (const t of opts.tools ?? []) content.push({ type: 'tool_use', ...t });
  return JSON.stringify({
    type: 'assistant',
    timestamp: min(m),
    message: { role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: opts.stop ?? (opts.tools?.length ? 'tool_use' : 'end_turn') },
  });
}

export function ergebnis(m: number, toolId: string, text: string, daten?: unknown): string {
  return JSON.stringify({
    type: 'user',
    timestamp: min(m),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: text }] },
    ...(daten === undefined ? {} : { toolUseResult: daten }),
  });
}

export function frage(question: string, labels: string[]) {
  return { question, header: 'x', multiSelect: false, options: labels.map((label) => ({ label, description: '' })) };
}
