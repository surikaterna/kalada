# `@kalada/host`

`@kalada/host` defines immutable, schema-neutral environment descriptors for Kalada. It is a
foundation package: it does not compile, link, validate, transform, or evaluate values.

## Authority separation

Every binding declares `semanticType` as the syntax-owned `KaladaSyntaxStaticType`. That field is the
only semantic projection. Editor shape, metadata, validators, codecs, and provider-owned tags never
infer or fabricate a `KaladaType`. In particular, a metadata property named `$type` is ordinary data;
only a future provider adapter with explicit trusted provenance may interpret its own tags.

Editor shape is normalized into an ordered `kalada-editor-graph-v1` node table. Roots, definitions,
properties, tuple items, union variants, paths, unresolved references, unknown constructs, and cycle
edges retain input order. Graph construction, roots, definitions, reference resolution, and traversal
are bounded, with limit evidence retained in the graph. Node IDs such as `n0` are
deterministic traversal identities scoped only to that normalized document (`nodeIdScope` is
`document-local`); they are not hashes, cache keys, or cross-document fingerprints.

Normalized environments contain only recursively frozen serializable data. Validator and codec
callbacks are held separately in the returned, instance-scoped `capabilitySnapshot`. There is no
global provider registry, ambient lookup, cache, or import-time registration.

## Manual provider

```ts
import { createManualProvider, describeEnvironment } from "@kalada/host";

const provider = createManualProvider({
  mode: "sync",
  providerId: "example.manual",
  providerVersion: "1",
  configurationDigest: "sha256:configuration-owned-by-the-host",
  bindings: [
    {
      id: "customer",
      name: "customer",
      path: ["customer"],
      semanticType: "dynamic",
      editorShape: {
        root: {
          kind: "object",
          properties: [
            { name: "name", required: true, shape: { kind: "scalar", name: "string" } },
          ],
        },
      },
      metadata: { description: "A customer record" },
    },
  ],
});

const described = describeEnvironment(provider);
if (!described.ok) throw new Error(described.diagnostics[0]?.code);
```

Capability declarations and the provider explicitly state `mode: "sync" | "async"`; this package
records that mode but invokes no callback and offers no asynchronous API. A capability is referenced
from a binding by its declared handle. The normalized declaration is data-only while the matching
`decode` or `convert` function exists only in `capabilitySnapshot`.

Reusable cacheability requires all three provider fields (`providerId`, `providerVersion`, and
`configurationDigest`) and all three capability fields (`capabilityId`, `capabilityVersion`, and
`configurationDigest`). `cacheable: false` explicitly opts out. Any missing identity makes the
environment explicitly non-cacheable; this package emits no link fingerprint.

All failures use a frozen `phase: "environment"` diagnostic with a stable code and fixed message.
Diagnostics may include a copied binding path and allow-listed provenance strings, but never include
input values, callback/provider objects, exception messages, stacks, source text, or secrets.
The public `HostDiagnostic` envelope also reserves parse, lower, compile, link, bind, and evaluate
phases plus UTF-16 source and immutable syntax/core cause fields for later orchestration packages.
