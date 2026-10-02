import type { DocumentSnapshot } from "@kalada/language-service";

export function wholeReplacement(snapshot: DocumentSnapshot, text: string) {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: snapshot.lineIndex.positionAt(snapshot.text.length),
    },
    text,
  };
}
