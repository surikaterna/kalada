import { editor, gotoReady, openTab, replaceEditor } from "./helpers.js";
import type { Scenario } from "./types.js";

export const editorUsability: Scenario = {
  name: "editor-highlighting-keyboard-and-computed-contrast",
  async run({ page, baseUrl }) {
    await gotoReady(page, baseUrl);
    if (!(await page.getByText("Editor shortcuts:", { exact: false }).count()))
      throw new Error("Shortcut help missing");
    await openTab(page, "count.kalada");
    await replaceEditor(page, "data.count + 1");
    await page.locator(".kalada-hl-reference").first().waitFor();
    await page.locator(".kalada-hl-field").first().waitFor();
    await assertContrast(page, ".kalada-hl-reference", ".cm-editor", 4.5);
    await assertContrast(page, ".kalada-hl-field", ".cm-editor", 4.5);
    await page.locator(".kalada-hl-field").hover();
    await page.locator(".cm-tooltip-hover").waitFor();
    await assertContrast(page, ".cm-tooltip-hover", ".cm-tooltip-hover", 4.5);
    await assertContrast(page, ".cm-content", ".cm-editor", 3, "caretColor");
    await assertContrast(page, ".cm-editor", ".cm-editor", 4.5, "outlineColor", true);
    await replaceEditor(page, "data.");
    await page.locator(".kalada-hl-punctuation").waitFor();
    await editor(page).press("Control+Space");
    await page.locator(".cm-tooltip-autocomplete").waitFor();
    if (!(await page.locator(".cm-completionLabel").allTextContents()).includes("count"))
      throw new Error("Incomplete completion missing");
    await assertContrast(page, ".cm-tooltip-autocomplete", ".cm-tooltip-autocomplete", 4.5);
    await assertContrast(
      page,
      ".cm-tooltip-autocomplete li[aria-selected]",
      ".cm-tooltip-autocomplete li[aria-selected]",
      4.5,
    );
    // Wait for CodeMirror's debounced query to settle before testing the selectable menu.
    await page.waitForTimeout(350);
    await editor(page).press("Tab");
    if ((await editor(page).textContent()) !== "data.count")
      throw new Error(`Tab did not accept once: ${await editor(page).textContent()}`);
    await editor(page).press("Tab");
    if (await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))) {
      throw new Error("Inactive Tab trapped editor focus");
    }
    await replaceEditor(page, "@ + 1");
    await page.locator(".kalada-hl-invalid").waitFor();
    await replaceEditor(page, "data.count");
    await editor(page).press("Home");
    await editor(page).press("Control+Shift+h");
    await page.locator(".cm-kalada-hover").waitFor();
    await assertContrast(page, ".cm-tooltip", ".cm-tooltip", 4.5);
    await editor(page).press("Escape");
    await page.locator(".cm-kalada-hover").waitFor({ state: "hidden" });
    await verifyJsonAndReset(page);
  },
};

async function verifyJsonAndReset(page: import("playwright").Page): Promise<void> {
  await openTab(page, "data.json");
  await assertContrast(page, ".cm-content", ".cm-editor", 4.5);
  await assertContrast(page, ".cm-content", ".cm-editor", 3, "caretColor");
  if (!(await page.locator(".cm-line span[class]").count()))
    throw new Error("JSON syntax colors missing");
  await assertContrast(page, ".cm-line span[class]", ".cm-editor", 4.5);
  await page.getByRole("button", { name: "Reset" }).click();
  await page.locator(".cm-editor").waitFor();
  await assertContrast(page, ".cm-content", ".cm-editor", 4.5);
}

async function assertContrast(
  page: import("playwright").Page,
  foreground: string,
  background: string,
  minimum: number,
  foregroundProperty = "color",
  focus = false,
): Promise<void> {
  const measured = await page.evaluate(
    ({ foreground, background, foregroundProperty, focus }) => {
      const front = document.querySelector(foreground);
      const back = document.querySelector(background);
      if (!front || !back) return { ratio: 0, foreground: "missing", background: "missing" };
      if (focus && front instanceof HTMLElement) front.focus();
      const rgb = (value: string) => (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = rgb(value).map((component) => {
          const linear = component / 255;
          return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const foregroundColor = getComputedStyle(front)[foregroundProperty as "color"];
      const backgroundColor = getComputedStyle(back).backgroundColor;
      const a = luminance(foregroundColor);
      const b = luminance(backgroundColor);
      return {
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        foreground: foregroundColor,
        background: backgroundColor,
      };
    },
    { foreground, background, foregroundProperty, focus },
  );
  console.log(
    `Contrast ${foreground}: ${measured.foreground} / ${measured.background} = ${measured.ratio.toFixed(2)}:1`,
  );
  if (measured.ratio < minimum)
    throw new Error(
      `Contrast ${foreground}/${background}: ${measured.ratio.toFixed(2)} < ${minimum}`,
    );
}
