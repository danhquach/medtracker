# Shared components

Every screen builds its UI from the pieces in `src/components/`, so behaviour, accessibility and styling are defined once ([#87](https://github.com/danhquach/medtracker/issues/87)). Styles live in `src/theme.css`.

## What exists

| Need | Use | File |
|---|---|---|
| Any button | `Button` (`variant`: default, primary, quiet, link, danger, icon, fab; `busy` while an action runs) | `Button.tsx` |
| Labelled input / select with hint and error | `TextField`, `NumberField`, `TimeField`, `DateField`, `SelectField`, `FieldError` | `Field.tsx` |
| One item in a list | `Card` | `layout.tsx` |
| Settings-style rows | `RowGroup` + `Row` (`name`, `desc`, `htmlFor`, `wide`) | `layout.tsx` |
| Small label ("Paused", "12 tablets left") | `Chip` | `layout.tsx` |
| Screen- or form-level message | `Notice` (`tone`: info, warning, error) | `layout.tsx` |
| Loading / nothing yet | `Loading`, `Empty` | `states.tsx` |
| "Are you sure?" | `useConfirm()` for a yes/no; `ConfirmDialog` when the dialog needs its own content | `useConfirm.tsx`, `ConfirmDialog.tsx` |
| Icons | `CheckIcon`, `PillIcon`, … (decorative: always pair with text or `aria-label`) | `icons.tsx` |

Never use a raw `<button>`, a hand-rolled label/input pair, or `window.confirm` in a screen.

## Add or change a component

1. **Check the table first.** If an existing piece is close, add a prop or variant to it instead of a new component.
2. **Put it in `src/components/<Name>.tsx`** as a named export, with a one-line comment saying what it is for. Pass the remaining props through (`...rest`) so callers keep native attributes.
3. **Build accessibility in.** Labels, `aria-*` wiring and focus handling belong in the component, not in each caller. Make required accessible names required props (as `Button`'s `icon` variant does with `aria-label`).
4. **Style it in `src/theme.css`** using the existing tokens, not inline styles.
5. **Test it** in `src/components/<Name>.test.tsx`: what the user sees and how it is announced, not its internals.
6. **Switch every screen** that hand-builds the same thing to the new piece in the same PR, so the app never has two versions.

## Screens

Keep each screen a thin composition: one component per section or view in its feature folder (e.g. `features/settings/RemindersSection.tsx`, `features/history/MonthView.tsx`). A section owns its own handlers and reports errors up through a callback such as `onError`.
