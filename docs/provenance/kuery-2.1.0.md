# Kuery 2.1 strict-expression provenance

Kalada #2 mechanically extracts the strict-expression kernel from Kuery 2.1.0. The authority
is release commit `732eb12b1deacd85bb1421b92169c9af20a98962` (tag `v2.1.0`), whose
`src/expression` tree is `be5951e00aa227d3f6c4009700fe5920e786b66c`. The published npm artifact
has integrity
`sha512-L7H1oOAJApFQvgAuwBGvUsUcYmqsg04LxfpiCHSrYqDKecOzPDT4X2Yz5YrqrJDJevlZTCmsafV3JcBvAdxnJA==`.

The 13 production files are copied to `packages/core/src/kuery-v1` without semantic changes.
Allowed mechanical changes are formatting and import/type syntax, explicit fields replacing two
parameter properties, strict annotations, one local descriptor rename, and extraction of the
property-reading loop into a cohesive helper to satisfy lint complexity without changing control
flow. The single upstream test file is split
by its five top-level conformance suites; imports, strict annotations, and shared fixture
constructors are the only test changes. `packages/core/provenance/kuery-2.1.0.json` records source blob IDs,
SHA-256 checksums, destinations, and classifications and is included in the npm tarball.

Kalada's program envelope, package wiring, tests, documentation, and notices are Kalada-owned
additions rather than changes to the extracted kernel. No query, filter, or collection Kuery API
is included.
