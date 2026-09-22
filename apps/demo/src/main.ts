import { admitSchema } from "./schema/admission.js";
import { createWholeDataValidator } from "./schema/validator.js";

const validator = createWholeDataValidator(admitSchema({ type: "string" }));
const result = validator.validate("browser-ready");
const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Demo mount is unavailable");
app.textContent = result.valid ? "Validator proof ready" : "Validator proof failed";
