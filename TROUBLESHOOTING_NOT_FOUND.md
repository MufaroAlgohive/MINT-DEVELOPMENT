# "Not Found" on /api/gift-registry/* after importing/reopening the project

## Symptom
After importing this project (or reopening it after it's been idle), API
calls to routes that are definitely registered in the code — most often
`/api/gift-registry/create`, `/api/gift-registry/my-registries`,
`/api/gift-registry/reserve`, etc. — return the generic Express 404 body:

```json
{"error":"Not found","message":"This is the API server..."}
```

even though `server/index.cjs` calls `registerGiftRegistryRoutes(app, ...)`
and the route handlers clearly exist in `server/giftRegistryRoutes.cjs`.

In the UI this shows up as things like "Not found" toasts when creating a
wishlist, or a wishlist saving successfully on the backend but the app
acting as if the endpoint doesn't exist.

## Root cause
This is **not a code bug**. It happens when the Node server process that's
currently running was started *before* the on-disk server files were fully
synced/checked out (e.g. right after an import, a git checkout, or a
workspace restore). The running process is serving a stale in-memory copy
of the Express app that never loaded the current route registrations, while
the files on disk are already correct.

You can confirm this by comparing the process start time to the file mtimes:

```bash
ps -o pid,lstart,cmd -p <server_pid>
stat -c '%Y %n' server/index.cjs server/giftRegistryRoutes.cjs
```

If the process `STARTED` time is *before* the files' modified time, the
process is stale.

## Fix
Simply restart the "Start application" workflow (or otherwise kill and
restart the `node server/index.cjs` process). No code changes are needed.
After restarting, hitting the same endpoint unauthenticated should return
`{"error":"Unauthorized"}` instead of `{"error":"Not found"}` — that's the
signal the routes are now live.

## When to check for this
- Right after importing/forking/reopening the project.
- Whenever an `/api/*` route that clearly exists in the code returns the
  generic "Not found" 404 body instead of a route-specific error
  (`Unauthorized`, validation error, etc).

If restarting the workflow does not fix it, then it's a real bug — look at
`server/index.cjs` for whether `registerGiftRegistryRoutes` (or the
relevant route registrar) is actually being called, and check for typos in
the route paths.
