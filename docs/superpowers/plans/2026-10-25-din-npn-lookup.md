# Add Med by DIN/NPN (type or scan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Med gets a "DIN or NPN" row: type the 8 digits or (Android) photograph the label, and the form fills from a bundled copy of Health Canada's product lists. The user must tick "I've checked…" before Save.

**Architecture:** A manual Node script turns Health Canada's DPD extract and LNHPD API into two committed JSON files under `public/products/` plus a generated `dataVersion.ts`. The app fetches each list from its own origin on first focus of the new field. A service-worker CacheFirst route keeps the lists for offline use. Lookup is a pure exact-match function. Scanning is a small custom Capacitor plugin: system camera intent → bundled ML Kit text recognition → raw text blocks back to JS. Candidate extraction and all UI rules live in TypeScript.

**Tech Stack:** React 19, TypeScript, Vite 8 PWA (injectManifest, `src/sw.ts`), Workbox 7.4.1, Vitest + Testing Library, Capacitor 8 Android (Java plugin like `TapHapticsPlugin`), ML Kit Text Recognition (bundled Latin model).

**Spec:** `docs/superpowers/specs/2026-10-25-din-npn-lookup-design.md`

## Global Constraints

- No call to Health Canada or any third party at use time. The only fetch is `appUrl('products/<list>.json?v=<generatedAt>')` (`src/lib/basePath.ts`).
- Supabase is production. No migrations, no new RPCs. `tests/guard.ts` stays in force. Integration and e2e suites are not run.
- New runtime deps allowed: `workbox-strategies@7.4.1` and `workbox-expiration@7.4.1` (same version as `workbox-routing`). Android: `com.google.mlkit:text-recognition` (bundled; latest stable, pin the exact version). Nothing else.
- ML Kit must be the **bundled** artifact `com.google.mlkit:text-recognition`, never `com.google.android.gms:play-services-mlkit-text-recognition`.
- Copy, verbatim from the spec:
  - Field label `DIN or NPN (on the label)`; button `📷 Scan`; divider `or search by name`.
  - Banner: `⚠️ Filled from {DIN|NPN} {number}. Please check every detail against your label before saving. The number or the product details may be wrong or out of date.` The first two sentences are bold.
  - Scan add-on: `The number was read by the camera, so compare the digits with the label too.`
  - Discontinued add-on: `This product is marked discontinued by Health Canada.`
  - Tick: `I've checked these details against the label.`; hint: `Tick to confirm before saving`.
  - No match: `No product found for {number}. Check the number or add by name.`
  - Not downloaded: `Product data hasn't downloaded yet. Connect once to enable lookup.`
  - NPN not shipped: `NPN lookup isn't available yet. Add by name for now.`
  - Scan, none found: `Couldn't find an 8-digit DIN/NPN in the photo.`; one: `Read: {dddd dddd}. Does this match the label?` with `Use` / `Retake`; several: `Which number is on the label next to DIN/NPN?`
  - About: `Product data as of {generatedAt}. Contains information licensed under the Open Government Licence – Canada.`
- The DIN/NPN row shows in add mode only (`!med`). Add-by-name behaviour is unchanged.
- Scan button only when `Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LabelScan')`.
- Test numbers are made up (`80012345`, `02242963`) or taken from the public Health Canada data. No user data in fixtures (public repo).
- Worktree: `.claude/worktrees/din-npn-design` on branch `docs/din-npn-lookup-design`. Symlink `node_modules` from the main checkout. Commit with explicit paths. Don't push until the owner asks.
- Pixel testing: mock-mode APK over adb. **Never force-stop the app** (it wipes alarms).

## Review Focus

1. **Pasted or spaced numbers** ("DIN 0224 2963", "8001-2345"): keep only the digits, cap at 8, never drop a leading zero. Test: Task 4 `pasting a spaced number keeps the 8 digits with leading zero`.
2. **8 digits typed before the list finishes downloading** (first focus, slow network): the lookup waits for the load, never reports "No product found" early. Test: Task 2 `lookup waits for an in-flight load`.
3. **First use while offline:** shows "Product data hasn't downloaded yet…", not "No product found". Test: Task 2 `fetch failure yields unavailable` + Task 4 `offline first use shows not-downloaded message`.
4. **Hand-edited field, then the number is cleared:** the edited field stays, untouched "from label" fields clear, Save re-enables. Test: Task 5 `clearing the number clears only untouched label fields`.
5. **OCR quirks** (digits split "8001 2345", a lot/expiry number next to the NPN, letter O read for 0): spaced groups join, the number next to DIN/NPN ranks first, and letters are never converted into digits. Test: Task 6 `findCandidates` cases.

---

### Task 1: Product data build script

**Files:**
- Create: `scripts/build-product-data.mjs`
- Create: `scripts/build-product-data.test.ts`
- Create (generated, committed): `public/products/din.json`, `public/products/npn.json` (if buildable), `src/features/dinLookup/dataVersion.ts`

**Interfaces:**
- Produces (JSON file shape, both lists):
  ```ts
  type ProductRow = { name: string; form: 'tablet' | 'capsule' | 'liquid' | 'other'; strength: string; discontinued: boolean }
  type ProductFile = { generatedAt: string /* YYYY-MM-DD */; products: Record<string /* 8 digits */, ProductRow> }
  ```
- Produces `src/features/dinLookup/dataVersion.ts` (generated, with a header comment saying so):
  `export const PRODUCT_DATA: { generatedAt: string; lists: ('din' | 'npn')[] }`
- Exported pure functions from the `.mjs` (unit-tested):
  - `parseCsvLine(line: string): string[]`: quoted CSV, `""` escapes.
  - `mapForm(text: string): 'tablet' | 'capsule' | 'liquid' | 'other'`: case-insensitive. Contains `tablet`/`chewable`/`caplet` → tablet; `capsule` → capsule; `liquid|solution|syrup|suspension|drops|elixir` → liquid; else other.
  - `formatStrength(ings: { name: string; strength: string; unit: string }[]): string`: one ingredient → `"500 mg"`; several → `"Glucosamine sulfate 500 mg, Chondroitin sulfate 400 mg"` in source order. Trim, and drop empty strength or unit parts.
  - `pickDpdRow(rows: { status: string; statusDate: string }[]): number`: index of the winner. Rank `MARKETED > APPROVED > DORMANT > CANCELLED*` (any status starting `CANCELLED`), tie → latest `statusDate`.
  - `buildDin(files: { drug: string[][]; status: string[][]; form: string[][]; ingred: string[][] }): Record<string, ProductRow>`
  - `buildNpn(licences: object[], ingredients: object[]): Record<string, ProductRow>`
- `main()` (only when run directly): downloads, builds, and writes the three outputs atomically (write `.tmp`, then rename). It exits non-zero on any fetch error and leaves the existing files untouched. If NPN fails, the script still writes DIN when run with `--din-only`, and `lists` = `['din']`.

- [ ] **Step 1: Probe the sources** (no code): download the DPD extracts (marketed `allfiles.zip`, approved `allfiles_ap.zip`, dormant `allfiles_dr.zip`, inactive `allfiles_ia.zip` from Health Canada's extract page in the spec) and record the column order of `drug*.txt`, `status*.txt`, `form*.txt`, `ingred*.txt` from the "read file" page. Probe `https://health-products.canada.ca/api/natural-licences/ProductLicence/?lang=en&type=json&page=1` and `MedicinalIngredient`: record the pagination shape and field names (NPN, name, dosage form, status, ingredient name/quantity/unit, join key). Write the findings as a comment block at the top of the script. If LNHPD still returns 503, continue DIN-only (spec §8.1 fallback) and say so in the task report.
- [ ] **Step 2: Write failing tests** in `scripts/build-product-data.test.ts` (`// @vitest-environment node`), with tiny fixture arrays built per Step 1's column order:
  - `parseCsvLine handles quotes and escaped quotes`
  - `mapForm maps "TABLET (EXTENDED-RELEASE)" to tablet, "Capsule" to capsule, "SYRUP" to liquid, "CREAM" to other`
  - `formatStrength single ingredient is "500 mg"` and `formatStrength combo lists each ingredient`
  - `pickDpdRow prefers MARKETED over newer CANCELLED POST MARKET`, `pickDpdRow breaks a tie by latest date`
  - `buildDin keeps leading zeros in keys` (`'02242963'` present)
  - `buildDin marks a cancelled-only DIN discontinued`
  - `buildNpn keys by 8-digit NPN and maps form and strength`
- [ ] **Step 3: Run** `npx vitest run scripts/build-product-data.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** the exports and `main()`. Unzip with `execFileSync('unzip', ['-p', zip, name])`. Only Node built-ins. Page LNHPD with retries (3 attempts, 2 s backoff) and fail the run on a persistent error.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Run** `node scripts/build-product-data.mjs` (or `--din-only`). Record the row counts and the gzipped size of each file (`gzip -c public/products/din.json | wc -c`). **If either is over 5 MB gzipped, stop and report to the owner** (spec §6.3). Spot-check a few public DINs/NPNs against Health Canada's website.
- [ ] **Step 7: Commit** script, test, both JSON files and `dataVersion.ts`: `feat: build bundled DIN/NPN product data from Health Canada open data`.

### Task 2: Product list loading and lookup

**Files:**
- Create: `src/features/dinLookup/lookup.ts`, `src/features/dinLookup/lookup.test.ts`
- Create: `src/features/dinLookup/useProductLists.ts`, `src/features/dinLookup/useProductLists.test.ts`

**Interfaces:**
- Consumes: `ProductRow`, `ProductFile`, `PRODUCT_DATA` (Task 1); `appUrl` from `src/lib/basePath.ts`.
- Produces:
  ```ts
  export type ListKind = 'din' | 'npn'
  export type Product = ProductRow & { number: string; kind: 'DIN' | 'NPN' }
  export type ListState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; products: Record<string, ProductRow> }
  export type LookupResult =
    | { status: 'match'; products: Product[] }   // 1 normally; 2 if both lists match
    | { status: 'none' } | { status: 'unavailable' } | { status: 'npn-unavailable' }
  export function productDataUrl(kind: ListKind): string          // appUrl(`products/${kind}.json?v=${PRODUCT_DATA.generatedAt}`)
  export function lookupProduct(number: string, lists: Record<ListKind, ListState>, shipped: ListKind[]): LookupResult
  export function useProductLists(): { lists: Record<ListKind, ListState>; ensure(): Promise<Record<ListKind, ListState>> }
  ```
- `lookupProduct` rules: exact key match in each ready list (DIN first). Matches → `match`. No match, and any shipped list is not `ready` → `unavailable`. No match, all shipped lists ready, `npn` not in `shipped` → `npn-unavailable`. Otherwise `none`.
- `ensure()` starts loading every shipped list that is `idle` or `error` and resolves when none is `loading`. Concurrent calls share one in-flight fetch.

- [ ] **Step 1: Write failing tests:**
  - `lookup.test.ts`: `exact match returns the DIN product with kind DIN`, `leading-zero key matches`, `no fuzzy match for one wrong digit`, `both lists match returns two products`, `list not ready yields unavailable`, `npn not shipped yields npn-unavailable`, `productDataUrl carries the version`.
  - `useProductLists.test.ts` (stub `fetch`): `ensure fetches each shipped list once`, `lookup waits for an in-flight load` (second `ensure()` resolves after the first fetch), `fetch failure yields unavailable` (state `error`, then `lookupProduct` → `unavailable`), `retry after error fetches again`.
- [ ] **Step 2: Run** `npx vitest run src/features/dinLookup`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. Module-level cache in `useProductLists` so remounting the form doesn't refetch.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: offline DIN/NPN lookup over bundled product lists`.

### Task 3: Service-worker cache for product data

**Files:**
- Modify: `src/sw.ts` (add a route after the `NavigationRoute`)
- Create: `src/features/dinLookup/swRoute.ts`, `src/features/dinLookup/swRoute.test.ts`
- Modify: `package.json`, `package-lock.json` (`workbox-strategies`, `workbox-expiration` @7.4.1)

**Interfaces:**
- Produces: `export function isProductDataUrl(url: URL, scope: string): boolean`. True only for same-origin `${scope}products/(din|npn).json` with any query.
- `sw.ts`: `registerRoute(({ url }) => isProductDataUrl(url, sw.registration.scope), new CacheFirst({ cacheName: 'product-data', plugins: [new ExpirationPlugin({ maxEntries: 2 })] }))`. Each version is its own URL (`?v=`), so a new data release is fetched fresh and the oldest entries are evicted.

- [ ] **Step 1: Write failing tests:** `matches din.json and npn.json under the scope with ?v`, `rejects other origins`, `rejects other paths under /products/`, `respects a /medtracker/ scope`.
- [ ] **Step 2: Run** `npx vitest run src/features/dinLookup/swRoute.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `isProductDataUrl`, install the two deps, and register the route.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, and the build succeeds (the JSON is not in the precache manifest: `grep -c products dist/sw.js` finds only the route code, not `din.json` entries).
- [ ] **Step 5: Commit** `feat: cache product data in the service worker for offline lookup`.

### Task 4: DIN/NPN field (typed flow)

**Files:**
- Create: `src/features/meds/DinNpnField.tsx`, `src/features/meds/DinNpnField.test.tsx`

**Interfaces:**
- Consumes: `useProductLists`, `lookupProduct`, `Product`, `PRODUCT_DATA.lists` (Task 2).
- Produces:
  ```tsx
  export default function DinNpnField(props: {
    value: string
    onChange: (digits: string) => void            // sanitized digits, ≤ 8
    onMatch: (p: Product, viaScan: boolean) => void
    onScan?: () => Promise<ScanResult>             // Task 6 provides (scanLabel); undefined → no Scan button
  }): JSX.Element
  ```
- Behaviour: label `DIN or NPN (on the label)`, `inputMode="numeric"`, `autoComplete="off"`. `onChange` strips non-digits and caps at 8. Focus calls `ensure()`. At 8 digits: `await ensure()` then `lookupProduct`. One match → `onMatch`. Two matches → buttons `{kind} · {name}`, and picking one calls `onMatch`. `none` / `unavailable` / `npn-unavailable` → the Global Constraints copy in a `role="status"` element. Below the row, the `or search by name` divider.

- [ ] **Step 1: Write failing tests** (mock `../dinLookup/useProductLists`):
  - `pasting a spaced number keeps the 8 digits with leading zero` (`"DIN 0224 2963"` → `onChange('02242963')`)
  - `8 digits with a match calls onMatch once with viaScan false`
  - `unknown number shows no-product message and does not call onMatch`
  - `offline first use shows not-downloaded message`
  - `npn not shipped shows NPN-unavailable message`
  - `two matches show a chooser and picking one calls onMatch`
  - `no Scan button when onScan is undefined`
- [ ] **Step 2: Run** `npx vitest run src/features/meds/DinNpnField.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `DinNpnField.tsx`. Style with existing `theme.css` classes (`row`, `muted`, `field-error`) plus minimal new rules.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: DIN/NPN field with offline lookup on Add Med`.

### Task 5: MedForm prefill, banner, tick gate

**Files:**
- Modify: `src/features/meds/MedForm.tsx` (render `DinNpnField` above `NameAutocomplete` when `!med`; new state; Save `disabled`)
- Modify: `src/features/meds/MedForm.test.tsx`
- Modify: `src/theme.css` (`.from-label` highlight, `.label-banner`)

**Interfaces:**
- Consumes: `DinNpnField`, `Product` (Tasks 2, 4).
- New state in `MedForm`:
  ```ts
  type LabelFill = { number: string; kind: 'DIN' | 'NPN'; viaScan: boolean; discontinued: boolean
                     filled: { name: string; strength: string; form: string } }  // values as filled
  const [din, setDin] = useState('')
  const [labelFill, setLabelFill] = useState<LabelFill | null>(null)
  const [checked, setChecked] = useState(false)
  ```
- Rules (spec §6.1):
  - On `onMatch`: set name, strength and form; `setChips([])`; open `moreRef`; set `labelFill`; `setChecked(false)`.
  - A field is "from label" while its value still equals `labelFill.filled[field]`. Show the `.from-label` class and a `from label` tag.
  - Changing `din` while a fill exists unticks. Reaching 8 digits re-runs the lookup via `DinNpnField`.
  - `din` cleared to `''` with a fill: reset each field still equal to its filled value to `''`, then `setLabelFill(null)` and `setChecked(false)`.
  - Save `disabled={saving || (labelFill !== null && !checked)}`. The tick checkbox has `aria-describedby` → hint `Tick to confirm before saving`, shown only while unticked.
  - Banner (`role="status"`) shows only while `labelFill`, with scan/discontinued add-ons as per Global Constraints.

- [ ] **Step 1: Write failing tests** in `MedForm.test.tsx` (mock `../dinLookup/useProductLists` with one DIN and one NPN product):
  - `edit mode has no DIN/NPN field`
  - `a match fills name, strength and form and shows the banner with the number`
  - `Save is disabled until the tick is checked, then saves the filled values`
  - `the hint explains the disabled Save`
  - `changing the number after a fill unticks`
  - `clearing the number clears only untouched label fields` (edit Name first; after clearing, Name keeps the edit, Strength is `''`, Save is enabled)
  - `discontinued product adds the discontinued sentence`
  - `adding by name shows no tick and Save works as before` (existing tests stay green)
- [ ] **Step 2: Run** `npx vitest run src/features/meds/MedForm.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `MedForm.tsx` and `theme.css`.
- [ ] **Step 4: Run** `npm test && npm run lint && npx tsc --noEmit`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat: prefill Add Med from DIN/NPN with check-before-save gate`.

### Task 6: Label scan (Android plugin + candidate picking + UI)

**Files:**
- Create: `android/app/src/main/java/app/medtracker/android/LabelScanPlugin.java`
- Modify: `android/app/src/main/java/app/medtracker/android/MainActivity.java` (`registerPlugin(LabelScanPlugin.class)` next to TapHaptics)
- Modify: `android/app/build.gradle` (ML Kit bundled dependency)
- Create: `src/native/labelScan.ts`, `src/native/labelScan.test.ts`
- Create: `src/features/meds/ScanConfirm.tsx`; modify `DinNpnField.tsx`, `DinNpnField.test.tsx`, `MedForm.tsx` (pass `onScan` when available)

**Interfaces:**
- Native (`@CapacitorPlugin(name = "LabelScan")`), method `scan()`:
  - Create a temp file in `getContext().getCacheDir()`, get its URI from the existing `${applicationId}.fileprovider` (cache-path is already in `file_paths.xml`), and launch `MediaStore.ACTION_IMAGE_CAPTURE` via `startActivityForResult(call, intent, "onPhoto")`. No `CAMERA` permission.
  - In `@ActivityCallback onPhoto`: on cancel, resolve `{ cancelled: true }`. Otherwise `InputImage.fromFilePath`, run `TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)`, and resolve `{ cancelled: false, blocks: [{ text, lines: string[] }] }`.
  - **Delete the temp file in a `finally` on every path**, including errors.
- TS:
  ```ts
  export type ScanResult = { cancelled: true } | { cancelled: false; blocks: { text: string; lines: string[] }[] }
  export const canScanLabel: () => boolean                     // isNativePlatform && isPluginAvailable('LabelScan')
  export function scanLabel(): Promise<ScanResult>
  export function findCandidates(blocks: { text: string; lines: string[] }[]): string[]   // unique 8-digit strings, best first
  ```
- `findCandidates` rules: an 8-digit run is `\d{8}` or `\d{4}[ \-]\d{4}`, not part of a longer digit run. It ranks first when the same line or block contains `DIN`, `NPN` or `DIN-HM` (case-insensitive). Never convert letters to digits. Dedupe.
- `DinNpnField` `onScan` flow: no candidate → none-found message with `Retake`. One → `ScanConfirm` (`Read: dddd dddd. Does this match the label?`, `Use` / `Retake`). Several → chooser. `Use`/pick → `onChange(digits)`, then the lookup, then `onMatch(p, true)`.

- [ ] **Step 1: Write failing tests:**
  - `labelScan.test.ts`: `finds "NPN 80012345"`, `joins "NPN 8001 2345"`, `ranks the number next to DIN above a lot number`, `ignores a 10-digit run`, `does not turn "8OO12345" into digits`, `dedupes repeats`, `canScanLabel is false on web`.
  - `DinNpnField.test.tsx`: `scan with one candidate asks to confirm before lookup`, `Retake runs the scan again`, `scan with several candidates shows a chooser`, `scan fill calls onMatch with viaScan true`, `cancelled scan leaves the form untouched`.
- [ ] **Step 2: Run** `npx vitest run src/native/labelScan.test.ts src/features/meds/DinNpnField.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the TS side and `ScanConfirm.tsx`. Wire `onScan` in `MedForm` only when `canScanLabel()`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Implement the native plugin**, register it and add the Gradle dep. Run `npm run android:apk:mock`. Expected: BUILD SUCCESSFUL. Confirm the APK has no Play-services ML Kit: `cd android && ./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -i mlkit`. Expected: only `com.google.mlkit:text-recognition` and its own modules.
- [ ] **Step 6: Commit** `feat: scan the DIN/NPN from a label photo on Android (on-device ML Kit)`.

### Task 7: About line, ops doc, end-to-end checks, privacy gate

**Files:**
- Modify: `src/features/settings/Settings.tsx` (new `<section className="settings-group" aria-labelledby="st-about">` with `<h3 id="st-about">About</h3>` after "Medications"), `src/features/settings/Settings.test.tsx`
- Modify: `docs/OPERATIONS.md` (a "Refresh product data" section: run monthly with `node scripts/build-product-data.mjs [--din-only]`, check size, commit)

- [ ] **Step 1: Write failing test** `About shows the product data date and licence line` (exact copy from Global Constraints with `PRODUCT_DATA.generatedAt`).
- [ ] **Step 2: Implement** and run `npm test && npm run lint && npx tsc --noEmit -p . && npx tsc --noEmit -p tests && npm run build`. Expected: all PASS/clean.
- [ ] **Step 3: Browser check (mock mode):** start the dev server via the preview tools (`npm run dev:mock`). In Add Med: type a DIN and an NPN from the data, then verify the fill, banner, disabled Save, tick → Save, clear behaviour, an unknown number and edit mode. With the network offline after the first load, a lookup still works. Screenshot as evidence. Stop the server.
- [ ] **Step 4: Pixel check:** `npm run android:apk:mock`, then install over adb (never force-stop). Scan a real label (an NPN bottle): confirm step → fill → tick → Save. Confirm the photo was deleted: `adb shell run-as app.medtracker.android ls cache` shows no leftover image.
- [ ] **Step 5: Privacy release gate (spec §6.2):**
  - With airplane mode on, a scan still works.
  - With networking on, capture the traffic during a scan with Android Studio Network Inspector or `adb shell dumpsys netstats detail` before/after for the app UID. Expected: no requests to Google hosts from the scan.
  - If any traffic appears, exclude ML Kit's transport modules in Gradle (`exclude group: 'com.google.android.datatransport'`), rebuild and recheck. If the scan then breaks or traffic remains, **stop and report to the owner. Scanning does not ship.**
  - Record the result in the PR body.
- [ ] **Step 6: Commit** `feat: About shows product data date; document data refresh`.

---

## Self-review notes

- Spec coverage: §6.1 → Tasks 4–5; §6.2 → Task 6 + Task 7 gate; §6.3 → Tasks 1, 3, 7; §6.4 → Task 2; §6.5 → Tasks 3, 6; §8 risks → Task 1 Steps 1/6, Task 7 Step 5; §10 follow-ups are not in scope.
- Not runnable here: the e2e suite (production Supabase guard). The typed flow is covered by unit tests plus the Task 7 mock-mode browser check.
