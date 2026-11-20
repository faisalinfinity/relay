/**
 * Which agent this tab is acting as. Kept in sessionStorage, which is per tab, so two windows
 * can be two different agents and each survives a reload.
 */
const KEY = 'relay.agentId';

export function readAgentId(): string | null {
  return sessionStorage.getItem(KEY);
}

export function saveAgentId(id: string | null) {
  if (id) sessionStorage.setItem(KEY, id);
  else sessionStorage.removeItem(KEY);
}
