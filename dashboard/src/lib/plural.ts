/** "1 visit", "2 visits": a count with the right singular/plural noun. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
