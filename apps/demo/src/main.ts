import "./ui/styles.css";
import { createDemoApp } from "./ui/app.js";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) throw new Error("Demo mount is unavailable");
createDemoApp(mount);
