import {
  createKaladaEditorSession,
  type KaladaEditorSession,
  type KaladaEditorSessionOptions,
} from "@kalada/codemirror";

declare const options: KaladaEditorSessionOptions;
const session: KaladaEditorSession = createKaladaEditorSession(options);
session.refreshEnvironment();
