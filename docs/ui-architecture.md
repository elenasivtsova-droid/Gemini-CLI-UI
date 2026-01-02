# ui enhancements Frontend Architecture Document

## Template and Framework Selection

The **ui enhancements** frontend is built on the existing `gemini-cli-ui` codebase and uses:

- **Framework:** React 18 (function components and hooks, primarily `.jsx` today)
- **Language:** JavaScript currently, with **TypeScript strongly recommended for all new code**
- **Build tool/bundler:** Vite
- **Routing:** `react-router-dom` v6
- **Styling:** Tailwind CSS plus global CSS in `src/index.css`
- **Editor/UX helpers:** CodeMirror, xterm, and various React UI utilities

There is no separate third‑party starter template (e.g. CRA or Next.js); the current project **is the starter** and the canonical reference implementation. This architecture document therefore:

- Treats **Vite + React** as the long‑term foundation.
- Recommends that **new components and shared modules use TypeScript** (`.ts`/`.tsx`), with the existing `.jsx` code migrated opportunistically over time.
- Keeps Tailwind CSS and the existing theme token system as the primary styling mechanism.
- Keeps the current routing model (a single main workspace view with session‑specific URLs).

### Change Log

| Date       | Version | Description                                                   | Author              |
|-----------|---------|---------------------------------------------------------------|---------------------|
| 2026-01-02 | 0.1.0  | Initial frontend architecture draft for **ui enhancements**   | Winston (Architect) |

### Rationale

- Uses the **current codebase as the starter** to avoid unnecessary rewrites.
- **React 18 + Vite** is a proven, “boring but modern” stack with excellent DX and fast feedback.
- Introducing **TypeScript in new work and in core shared layers** yields strong safety and better AI/dev ergonomics without forcing an immediate rewrite.
- Keeping Tailwind and the existing token system avoids churn while enabling consistent theming and a recognizable visual identity.

---

## Frontend Tech Stack

This table captures the canonical frontend technology stack for **ui enhancements**. Changes here should stay in sync with the main architecture document’s technology stack table.

| Category           | Technology                                   | Version     | Purpose                                             | Rationale                                                                                     |
|--------------------|----------------------------------------------|-------------|-----------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Framework          | React                                       | 18.x        | Core UI rendering and component model               | Already used in this repo; mature ecosystem; well‑suited to SPA + rich editor use case.      |
| UI Library         | Custom components + Tailwind‑based patterns | N/A         | Layout and reusable UI primitives                   | Domain‑specific UI is hand‑rolled; Tailwind utilities and small abstractions keep it flexible.|
| State Management   | React hooks + Context                       | N/A         | Shared app state (auth, settings, workspace, UI)    | Matches current patterns; avoids extra libraries while enabling structured, documented state.|
| Routing            | React Router DOM                            | 6.x         | Client‑side routing/navigation                      | Already in dependencies; v6 supports nested routes and code‑splitting when needed.           |
| Build Tool         | Vite                                        | 7.x         | Dev server and production bundling                  | Fast, simple config, already wired into scripts; ideal for iterative UI enhancements.        |
| Styling            | Tailwind CSS + `src/index.css`              | 3.x         | Styling, theming, responsive layout                 | Tailwind is installed and used; utility‑first approach speeds AI/dev iteration.              |
| Testing            | Vitest + React Testing Library (recommended)| TBA         | Unit/integration testing for components and flows   | Standard Vite/React combo keeps tests fast and close to the UI code.                         |
| Component Library  | None (custom)                               | N/A         | Domain‑specific components (chat, editor, panels)   | Highly specialized dev‑tool UI; generic design systems would add friction right now.         |
| Form Handling      | Native React forms + local state            | N/A         | Auth, setup, and configuration forms                | Current forms are lightweight; a form library can be introduced if complexity grows.         |
| Animation          | CSS transitions + Tailwind utilities        | N/A         | Micro‑interactions and panel transitions            | Simple CSS/Tailwind keeps bundle light while enabling polished interactions.                 |
| Dev Tools          | Vite dev server + browser DevTools          | N/A         | Local debugging, HMR, network inspection            | Default Vite + browser tooling is sufficient for the current scope.                          |

---

## Project Structure

At a high level, the project structure for the frontend is:

```text
src/
  main.jsx                # Vite/React entry point
  App.jsx                 # Application shell and routing
  index.css               # Tailwind layers, theme tokens, global styles

  components/             # Feature and layout components
  ui/                     # Low‑level UI primitives (buttons, panels, etc.)
  contexts/               # React context providers (auth, settings, workspace, UI)
  hooks/                  # Reusable hooks (API, state, keyboard, etc.)
  lib/                    # Integration helpers and services (API client, Gemini, terminal)
  utils/                  # Pure utilities (formatting, parsing, config helpers)
```

Guidelines:

- Place **reusable, domain‑aware UI** in `src/components/` (e.g. `Sidebar`, `MainContent`, chat panels, editors).
- Place **generic UI primitives** (buttons, modals, layout helpers) in `src/ui/` and prefer TypeScript (`.tsx`) here first.
- Place **cross‑cutting state** in `contexts/` with matching `hooks/` wrappers.
- Place **integration logic** with external systems and protocols under `lib/` (e.g. HTTP client, WebSocket helpers).
- Keep `utils/` limited to pure functions without side effects.

New files and refactors should default to **TypeScript** (`.ts`/`.tsx`), starting with:

- `src/ui/` (small, reusable primitives),
- `src/contexts/` and `src/hooks/` (shared state and access patterns),
- `src/lib/` (API client and services).

---

## State Management

State is managed with **React Context + hooks**, grouped by domain. No global state library is required at current scale.

### Store Structure

Recommended structure:

```text
src/
  contexts/
    AuthContext.tsx         # Auth/user session state
    SettingsContext.tsx     # Theme, UI preferences, feature flags
    WorkspaceContext.tsx    # Current project/session, files, tabs
    UIContext.tsx           # Panel layout, modals, toasts, transient UI state

  hooks/
    useAuth.ts              # Typed wrappers around AuthContext
    useSettings.ts
    useWorkspace.ts
    useUI.ts
```

Key rules:

- Components should consume shared state via **hooks**, not by importing contexts directly.
- Each context defines an explicit **state type** and a minimal **update API**.
- Cross‑concern or derived state belongs in hooks (e.g. `useCurrentSession()`).

### Example State Management Template (TypeScript)

```ts
// src/contexts/SettingsContext.tsx
import React, { createContext, useContext, useState } from "react";

export type Theme = "light" | "dark" | "system";

export interface SettingsState {
  theme: Theme;
  compactMode: boolean;
}

const defaultSettings: SettingsState = {
  theme: "system",
  compactMode: false,
};

interface SettingsContextValue {
  settings: SettingsState;
  setSettings(next: SettingsState): void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const SettingsProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
```

### Rationale

- Builds on existing React hooks patterns, avoiding premature introduction of Redux/Zustand.
- Domain‑based contexts (`Auth`, `Settings`, `Workspace`, `UI`) make state discoverable and predictable.
- TypeScript in the state layer provides strong contracts for AI/dev agents and catches misuse early.
- The `useX` hook pattern makes it easy to swap context implementation later (e.g. to a store library) without changing call sites.

---

## API Integration

HTTP API access is centralized through a small typed client and domain‑specific service modules. UI components and hooks **never call `fetch` directly**.

### Structure

```text
src/
  lib/
    apiClient.ts           # Shared HTTP client (base URL, JSON helpers, errors)
    services/
      authService.ts       # Auth/login/logout/session
      sessionService.ts    # Chat and workspace sessions
      filesService.ts      # Files, file trees, uploads
      settingsService.ts   # User and tool settings
      // ...other domain services
```

Streaming, terminals, and other realtime features are handled by dedicated modules (e.g. `terminalClient`, `chatStream`) and **not mixed into the HTTP client**.

### API Client Template

```ts
// src/lib/apiClient.ts

export class APIError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string
  ) {
    super(message ?? `API error ${status}`);
  }
}

function getBaseUrl(): string {
  const env = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return env ?? "/api";
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("Content-Type") ?? "";

  if (!res.ok) {
    const body = contentType.includes("application/json") ? await res.json() : await res.text();
    throw new APIError(res.status, body);
  }

  if (res.status === 204) {
    // No content
    return undefined as unknown as T;
  }

  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }

  // Fallback to text for non‑JSON
  return (await res.text()) as unknown as T;
}

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    method: "GET",
    headers: {
      ...(init.headers ?? {}),
    },
  });
  return handleResponse<T>(res);
}

export async function apiPost<T, B = unknown>(path: string, body: B, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}
```

### Example Service

```ts
// src/lib/services/sessionService.ts
import { apiGet, apiPost } from "../apiClient";

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export function fetchSessions(): Promise<Session[]> {
  return apiGet<Session[]>("/sessions");
}

export function createSession(projectName: string, title?: string): Promise<Session> {
  return apiPost<Session, { projectName: string; title?: string }>("/sessions", { projectName, title });
}
```

### Rationale

- Centralizing HTTP concerns in `apiClient` ensures consistent base URL, error handling, and content handling.
- Thin, typed `services` modules keep domain APIs discoverable and easy to reuse.
- Separating streaming/WebSocket clients from HTTP avoids tight coupling and keeps patterns clear.

---

## Routing

Routing uses **React Router DOM v6** with a small set of routes reflecting the core workspace mental model.

### Current Routes

- `"/"` – Main workspace view with sidebar and content; no specific session selected.
- `"/session/:sessionId"` – Same workspace layout, but focused on a particular session based on URL param.

These routes are implemented in `App.jsx` using a `Router` at the root and an `AppContent` component that reads `sessionId` from `useParams`.

### Principles

- Treat the URL as **part of the UI state**:
  - Selecting a session navigates to `"/session/:sessionId"`.
  - Clearing or deleting a session navigates back to `"/"`.
- Keep a **single workspace layout** component (`AppContent`) reused across routes to avoid duplication.
- Reserve room for future routes (e.g. `"/settings"`, `"/login"`, `"/about"`) but only add them when required by the product.

### Rationale

- A small route surface matches the “one main workspace” mental model of the tool.
- URL‑driven session selection enables deep links, bookmarks, and more robust “resume work” scenarios.
- Reusing `AppContent` across routes minimizes layout duplication and divergence.

---

## Styling Guidelines

Styling combines **Tailwind CSS** utility classes with a **CSS variable‑driven theme system** in `src/index.css`.

### Styling Approach

- Tailwind utility classes are the **primary** way to style components.
- `src/index.css` defines:
  - Tailwind layers (`@tailwind base; @tailwind components; @tailwind utilities;`).
  - CSS custom properties for color, spacing, and theme tokens under `:root` and `.dark`.
  - Utility classes for Gemini‑branded gradients, shadows, glassmorphism, and animations (e.g. `.gemini-gradient`, `.gemini-shadow`, `.gemini-glass`).
  - Global layout and stability rules (scrollbars, animations, chat message layout).
- Dark mode is implemented via toggling the `.dark` class on a root element and reading from the same variable set.

### Global Theme Variables

The theme system is defined via HSL components (for Tailwind compatibility) in `index.css`. Examples:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 192 91% 36%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --border: 214.3 31.8% 91.4%;
    --ring: 192 91% 36%;
    --radius: 0.5rem;

    --gemini-accent: 186 90% 43%;
    --gemini-accent-2: 192 91% 36%;
    --gemini-accent-3: 195 88% 31%;
    --gemini-accent-rgb: 6 182 212;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 217.2 91.2% 8%;
    --card-foreground: 210 40% 98%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --ring: 192 91% 46%;

    --gemini-accent: 186 90% 43%;
    --gemini-accent-2: 192 91% 46%;
    --gemini-accent-3: 195 88% 31%;
    --gemini-accent-rgb: 6 182 212;
  }
}
```

### Rationale

- Tailwind utilities + CSS variables combine fast iteration with a consistent visual language.
- Centralized Gemini‑specific classes avoid duplicated gradient/shadow definitions across components.
- Dark mode is first‑class and shares the same structural layout, minimizing layout shift between themes.

---

## Testing Requirements

Testing should focus on safeguarding the **core user flows** (chat, file navigation, settings, terminal) with a pragmatic mix of unit, integration, and E2E tests.

### Recommended Tooling

- **Unit/Integration Tests:** Vitest + React Testing Library
  - Good fit for Vite and React, minimal configuration.
  - Encourages tests that assert **user‑visible behavior** instead of implementation details.
- **E2E Tests:** Playwright (or Cypress)
  - Validate the end‑to‑end developer experience:
    - Logging in or initial setup
    - Opening a project
    - Starting a session and sending a prompt
    - Viewing model responses, file tree updates, and terminal output

### Component Test Template

```ts
// test/components/Sidebar.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Sidebar from "../../src/components/Sidebar";

describe("Sidebar", () => {
  it("shows project list", () => {
    render(
      <Sidebar
        projects={[{ name: "demo", sessions: [], sessionMeta: {} }]}
        selectedProject={null}
        selectedSession={null}
        onProjectSelect={() => {}}
        onSessionSelect={() => {}}
        onNewSession={() => {}}
        onSessionDelete={() => {}}
        onProjectDelete={() => {}}
        isLoading={false}
        onRefresh={() => {}}
        onShowSettings={() => {}}
        updateAvailable={false}
        latestVersion=""
        currentVersion=""
        onShowVersionModal={() => {}}
      />
    );
    expect(screen.getByText("demo")).toBeInTheDocument();
  });
});
```

### Rationale

- Vitest integrates tightly with Vite and keeps the configuration surface small.
- React Testing Library encourages tests that mirror how a human uses the UI.
- A small, focused E2E suite catches regressions across routing, state, and API integration.

---

## Environment Configuration

Frontend configuration uses **Vite environment variables** that are prefixed with `VITE_` and read via `import.meta.env`.

### Recommended Variables

Defined in `.env`, `.env.local`, or environment‑specific variants:

```env
VITE_API_BASE_URL=http://localhost:5174/api
VITE_WS_BASE_URL=ws://localhost:5174
VITE_DEFAULT_MODEL=gemini-1.5-pro
VITE_TELEMETRY_ENABLED=false
VITE_APP_ENV=development
```

Descriptions:

- `VITE_API_BASE_URL` – Base URL for HTTP API requests (used by `apiClient`).
- `VITE_WS_BASE_URL` – Base URL for WebSocket connections (terminal, live updates).
- `VITE_DEFAULT_MODEL` – Default model shown/used in the UI.
- `VITE_TELEMETRY_ENABLED` – `"true"`/`"false"` flag to enable/disable telemetry.
- `VITE_APP_ENV` – `"development" | "staging" | "production"` to gate environment‑specific features.

### Rationale

- Using `VITE_*` ensures only intended values are exposed to the frontend.
- Splitting HTTP and WS URLs makes it easy to move realtime traffic to dedicated infrastructure later.
- `VITE_APP_ENV` standardizes environment checks instead of scattering ad‑hoc conditionals.

---

## Frontend Developer Standards

These standards guide day‑to‑day frontend work, especially by AI assistants and new contributors.

### Critical Coding Rules

- Prefer **TypeScript** for all new modules (`.ts`/`.tsx`), especially in `contexts/`, `hooks/`, `lib/`, and `ui/`.
- Keep **side effects at the edges**:
  - Components render UI and call hooks/services.
  - API calls and WebSocket setup live in `lib/` (not inline in JSX).
- Use **contexts + hooks** for shared state:
  - Auth, settings, workspace, and UI state must go through documented contexts.
  - Do not introduce custom global singletons or event buses.
- Never bypass the **API service layer**:
  - All HTTP requests go through `apiClient` + `services`.
  - All WebSocket/terminal connections go through dedicated client modules.
- Respect the **design tokens and theme system**:
  - Use Tailwind classes that map to `--background`, `--foreground`, `--card`, etc.
  - Use `.gemini-*` helpers for gradients, shadows, and glassmorphism instead of raw hex codes.
- Maintain **layout stability**:
  - Avoid introducing new layout shifts in chat/terminal views.
  - Preserve scroll behavior and input focus where possible during updates.
- Error handling:
  - Surface clear, actionable messages for user‑visible errors.
  - Avoid silent failures; log meaningful context to the console for debugging.

### Quick Reference

**Commands**

- Dev server: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Backend server only: `npm run server`

**File Patterns**

- Components: `src/components/FooPanel.jsx` → new code: `src/components/FooPanel.tsx`
- UI primitives: `src/ui/Button.tsx`, `src/ui/Panel.tsx`
- Contexts: `src/contexts/ThingContext.tsx`
- Hooks: `src/hooks/useThing.ts`
- Services: `src/lib/services/thingService.ts`

**Imports**

- React: `import React from "react";` or `import { useState } from "react";`
- Router: `import { Routes, Route, useNavigate, useParams } from "react-router-dom";`
- Styling: Tailwind classes in `className`, Gemini‑specific effects via `.gemini-*` utilities.

### Rationale

- Codifies existing patterns in `gemini-cli-ui` and makes them explicit for AI/dev agents.
- Encourages incremental improvements (TypeScript adoption, better structure) without forcing rewrites.
- Keeps the focus on a stable, polished developer experience for the Gemini CLI UI.

