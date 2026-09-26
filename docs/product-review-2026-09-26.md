# Handlelista product review

Reviewed 26 September 2026. This is a product and feature review, supported by source inspection and navigation of the running iOS Simulator build. It is not a security audit or an exhaustive device test. The simulator was not rebuilt, so the current source is authoritative where its UI differs. Existing working-tree changes were included in the review and left untouched.

## Recommendation

Make it easier to bring real recipes into Handlelista and cook them. Recipe import and a dedicated cooking view are the strongest next additions. Follow with an “already have this” shopping check and reusable weekly plans. Preserve the fast, account-optional workflow.

These priorities are product judgments based on the current gaps and competitor capabilities, not measured customer demand. Validate them with households using the app across several weekly planning and shopping cycles.

## Current coverage

| Area | Already implemented | Most useful next improvement |
| --- | --- | --- |
| Weekly planning | Week navigation, multiple dinners per day, moves, serving counts, suggestions from saved meals or AI, swaps, planning preferences | Copy a week, reusable templates, explicit leftovers/eating-out entries |
| Dinner collection | Search/create, custom categories, ingredients and amounts, recipe servings, notes, photos/emoji, ingredient suggestions | Recipe import, cooking view, preparation time, favorites |
| Shopping | Multiple lists, aisle grouping, history-based item suggestions, amount parsing, serving-scaled generation, progress, compact layout, undo and archives | Pantry check, compatible-unit aggregation, store-specific aisle order |
| Household | Optional account, shared households, invitations, local persistence, cloud sync, live presence and change feedback | Contextual invitation entry points and clearer backup/export options |
| Preferences | Norwegian/English, appearance, household servings, food exclusions and optional AI settings | More discoverable household setup after the first useful plan |

Code anchors: `src/app/(app)/index.tsx`, `src/app/(app)/dinners/`, `src/app/(app)/shopping/`, `src/app/(app)/account/`, `src/lib/store/schema.ts`, `src/lib/shopping/generate.ts`, and `src/lib/week-suggestions.ts`.

## Prioritized additions

### 1. Recipe import — highest priority

Let people paste a recipe URL, review the extracted ingredients and instructions, and save it directly to Dinners. Preserve the original source link. Then support the phone share sheet; screenshots and social-video imports can follow.

The present manual path creates a name and then requires ingredient entry. AI generation helps discovery, but it does not let someone bring in a specific recipe they already like. The local recipe model also lacks a dedicated source URL or structured instructions.

Start with websites and pasted recipe text. Prefer structured recipe data where available, allow corrections before saving, and retain usable imported recipes offline. Native sharing and broad social import support make this a larger project than adding a paste field.

[Paprika](https://www.paprikaapp.com/) supports web recipe capture. [ReciMe](https://www.recime.app/) supports social sources, screenshots, and handwritten-recipe photos. Their breadth is a direction to grow toward, not a necessary first release.

### 2. Cooking view — highest priority, paired with import

Opening a dinner currently opens its editor. Instructions can live in Notes, and the backend explicitly generates cooking instructions there, so instructions are not entirely absent. What is missing is a screen designed for following them.

Add readable numbered steps, ingredient checkoffs, a keep-screen-awake option, temporary serving scaling, and a clear Edit action. Timers can follow. Scaling while cooking must not silently change the recipe's baseline serving count.

[Paprika](https://www.paprikaapp.com/) offers ingredient checkoffs, step highlighting, screen-awake behavior and timers; [AnyList](https://www.anylist.com/features) offers a cooking mode. This completes the transition from planning a meal to actually making it.

### 3. “Already have this” check — high priority

Before making the shopping list, show its ingredients with an “Already have” action. Start with a lightweight household staples list and optional available amounts; do not require users to maintain a complete inventory.

Today generation scales and aggregates recipe ingredients but does not subtract pantry stock. An aisle named Pantry is only a shopping category, not inventory. Remember exclusions from this shopping trip separately from food-preference exclusions, and preserve them when the plan changes and its list is updated.

Later add “Use up these ingredients” and optional expiry dates. [Samsung Food+](https://samsungfood.com/food-plus/) documents food-list-based recipe search that prioritizes soon-to-expire ingredients. The staged approach avoids making everyday shopping depend on perfect stockkeeping.

### 4. Reusable weeks and leftovers — high priority

Add “Copy last week” and named templates such as “Busy week.” Preview the destination and fill only selected slots. Preserve serving counts and let users swap meals afterwards.

Add lightweight entries for “Eating out” and “Leftovers from Tuesday.” Leftovers should link to the original cooking event so the shopping list does not buy the same meal twice. Currently every plan entry requires a dinner ID; these states need explicit representation rather than fake recipes with no ingredients.

[Paprika](https://www.paprikaapp.com/) supports reusable menus, and [Samsung Food+](https://samsungfood.com/food-plus/) supports saved meal-plan templates. Existing suggestions and recency already help variety; templates address repetition and predictability.

### 5. Faster recipe decisions — medium priority

Add favorites, preparation/cooking time, ingredient search, and multiple tags such as “20 minutes” and “Freezer-friendly.” Custom categories already exist, so this extends them rather than replacing them.

The saved-recipe model lacks time and cost metadata. The “Quick” and “Budget” AI wishes therefore should not be confused with deterministic filters over the household's own recipes; the saved-only shortcut list currently contains Vegetarian. Structured time and tags would make saved-only planning more useful offline.

### 6. Store-aware shopping — medium priority

Allow a household to reorder aisles for its usual store and save multiple store layouts. Later add optional item notes/photos and approximate prices where users want them. The present aisle order is fixed in `src/lib/categorize/taxonomy.ts`.

[AnyList](https://www.anylist.com/features) documents customized grocery categories, stores/filters, item photos, prices and favorite items. Prioritize aisle order and staple favorites before retailer catalog integrations, which add ongoing data and partnership dependencies.

### 7. Widgets, voice and practical sharing — medium/later priority

Useful entry points include a Tonight widget, the active shopping list, voice-based item entry, and a plain-text share action for a list or week. [AnyList](https://www.anylist.com/features) documents widgets, Siri/Alexa entry, list export and calendar integration.

Household sync already exists. A share/export action solves a different need: sending a useful list to someone who has not joined the household. Start with text sharing; pursue widgets and voice after the core recipe workflow.

## Existing experience to improve

1. **Planning history is labeled as cooking history.** `src/app/sheets/dinner-picker.tsx:44` renders “Made today/yesterday” from `last_planned`; `src/lib/store/dinners.ts` derives it from scheduled entries. Use “Planned” until the app records an explicit cooked event.
2. **Compatible units remain separate shopping rows.** `src/lib/shopping/generate.ts` groups by ingredient ID and normalized unit, explicitly without conversion. Add safe same-dimension conversions: 500 g plus 1 kg becomes 1.5 kg. Keep pieces, packs and volume-to-weight conversions separate unless their equivalence is known.
3. **First-use recipe setup has a high manual burden.** Empty collection guidance leads to typing names and ingredients. Offer import and an optional small set of complete starter dinners near the first planning action. Avoid requiring a long onboarding sequence.
4. **Household collaboration deserves a contextual entry point.** Account connection and invitations live in Settings/account routes. After the first useful list, offer “Share with your household” with a clear explanation of account setup.
5. **Separate reading from editing.** The dinner page's immediate field saving is useful while editing, but the everyday reader needs a stable recipe view and temporary scaling.
6. **Provide portable data.** A user-facing export/import backup would complement optional cloud sync, especially for households using the app entirely offline.

## Suggested delivery order

1. Correct the history wording; add a cooking view and recipe source/instruction fields.
2. Ship URL/text import with a review step; add share-sheet intake next.
3. Add shopping preview with “already have,” persistent trip exclusions, and compatible-unit conversion.
4. Add copy-week/templates, favorites, and store aisle ordering.
5. Evaluate leftovers, widgets, voice, pantry expiry and richer recipe filters against actual household usage.

Defer calorie tracking, retailer price comparison, a public social feed, and barcode-based inventory unless users demonstrate demand. They expand the product and its maintenance substantially. The current app's strongest opportunity is helping a household decide, shop and cook with less effort.

## Validation

TypeScript checking and Expo lint passed. All 38 Jest suites passed: 372 tests. Navigated the running simulator's planner, dinner collection/editor, shopping overview/detail and Settings without changing food data. Read account/household routes, storage models, list-generation logic, planning logic, and relevant Laravel API/AI code. Did not exercise authenticated multi-device sync, rebuild native binaries, or test Android, VoiceOver or large-data performance.

For product validation, measure time to first complete recipe and shopping list, repeat weekly use, import corrections, cooking-view reuse, and second-member activation. Competitor feature availability supports these hypotheses; it does not establish which will retain Handlelista users.
