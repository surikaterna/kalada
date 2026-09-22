import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const packageSource = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

const bundleEvidence = (): Plugin => ({
  name: "demo-bundle-evidence",
  generateBundle(_options, bundle) {
    const entries = Object.entries(bundle).map(([file, value]) => {
      const chunk = value as {
        type?: string;
        isEntry?: boolean;
        isDynamicEntry?: boolean;
        facadeModuleId?: string | null;
        imports?: string[];
        dynamicImports?: string[];
        implicitlyLoadedBefore?: string[];
        referencedFiles?: string[];
        modules?: Record<string, unknown>;
        viteMetadata?: { importedAssets?: Set<string>; importedCss?: Set<string> };
      };
      return {
        file,
        type: chunk.type,
        isEntry: chunk.isEntry ?? false,
        isDynamicEntry: chunk.isDynamicEntry ?? false,
        facadeModuleId: chunk.facadeModuleId ?? null,
        imports: chunk.imports ?? [],
        dynamicImports: chunk.dynamicImports ?? [],
        implicitlyLoadedBefore: chunk.implicitlyLoadedBefore ?? [],
        referencedFiles: chunk.referencedFiles ?? [],
        importedAssets: [...(chunk.viteMetadata?.importedAssets ?? [])].sort(),
        importedCss: [...(chunk.viteMetadata?.importedCss ?? [])].sort(),
        modules: Object.keys(chunk.modules ?? {}).sort(),
      };
    });
    this.emitFile({
      type: "asset",
      fileName: "demo-metafile.json",
      source: JSON.stringify(
        { format: "kalada-demo-bundle-v2", base: process.env.DEMO_BASE ?? "/", entries },
        null,
        2,
      ),
    });
  },
});

export default defineConfig({
  base: process.env.DEMO_BASE ?? "/",
  plugins: [bundleEvidence()],
  resolve: {
    alias: {
      "@kalada/adapter-scheman": packageSource("adapter-scheman"),
      "@kalada/codemirror": packageSource("codemirror"),
      "@kalada/core": packageSource("core"),
      "@kalada/host": packageSource("host"),
      "@kalada/language-service": packageSource("language-service"),
      "@kalada/syntax": packageSource("syntax"),
    },
  },
  build: {
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
});
