export function uriForName(name: string): string {
  return `kalada-demo://workspace/${encodeURIComponent(name)}`;
}

export function nameFromUri(uri: string): string {
  return decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1));
}
