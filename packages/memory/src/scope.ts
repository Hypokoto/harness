export function isScopeMatch(memoryScope: string, queryScope: string): boolean {
  // Simple hierarchical scope match. If queryScope is 'global', it only matches 'global'.
  // If memoryScope is 'global', it is available to any queryScope (assuming global is public).
  if (memoryScope === 'global') return true;
  
  // exact match
  if (memoryScope === queryScope) return true;
  
  // if queryScope is a child of memoryScope, e.g. query: 'project/A/dev', memory: 'project/A'
  if (queryScope.startsWith(memoryScope + '/')) return true;
  
  return false;
}
