# Add Med by DIN/NPN (type or scan) — Design

Date: 2026-10-25
Status: Approved by owner 2026-10-25

## 1. Intent

Adding a med by name is easy until the name is ambiguous. Searching
"Glucosamine" returns many near-identical products (strengths, combos,
brands) and the user can't tell which one is in their hand. Every Canadian
drug carries an 8-digit **DIN** and every licensed natural health product
(supplement) an 8-digit **NPN** on its label. That number identifies exactly
one product. Add Med should let the user type that number, or scan it off
the label with the camera, and fill the form with that exact product.

**Privacy is the governing constraint:** nothing about the user's meds may go
to a third party. Recognition runs on the device, and the lookup uses a copy
of Health Canada's public product lists served by MedTracker itself, never a
live call to Health Canada or anyone else.

## 2. Goals

1. **Type it:** a "DIN or NPN" field on Add Med. Entering 8 digits looks up
   the exact product and fills Name, Strength and Form.
2. **Scan it (Android):** a Scan button opens the camera. On-device text
   recognition finds the 8-digit number on the label and puts it in the same
   field, which then triggers the same lookup.
3. **Prefill, never auto-add:** the filled form is a draft. The user reviews
   it, sets the schedule and saves. Nothing is created without Save.
4. **Make the user check:** after a number-based fill, a warning banner says
   the match may be wrong or out of date, and Save stays disabled until the
   user ticks "I've checked these details against the label."
5. **Offline after first load:** the lookup works with no connection once
   the product data has been downloaded.

## 3. Non-goals

- Guessing the schedule (times, frequency) from label directions. The user
  sets it as today.
- US products (NDC), barcodes, or pharmacy-label barcodes.
- Photo storage or sending images anywhere. The scan photo is read once on
  the device and deleted.
- Cloud OCR or AI vision services.
- A live camera viewfinder (v1 takes a single photo).
- Camera scanning in the web/PWA build (typing works there; see §6.5).
- Changing name autocomplete. It still calls Health Canada DPD and NLM
  RxTerms live (switchable off via `suggestions_enabled`). Moving it onto the
  bundled data is a **separate follow-up ticket**.

## 4. Anti-goals (failure even if it "works")

- The user trusts a wrong fill. A misread digit or stale record that is
  saved unchecked is the worst outcome. Hence the warning banner, the
  required tick and "never fuzzy-match a number."
- Any request that reveals which product the user looked up leaves the
  device for a non-MedTracker host.
- Add-by-name gets slower or harder than it is today.

## 5. Decided by the owner

| Decision | Choice |
|---|---|
| Recognition | On-device OCR + DIN/NPN lookup, no cloud |
| Inputs | Both typing **and** camera scan in v1 |
| Scan style | Take one photo, read it on the device, delete it (no live viewfinder) |
| NPN fallback | If NPN data can't be built, ship DIN first |
| ML Kit reporting | Must be blocked and verified before release |
| Layout | **Option B:** a separate "DIN or NPN (on the label)" row with a **📷 Scan** button, above the Name field, then "or search by name" |
| Confirmation | Autofill, banner warns it may not be a 100% match, **tick box required before Save** |
| Data | Offline-first, no third-party calls at use time |

Approved banner wording:

> ⚠️ **Filled from NPN 80012345. Please check every detail against your
> label before saving.** The number or the product details may be wrong or
> out of date.

For a camera fill, add: "The number was read by the camera, so compare the
digits with the label too."

Tick label: **"I've checked these details against the label."**

## 6. Design

### 6.1 Screen behaviour (Add Med)

- New row at the top of `MedForm` (add mode only, not edit): label
  "DIN or NPN (on the label)", a numeric input (`inputMode="numeric"`, 8
  digits max, digits only) and a "📷 Scan" button (Android only).
- Divider "or search by name", then the existing `NameAutocomplete` and
  the rest of the form, unchanged.
- On the 8th digit the lookup runs:
  - **Match:** fill Name, Strength, Form (see §6.3 mapping). Mark those
    fields "from label" and highlight them. Open "More details" so Strength
    and Form are visible. Show the banner and the tick box. Save is disabled
    until ticked.
  - **No match:** inline message "No product found for 80012345. Check the
    number or add by name." Form untouched. No near-match suggestions.
  - **Data not available yet** (first use while offline): "Product data
    hasn't downloaded yet. Connect once to enable lookup." Add-by-name still works.
- Editing the number after a fill re-runs the lookup, replaces the
  "from label" fields and **resets the tick to unticked**. Editing a filled
  field by hand keeps the banner and tick requirement.
- Clearing the number removes the banner and tick **and clears any "from
  label" fields the user hasn't edited**, so a number-based fill can never be
  saved unchecked. Fields the user typed themselves stay.
- While Save is disabled by the tick, a hint under the tick says "Tick to
  confirm before saving" (linked via `aria-describedby`), so the disabled
  state is explained. This is new for `MedForm`, which otherwise validates on
  submit; the owner chose a disabled Save.
- Discontinued/cancelled product: fill anyway, banner adds "This product is
  marked discontinued by Health Canada."
- Multiple medicinal ingredients: Name is the product name. Strength lists
  each ingredient ("Glucosamine sulfate 500 mg, Chondroitin sulfate 400 mg").
- The tick box appears only after a number-based fill. Add-by-name has no tick.

### 6.2 Scan flow (Android)

- **Photo, then read** (owner's choice, not a live viewfinder): tapping Scan
  opens the system camera to take one photo of the label. Prefer the
  camera intent, which needs no `CAMERA` permission. ML Kit then reads the
  photo once on the device, and the temporary image file is deleted
  right after, whatever the outcome.
- Recognition looks for an 8-digit run, preferring one within the same line
  or block as "DIN", "NPN" or "DIN-HM".
- **No candidate:** "Couldn't find an 8-digit DIN/NPN in the photo." Offer
  Retake, or typing the number.
- **One candidate:** show it large ("Read: 8001 2345. Does this match the
  label?" with Use / Retake), then put the digits in the field and run the
  normal lookup. The scan banner variant applies. This confirm step guards
  against a misread digit that happens to match a different product.
- **Several candidates:** show them as buttons ("Which number is on the
  label next to DIN/NPN?") and the user picks one.
- Cancel/back returns to the form untouched.
- **Constraint:** the text-recognition model must be **bundled in the APK**
  (ML Kit `com.google.mlkit:text-recognition`, the bundled Latin model), not the
  Play-services variant that downloads the model on demand. No image, text
  or number leaves the device.
- **Release gate (owner's choice):** ML Kit may send Google usage statistics.
  Disable or strip any such reporting. Verify on the Pixel that a scan works
  with networking off and makes no network requests with networking on. Do not
  release scanning until this passes.

### 6.3 Data: bundled product lists

**Sources (Health Canada open data, public, no user data involved):**

- **DPD (drugs, DIN):** bulk extract `allfiles.zip` (pipe/CSV text files:
  `drug.txt`, `ingred.txt`, `form.txt`, `status.txt`, joined by
  `DRUG_CODE`). Health Canada's
  [extract page](https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-product-database/read-file-drug-product-database-data-extract.html)
  is canonical. The open.canada.ca mirror copy was last modified 2025-05-28, so don't rely on it.
  Include the marketed, approved and dormant extracts, plus inactive (cancelled) ones so discontinued products still match.
- **LNHPD (natural products, NPN / DIN-HM):** the API
  (`https://health-products.canada.ca/api/natural-licences/`) has
  `ProductLicence` (licence_number = NPN, product_name, dosage_form, status),
  `MedicinalIngredient` (strength + unit) and `ProductDose`. Each can be paged
  through in full. A 2010 readme describes a bulk flat-file extract, but no
  current download link was found.

**Build step:** `scripts/build-product-data.mjs`, **run manually by the
developer** (about monthly, and before any release touching this feature),
downloads both sources and writes compact JSON with only: number, product
name, form, ingredient names + strength + unit, status, plus a
`generated_at` date. One file per list (`public/products/din.json`,
`public/products/npn.json`). **The output is committed.** The deploy
(`ci.yml` → `build:pages`) never contacts Health Canada, so a Health Canada
outage can't break a deploy. If a fetch fails, the script exits non-zero and
leaves the committed files unchanged. Measure the size after the first build.
If a list is too large to download whole (rough bar: over ~5 MB gzipped),
come back to the owner before sharding. Sharding by prefix is a poor fit:
offline lookup would then only work for shards already fetched, and DIN
(`0…`) and NPN (`8…`) prefixes cluster.

**DPD row selection:** a DIN can have several `DRUG_CODE` rows (e.g.
cancelled then re-marketed). Keep one row per DIN: marketed beats approved
beats dormant beats cancelled, and the latest status date breaks ties.

**Delivery to the app:** the live Android APK loads the deployed site, so
the data comes from MedTracker's own origin, never from Health Canada at
use time. It is fetched **whole, per list, on first focus of the DIN/NPN
field** and stored by a new runtime route in `sw.ts` (CacheFirst, keyed by
a content-hashed filename or `?v=<generated_at>` so a new data release replaces
the old one). It is not precached: the current precache globs exclude
`.json`, and Workbox drops precache entries over 2 MiB by default. After
the first download, every lookup works offline.

Settings → About shows "Product data as of <generated_at>. Contains
information licensed under the Open Government Licence – Canada."

**Form mapping** to MedTracker's `tablet | capsule | liquid | other`:
tablet-like dosage forms (tablet, chewable, film-coated…) → tablet,
capsule-like → capsule, liquid/solution/syrup/suspension/drops → liquid,
anything else → other. Keep the original Health Canada form text in Notes
only if useful (builder's call).

### 6.4 Lookup

- Pure function `lookupProduct(number): Product | null | 'unavailable'`.
  Exact match on the 8-digit string (keep leading zeros, since DINs often start
  with `0`). DIN list first, then NPN list. The number formats overlap, so if both
  match, show both as choices.
- No fuzzy matching, no partial-number suggestions.

### 6.5 Platforms

- **Android APK:** type + scan. The Scan button shows only when the native
  plugin is present (`Capacitor.isPluginAvailable`, as in
  `src/native/reminders.ts`), because web deploys reach older APKs before a
  reinstall. minSdk is 24.
- **Web / PWA:** type only. The Scan button is hidden. Data downloads on first
  lookup and is cached by the service worker.
- Camera scanning on the web is out of scope for v1.

## 7. Constraints

- Repo is public: no real user data in fixtures. Use made-up numbers in tests
  (e.g. `80012345`), or real public DIN/NPN values from the Health Canada data.
- Supabase project is production. This feature adds no tables and no
  server calls.
- Must not slow first load: product data is fetched lazily (on first focus of
  the DIN/NPN field or first lookup), not on app start.
- Existing behaviour unchanged: add-by-name, autocomplete, edit mode.

## 8. Open risks (to verify during planning)

1. **LNHPD access.** On 2026-10-25 both Health Canada APIs returned 503 from
   two networks. Confirm the API pages fully, or find the current bulk extract.
   The flat-file LNHPD extracts are reportedly deprecated, so the paged JSON API is the
   supported route. **Fallback (owner's choice):** if NPN data can't be built,
   ship DIN first. An 8-digit number not found in the DIN list then shows
   "NPN lookup isn't available yet. Add by name for now," and NPN follows in
   a later release.
2. **Data size.** Unknown until built. See the size bar in §6.3.
3. **OCR plugin.** A custom native plugin is fine. The project already
   ships one that works in the live APK (`TapHapticsPlugin.java` +
   `src/native/tapHaptics.ts`). It needs the bundled ML Kit model per §6.2.
4. **DIN vs NPN overlap.** Likely none, given the number ranges. §6.4 keeps a
   chooser in case.
5. **ML Kit network traffic.** A release gate, see §6.2.

## 9. Left to the builder

- Exact JSON shape of the product data and cache details (sharding needs the
  owner's OK, see §6.3).
- Plugin choice for OCR (subject to §6.2 constraint).
- Candidate-detection heuristics for the scan (subject to §6.2 behaviour).
- Styling of the highlight, banner and tick, following `theme.css`.
- Test approach (unit tests for lookup + form mapping + MedForm states, e2e
  for the typed flow in mock mode).

## 10. Follow-ups (separate tickets)

- Move name autocomplete onto the bundled product lists so typed names stop
  going to Health Canada / RxTerms.
- Camera scanning in the web build.
