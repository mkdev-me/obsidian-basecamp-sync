/** Remove Obsidian comments while retaining literal percent signs in code. */
export function removeComments(source: string): string {
  let comment = false;
  let fence = '';
  let codeTicks = 0;
  return source.split('\n').map(line => {
    if (!comment && !codeTicks) {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (match) {
        if (!fence) fence = match[1]!;
        else if (match[1]![0] === fence[0] && match[1]!.length >= fence.length) fence = '';
        return line;
      }
      if (fence || /^( {4}|\t)/.test(line)) return line;
    }
    let output = '';
    for (let index = 0; index < line.length;) {
      if (!codeTicks && line.slice(index, index + 2) === '%%') {
        comment = !comment; index += 2; continue;
      }
      if (comment) { index++; continue; }
      if (line[index] === '`') {
        let end = index + 1;
        while (line[end] === '`') end++;
        const count = end - index;
        if (!codeTicks) codeTicks = count;
        else if (codeTicks === count) codeTicks = 0;
        output += line.slice(index, end); index = end;
      } else if (line[index] === '\\' && index + 1 < line.length) {
        output += line.slice(index, index + 2); index += 2;
      } else { output += line[index]; index++; }
    }
    return output;
  }).join('\n');
}
