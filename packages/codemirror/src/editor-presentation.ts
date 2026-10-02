import type { Tooltip } from "@codemirror/view";
import type { EditorHover } from "./editor-contracts.js";

export function editorTooltip(hover: EditorHover, from: number, to: number): Tooltip {
  return {
    pos: from,
    end: to,
    above: true,
    create(view) {
      const document = view.dom.ownerDocument;
      const dom = document.createElement("section");
      dom.className = "cm-editor-hover";
      dom.setAttribute("role", "tooltip");
      if (typeof hover.content === "string") dom.textContent = hover.content;
      else for (const section of hover.content) appendSection(document, dom, section);
      return { dom };
    },
  };
}

function appendSection(
  document: Document,
  dom: HTMLElement,
  section: { readonly heading: string; readonly text: readonly string[] },
): void {
  const heading = document.createElement("strong");
  heading.textContent = section.heading;
  dom.append(heading);
  const list = document.createElement("ul");
  for (const text of section.text.length ? section.text : ["None"]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  dom.append(list);
}
