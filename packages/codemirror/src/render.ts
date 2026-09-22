import type { EditorView, Tooltip } from "@codemirror/view";
import type { HoverInfo, ShapeSummary, ToolingEvidence } from "@kalada/language-service";

export function hoverTooltip(info: HoverInfo, position: number): Tooltip {
  return {
    pos: position,
    above: true,
    create(view: EditorView) {
      const document = view.dom.ownerDocument;
      const dom = document.createElement("section");
      dom.className = "cm-kalada-hover";
      dom.setAttribute("role", "tooltip");
      dom.setAttribute("aria-label", "Kalada expression information");
      appendSection(document, dom, "Input editor shape", info.input.map(shapeText));
      appendSection(document, dom, "Output Kalada semantic projection", [semanticText(info)]);
      appendSection(document, dom, "Presence / branch conditions", [accessText(info)]);
      appendSection(document, dom, "Limit/unknown evidence", info.evidence.map(evidenceText));
      return { dom };
    },
  };
}

function appendSection(
  document: Document,
  parent: HTMLElement,
  heading: string,
  values: readonly string[],
): void {
  const title = document.createElement("strong");
  title.textContent = heading;
  parent.append(title);
  const list = document.createElement("ul");
  for (const value of values.length > 0 ? values : ["None"]) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  parent.append(list);
}

function shapeText(summary: ShapeSummary): string {
  const fields = summary.fields
    .map(
      ({ name, presence, accessible }) =>
        `${name} (${presence}, ${accessible ? "accessible" : "inspect only"})`,
    )
    .join(", ");
  const scalar = summary.scalar ? ` ${summary.scalar}` : "";
  return `${summary.kind}${scalar}; ${summary.presence}; fields: ${fields || "none"}`;
}

function semanticText(info: HoverInfo): string {
  const type = info.output.type === "dynamic" ? "dynamic" : JSON.stringify(info.output.type);
  return `${info.output.known ? "Known" : "Unknown"}: ${type}`;
}

function accessText(info: HoverInfo): string {
  return `Access: ${info.access}`;
}

function evidenceText(evidence: ToolingEvidence): string {
  return `${evidence.code} at ${evidence.path.join(".") || "root"}`;
}
