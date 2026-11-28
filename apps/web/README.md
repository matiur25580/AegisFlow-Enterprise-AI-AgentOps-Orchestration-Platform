# AegisFlow Web

React 18 + TypeScript + Vite frontend for the AegisFlow enterprise agent operations platform.

## Local development

1. Start MongoDB and configure the root environment using `.env.example`.
2. Install dependencies from the repository root with `npm install`.
3. Start the API and web development servers with `npm run dev`.
4. The API defaults to `http://localhost:4000`; Vite defaults to `http://localhost:5173`.

To point the web application at another API origin, copy `.env.example` to `.env.local` in this directory and set `VITE_API_BASE_URL`. The value should include the API prefix, for example `https://api.example.com/api/v1`.

## Workflow Studio

The Workflow Studio is available from the Workspace navigation. It signs in through the existing `POST /auth/login` endpoint, keeps the short-lived access token in component memory, and sends it as a bearer token. The refresh token remains in the API's HttpOnly cookie; the client calls `POST /auth/refresh` after an expired access token and retries the original request once.

The editor currently supports:
- Tenant-scoped workflow listing and selection.
- Draft creation and metadata editing.
- Start, agent, condition, approval and end nodes.
- Drag positioning, node configuration JSON, and directed edge connections.
- Immutable graph version saves and version history.
- Publishing and rollback by promoting a previous version.
- Structured server validation feedback.

The server remains authoritative for authorization, tenant scope, graph validation and secret-reference validation. Do not put provider credentials in node configuration. Use the supported secret-reference URI contract.

## Current scope

The canvas is a lightweight React editor, not yet a full node-port connector experience. Execution, live run simulation, branching runtime semantics, approval execution, collaboration, autosave and real-time multi-user editing are not implemented in this milestone. No deployment is performed by this repository workflow.


## Budget Alerts

The **Govern → Budget alerts** workspace uses the authenticated session and refresh-cookie flow to load the tenant's persistent budget alert history. It displays warning and exceeded events, captured estimated spend/limit/utilization, unread count, timestamps, and a mark-as-read action. Refresh also evaluates current usage through the API and may persist newly crossed thresholds.

The UI surfaces the 5,000-run sample saturation warning. Alert evaluation currently occurs on API reads; this is not scheduled or real-time push delivery. External email and webhook notifications are not enabled.


## Identity and workspace access

The application shell restores the HttpOnly refresh-cookie session on startup. Access tokens are held in memory only; the browser client sends them as bearer tokens and retries one failed authenticated request after a successful refresh. Sign-in, organization signup, and invitation acceptance are available from the unauthenticated entry screen.

The **Govern → Access & policies** section provides tenant-scoped member and invitation administration, plus current-user session visibility and revocation. The workspace selector lists only active memberships belonging to the authenticated user. The API remains authoritative for all access decisions.

For local development, Vite proxies `/api` to `http://localhost:4000`. Set `VITE_API_BASE_URL` in `.env.local` when the API is hosted at another origin; include the API prefix (for example `https://api.example.com/api/v1`). Credentialed requests require the API's `WEB_ORIGIN` to match the frontend origin.

Invitation tokens are displayed only once after creation. The platform does not currently send invitation email; share the token using an approved secure channel. The acceptance form derives the invited email from the token and requires an existing account password or a new strong password.

Password reset, MFA, SSO, SCIM provisioning and database-backed browser end-to-end tests are not included in this milestone.
