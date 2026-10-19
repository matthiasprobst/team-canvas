# TC-006: Build the English application shell with Tailwind and routed screens

Status: In progress

Dependencies: None

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a user, I want a consistent, accessible interface that makes it clear where I am and how to move between my canvases.

## Implementation checklist

- [x] Use the approved dashboard concept linked in the feature index as the visual reference. Build white surfaces, restrained blue accents, slate text, compact cards, and clear focus states using reusable Tailwind tokens and components.
- [x] Integrate Tailwind’s Vite plugin. Scope application base styles and avoid global resets or overrides that alter Excalidraw’s controls.
- [x] Introduce React Router with a public /login screen, authenticated dashboard at /, and editor route /b/:id. Provide loading, access-denied, retry, and not-found handling.
- [x] Add dashboard navigation for All canvases, My canvases, and Shared with me, plus account name and Sign out. On small screens collapse navigation into an accessible menu.
- [x] Create accessible shared dialogs, form controls, menus, search controls, and canvas-card components. Support keyboard navigation, focus trapping/restoration, clear validation, and reduced motion.
- [x] Lazy-load the editor and Excalidraw styles so dashboard/sign-in do not eagerly load the heavy editor bundle.
- [x] Translate application controls, messages, validation errors, and Excalidraw configuration to English. Keep protocol error codes stable when translating messages.

## Acceptance criteria

- [ ] The populated desktop dashboard matches the approved concept’s navigation, spacing, hierarchy, typography, and restrained palette.
- [ ] Mobile navigation and the single-column card layout work without horizontal overflow.
- [ ] Dialogs, menus, search, and navigation work with keyboard alone and expose accessible names/focus states.
- [ ] Dashboard and sign-in routes do not eagerly load Excalidraw; opening an editor loads it successfully.
- [ ] Existing editor controls remain visually usable after Tailwind integration.
- [x] Application-facing text is consistently English.

## Validation

Build/type-check the frontend and perform desktop/mobile browser checks. Compare the rendered dashboard against the approved image. Inspect keyboard focus, dialog behavior, reduced motion, network loading, and Excalidraw CSS isolation. Auth/data wiring is completed in dependent tickets.

## Completion notes

Added Tailwind theme/utilities without Preflight, scoped shell controls, React Router, account/sidebar navigation, native accessible dialogs, English messages, reduced-motion handling, and lazy editor/CSS loading. Frontend type-check/build passes. Runtime keyboard, editor CSS, mobile, and visual comparison checks are blocked by Chromium launch restrictions.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
