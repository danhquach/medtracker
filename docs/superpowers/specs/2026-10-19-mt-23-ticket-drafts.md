# MT-23 sub-issue drafts (NOT FILED)

Draft status: these are not filed yet; they wait for approval. Issue numbers get assigned when they're filed. A is filed first, so B–E can reference it.
The titles follow the repo convention `MT-<n>: …`.

---

## A — MT-?: App shell: predictable navigation and one visual system

## Parent issue

MT-23

## What's wrong

- Sub-screens aren't real pages: Add/Edit med, a med's history and the guest sign-in in Settings. Phone Back leaves the screen and loses form input.
- The header always says "MedTracker". When Settings is open, no tab is highlighted and there's no back control.
- While data loads, the screen is blank.
- "Selected", "done" and "primary action" all share the same red fill. Delete buttons look like every other button.
- The tab bar is text only, its active colours fail AA contrast, and it sits under the phone's home indicator.
- The browser tab shows the Vite logo.
- Empty, loading and error states differ across screens. Meds has no Retry when loading fails.

## What I expected

- Every screen has its own address, and phone Back always returns to the previous screen.
- The header shows the current screen's title, with a back arrow on sub-screens such as Settings.
- One set of colours separates primary, selected, success, warning and danger, all at AA contrast.
- Tabs show an icon and a label, and clear the home indicator.
- Every screen shows the same loading, empty (with a next step) and error-with-Retry patterns, in friendly wording.

## Steps to reproduce

1. On an Android phone, open Meds → + Add, type a name, then press the system Back button. The form is lost and you leave the screen.
2. Open Settings from the ⚙ in the header. No tab is active and there's no back control.
3. Check the active tab colours with a contrast checker: about 3.4:1.
4. On a phone with a home indicator, the tab bar sits under it.

## Blocked by

None. Can start immediately.

## Additional context

Folds in all of MT-8 and MT-12's first item (no Retry on Meds). MT-8 notes that colours are a design call, so confirm the palette with the owner first.

---

## B — MT-?: Today: what's due first, one-tap Taken with undo

## Parent issue

MT-23

## What's wrong

- Doses can sit below the fold, under the guest banner, the notifications banner and low-stock chips.
- The title stays "Today" while another day is viewed.
- Taken and Skip have equal weight. After Taken, the dose vanishes into a collapsed "Resolved" list with no confirmation or undo.
- Statuses show as lowercase words ("taken", "missed").
- There's no summary of how the day is going.
- Low-stock warnings can't be acted on.
- A new user with no meds sees "Nothing scheduled" and no way to add one.

## What I expected

- The title shows the selected date.
- Doses come right after the week strip, with a short progress line (e.g. "2 of 4 taken").
- Taken is the clear primary action, and one tap confirms it with "Taken 9:02 AM · Undo".
- Banners and refill warnings merge into one compact card below the doses, and each links to its fix.
- The empty state offers "Add a med".

## Steps to reproduce

1. Continue as a guest with notifications off, then add a daily med with a low stock.
2. Open Today. The doses are pushed down by two banners and a chip.
3. Tap Taken. The row disappears with no confirmation and no undo.
4. Tap another day in the week strip. The title still says "Today".

## Blocked by

- A (uses its colours and state components)

## Additional context

The owner should decide the undo behaviour: a short timed undo is recommended.

---

## C — MT-?: Meds: quick add and clearer med cards

## Parent issue

MT-23

## What's wrong

- Add med shows 12+ fields at once. Only the name and a time are needed.
- Errors appear only at the bottom, not next to the field.
- Save sits at the end of a long page.
- Saving gives no confirmation and no hint of when the first reminder comes.
- Each med card shows up to five equal buttons, with Delete right next to Edit.
- A paused med's Pause button turns red, so it looks active.
- Stock always says "pills", even for liquids.
- The name suggestion list doesn't close with Escape or when you leave the field.

## What I expected

- Add med leads with Name, How often and Time. Strength, form, notes, stock and refill sit under "More details".
- Errors show beside the field they belong to, and Save is always reachable.
- After saving: "Added. Next dose today 9:00 AM".
- A card shows its main action (Edit, or Log dose for as-needed meds). Other actions sit in a menu, and Delete is clearly marked as destructive.
- Stock uses a unit that fits the form.
- The suggestion list closes on Escape or blur.

## Steps to reproduce

1. Meds → + Add. Count the fields before Save.
2. Leave Name empty and tap Save. The error appears at the bottom of the page.
3. Save a valid med. There's no confirmation.
4. On a card, note Edit and Delete side by side at equal weight.
5. Type "ibu" in Name and press Escape. The list stays open.

## Blocked by

- A (form routes, colours)

## Additional context

Folds in MT-12's suggestion-list item.

---

## D — MT-?: History: readable at a glance

## Parent issue

MT-23

## What's wrong

- The 7-day grid uses bare symbols (✓ – ✗ ·), all in one colour, with no legend.
- Day headers are single letters, so T/T and S/S can't be told apart.
- Paused meds drop out of History entirely, past doses included.
- You can't get from a dose on Today to that med's history.

## What I expected

- Each status uses an icon, a colour and an accessible label, and a legend sits under the grid.
- Day headers show a short weekday plus the date.
- Paused meds still show their past doses, marked as paused.
- A med's history is reachable from its card and from Today.

## Steps to reproduce

1. Add two meds, then over a few days mark one dose Taken, skip one and let one go missed.
2. Open History. Statuses are hard to tell apart and days are ambiguous.
3. Pause a med. It disappears from History.

## Blocked by

- A (status colours, med-history route)

## Additional context

None.

---

## E — MT-?: Settings and Welcome: consistent saving and an easy start

## Parent issue

MT-23

## What's wrong

- Settings: the nickname needs its own Save button while other settings save on change, and nothing confirms a save.
- Time zone is a raw list of about 400 zone IDs.
- "Send test notification" shows even when notifications are unsupported or blocked.
- Delete account doesn't move keyboard focus, and isn't marked as dangerous. Busy toggles don't announce their state to screen readers.
- The guest banner's "Create profile" opens Settings at a menu, so you tap "Create profile" a second time.
- Welcome: the quickest start (no profile) is the last, least prominent button. The password minimum isn't stated up front. After sign-up, "Check your email to confirm" is a dead end. The app says "profile" in some places and "account" in others.

## What I expected

- Every setting saves the same way and shows "Saved".
- Time zone is detected and searchable.
- Notification controls show only what works on this device.
- Delete account sits in a separate danger section, as a proper dialog that moves and holds focus.
- "Create profile" from the banner opens the form directly.
- Welcome makes the fastest start obvious, states the password rules, and offers "Back to sign in" after sign-up.
- One word is used throughout ("profile" or "account").

## Steps to reproduce

1. Open Welcome. The guest option is last.
2. Create a profile with a 6-character password. The rule only appears on submit.
3. After sign-up, the confirmation notice offers no way back.
4. As a guest, tap "Create profile" on the Today banner. You land on Settings and must tap it again.
5. In Settings, change the nickname without tapping Save nickname, then leave. The change is lost.
6. Open Delete account using the keyboard only. Focus doesn't move to it.

## Blocked by

- A (colours, Settings back navigation, state components)

## Additional context

Folds in MT-12's dialog-focus and busy-toggle items. Whether the Welcome screen leads with the guest option is an owner decision.
