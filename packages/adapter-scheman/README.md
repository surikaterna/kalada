# `@kalada/adapter-scheman`

`@kalada/adapter-scheman` converts a public `@scheman/core` v2 `SchemaDocument` into an immutable
Kalada host environment. It requires `formatVersion: 1`. The input root exclusively drives the
editor graph; the output root exclusively drives the conservative semantic projection. Scheman node
IDs are retained as document-local evidence, never as cross-document fingerprints.

```ts
import { adaptSchemanDocument } from "@kalada/adapter-scheman";
import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";

const { document } = ingestSchemaDocument(
  { type: "object", properties: { name: { type: "string" } } },
  { provider: jsonSchemaProvider() },
);
const result = adaptSchemanDocument({
  document,
  mode: "sync",
  providerId: "application.scheman",
  providerVersion: "1",
  configurationDigest: "sha256:application-configuration",
  cacheable: true,
  binding: { id: "value", name: "value", path: ["value"] },
});
```

## Conservative mapping

`SCHEMAN_SEMANTIC_MAPPING` is the closed normative mapping table and
`SCHEMAN_MAPPING_FIXTURE_MATRIX` names its test matrix. Primitive JSON domains map directly;
integer retains its constraints but projects as Kalada number. Arrays require a concrete item
projection. Proven JSON-safe object, record, tuple, and recursive local-ref graphs may project as
JSON. Every union/intersection branch must agree on one concrete projection. Unknown, opaque,
never, JS-unconstrained, non-JSON primitives, ambiguous wrappers, unresolved/external refs, and
unsupported applicators remain dynamic with diagnostics. Structural completeness is not validator
equivalence.

## Exact `x-kalada` policy

Only an own-data, node-local `x-kalada` key is recognized, either directly in trusted Scheman node
metadata or under JSON metadata's exact `extensions` bucket:

```json
{
  "x-kalada": {
    "version": 1,
    "type": { "kind": "primitive-type", "name": "number" },
    "codec": "application-owned-codec-id",
    "lossy": "safe-integer-bigint-to-number"
  }
}
```

The exact keys are `version`, `type`, optional `codec`, and optional `lossy`. Codec IDs are bounded
descriptions, not registry or import keys. A conversion requires a caller-supplied codec capability
whose ID and mode match and whose version/configuration identity are explicit. The adapter records
mandatory final Kalada-type validation; safe-integer bigint conversion additionally records the
safe-integer range precondition. The only lossy policies are `safe-integer-bigint-to-number` and
`heterogeneous-union-to-json`. Explicit binding override wins over a valid node profile, which wins
over conservative mapping. Malformed, duplicate, misplaced, or incompatible policy is rejected.

## Execution boundary

The adapter never invokes validators or codecs while normalizing. The original Standard validator
is returned by identity, live and unfrozen, while normalized declarations and live callbacks remain
separated by `@kalada/host`. `DENY_SCHEMAN_EXECUTION_PERMISSIONS` documents the default: do not pass
Scheman's `allow` options for Zod shape/lazy/metadata or Standard JSON conversion. Opt-in belongs to
the trusted caller during Scheman ingestion; this adapter cannot escalate it and provides no
hostile-code isolation.

Same-document pointers, definitions, recursion, and local anchors are consumed from Scheman's graph.
External/multi-resource refs, nested `$id` rebasing, dynamic refs/anchors, unevaluated vocabularies,
and unsupported dialect evidence remain visible and unsupported. The adapter performs no network or
filesystem fetch.

Runtime invocation, sync-thenable rejection, codec execution, and final converted-value validation
are owned by Kalada issue #73. This package declares and checks all pre-link permissions and policy
preconditions but intentionally does not duplicate that execution layer.
