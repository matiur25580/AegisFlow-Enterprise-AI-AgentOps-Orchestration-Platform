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
