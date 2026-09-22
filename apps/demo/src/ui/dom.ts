export function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const value = document.createElement(name);
  if (className) value.className = className;
  return value;
}

export function button(text: string, action: () => void): HTMLButtonElement {
  const value = document.createElement("button");
  value.type = "button";
  value.textContent = text;
  value.addEventListener("click", action);
  return value;
}

export function panel(title: string, text: string, sensitive = false): HTMLElement {
  const section = element("section", "panel");
  const heading = element("h2");
  heading.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = text;
  section.append(heading);
  if (sensitive) {
    const warning = element("p", "sensitive");
    warning.textContent = "Local data/result — may contain secrets";
    section.append(warning);
  }
  section.append(pre);
  return section;
}
