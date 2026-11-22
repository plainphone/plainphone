# @plainphone/api-client

Types for the Plainphone API, generated from [`server/openapi.yaml`](../../server/openapi.yaml)
with openapi-typescript, and a small fetch wrapper.

- `src/schema.d.ts` is generated. After changing the spec, run
  `pnpm --filter @plainphone/api-client generate` and commit the result.
  `pnpm --filter @plainphone/api-client check` fails when it is behind; CI runs it.
- `createClient({ baseUrl, credentials, headers, onUnauthorized, fetch })` returns `api`, whose
  `get`, `post`, `put`, `patch` and `del` accept only the paths the spec describes for that
  method, as template strings (`api.get<Me>("/me")`, ``api.put(`/phones/${pid}/home`, home)``).
  Most responses are not described in the spec yet, so the caller names the response type. It
  also returns `request(method, path, body)`, which takes any path: use it only for a route the
  spec does not describe, and add the route to the spec instead when you can.
- Errors are `ApiError` (status, message, field issues, the error body); a failed fetch is
  `ApiError(0, "network")`.

The web dashboard uses `createClient` (`web/src/lib/api.ts`). The parent app keeps its
openapi-fetch client (`parent-app/src/api/client.ts`) and takes `paths` and `components` from
`@plainphone/api-client/schema`.
