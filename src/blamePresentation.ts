import type { BlameLine } from './history';

export function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}` : '';
}

export function annotationText(line: BlameLine): string {
  const date = line.uncommitted ? '*' : shortDate(line.authoredAt);
  const author = line.author.replace(/\s+/g, ' ');
  const name = Array.from(author);
  const clipped = name.length > 17 ? name.slice(0, 16).join('') + '…' : author;
  return `${date.padEnd(10)}${clipped}`;
}
