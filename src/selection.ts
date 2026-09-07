function matcher(input: string): (path: string) => boolean {
  const pattern = input.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  if (!pattern || pattern.length > 300 || pattern.split('/').includes('..'))
    throw new Error('Use vault-relative note paths, folders or glob patterns.');
  if (!/[?*]/.test(pattern)) return path => path === pattern || path.startsWith(`${pattern}/`);
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { expression += '(?:.*/)?'; i++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`${expression}$`);
  return path => regex.test(path);
}

export function selection(includes: string[], excludes: string[]): (path: string) => boolean {
  const allow = includes.filter(p => p.trim()).map(matcher);
  const deny = excludes.filter(p => p.trim()).map(matcher);
  return path => path.toLowerCase().endsWith('.md') &&
    !path.split('/').some(part => part.startsWith('.')) &&
    allow.some(match => match(path)) && !deny.some(match => match(path));
}
