# Retained Kuery 2.1 Promise-helper provenance

Kalada #46 removed the Kuery compatibility implementation. One private Promise hardening helper is
retained at `packages/core/src/kalada-v1/callback-promise.ts` because the native resolver and clock
boundaries use it to reject hostile and cross-realm Promises without user-controlled property
reads or unhandled rejections.

The helper derives from Kuery 2.1.0 release commit
`732eb12b1deacd85bb1421b92169c9af20a98962`, source blob
`7178b9cd936d317eaaec786932c1c251656fbb79`. The shipped provenance JSON records the exact current
destination SHA-256 and npm release integrity. No Kuery public API, source tree, tests, or runtime
dependency remains.
