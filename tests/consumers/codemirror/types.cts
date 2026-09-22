import codeMirror = require("@kalada/codemirror");

declare const options: codeMirror.KaladaEditorSessionOptions;
const session: codeMirror.KaladaEditorSession = codeMirror.createKaladaEditorSession(options);
session.dispose();
