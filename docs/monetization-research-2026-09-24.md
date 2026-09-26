# Handlelista monetization recommendation

Research date: 24 September 2026. Based on the Expo client, the adjacent Laravel backend, and current primary sources. Prices and quotas below are proposals, not validated willingness-to-pay findings. Norway is the assumed initial market because of the app's Norwegian language and units. No production usage, live model overrides, customer interviews, or billing data were inspected.

## Recommendation

Keep the complete everyday workflow free. Sell one household subscription, provisionally **Handlelista Plus at NOK 49/month or NOK 399/year**, for frequent personalized AI planning and assistance. One purchaser sponsors one household; other household members share the benefits and allowance. Start with one paid tier.

The promise should be “Dinner sorted for the whole household.” The valuable outcome is less effort deciding, planning, and shopping. Ingredient categorization and generated food pictures are supporting features and probably insufficient subscription reasons on their own.

Avoid an advertising-led launch, lifetime access to hosted AI, and a complicated credit currency. Optional top-ups can follow if real subscribers repeatedly exhaust their allowance. A one-time supporter purchase could be added later, but should not promise perpetual AI service.

## Proposed free and paid split

All recurring allowances are shared per household, not multiplied by member count. These are initial experiment settings to revise using measured costs and usage.

| Capability | Free | Plus |
| --- | --- | --- |
| Manual recipes, meal plans, shopping lists | Unlimited ordinary use | Same |
| Offline use without an account | Yes | Yes |
| Basic cloud sync and household collaboration | Yes, with an account | Same |
| Local aisle categorization and local suggestions from saved meals | Yes | Same |
| AI-generated meal plans | 2 successful generations/month after sign-in | 30/month |
| Explicit AI ingredient suggestions | 5 successful requests/month | 100/month |
| AI dinner images | 1 introductory image | 20/month |
| Existing recipes, generated plans and saved images after expiry | Retained and usable | Retained and usable |

Allow one bounded guest AI planning demonstration, deducted from the introductory allowance when an account is linked. Anonymous trial enforcement is necessarily best-effort; combine server-issued trial identity with device/app attestation where available, rate limits and a small separate demo budget. IP should be an abuse signal, not a paid customer's identity.

Keep exclusion preferences and serving sizes free. They are basic inputs to a usable planner. Do not make users pay to correct unsuitable suggestions. Basic AI categorization can remain a quietly bounded enhancement with an on-device fallback; do not make its background calls consume visible planning credits.

Describe allowances as “meal plans,” “ingredient suggestions,” and “pictures.” Do not expose tokens. Explain whether a deliberate regeneration consumes a new use; reopening a saved result or retrying the same completed request should not. Show remaining uses and reset dates before exhaustion. At the limit, offer Plus or continued manual planning without disrupting the current list.

Annual subscribers should receive monthly allowance resets, not their entire year's AI allowance upfront. Define calendar or subscription-anniversary periods explicitly and use the same rules on all devices.

## Market evidence

| Product | Verified offer | Implication |
| --- | --- | --- |
| AnyList | Free list creation and sharing; Complete costs US$9.99/year individually or US$14.99/year for a household | A shared shopping list alone has a low price anchor. |
| Samsung Food+ | US$6.99/month or US$59.99/year, with AI personalization and tailored weekly plans; local pricing varies | Recurring planning assistance supports a materially higher price than basic lists. |
| ReciMe | Free core includes meal plans, grocery lists and 5 recipe imports/week; Plus includes unlimited imports and other premium functions | A useful free workflow with a limit on automation is an established approach. |
| Paprika 4 | Announced optional subscription for new features; pricing not finalized on the checked support page; existing users retain existing functionality | Preserve the usefulness of customers' existing recipe collections. |

Sources: [AnyList](https://help.anylist.com/articles/getting-started/), [Samsung Food+](https://samsungfood.com/food-plus/), [ReciMe](https://recime.app/help/en/articles/11596201-is-there-a-free-version-of-the-app), [Paprika](https://paprikaapp.zendesk.com/hc/en-us/articles/41887059110167-Will-Paprika-4-have-a-recurring-subscription-fee).

Do not use old Mealime prices as a current benchmark: [Mealime officially announces discontinuation on 21 October 2026](https://www.mealime.com/closing). This suggests an acquisition opportunity to test with people looking for a replacement, without assuming its users can migrate automatically or that its shutdown proves anything about subscription economics.

## AI economics

The backend defaults to `google/gemini-3.5-flash-lite` for suggestions and planning, `typesafe/jev-1.13` for classification, and `black-forest-labs/flux.2-klein-4b` for images. Environment variables and stored admin settings can override defaults.

[OpenRouter lists Gemini 3.5 Flash Lite](https://openrouter.ai/google/gemini-3.5-flash-lite) at US$0.30 per million input tokens and US$2.50 per million output tokens. [FLUX.2 Klein 4B](https://openrouter.ai/black-forest-labs/flux.2-klein-4b/api) starts at US$0.014 for the first output megapixel. The app uses a US$0.015 fallback image-cost estimate.

Illustrative costs, not measured app averages:

| Operation | Assumed billable usage | Estimated provider cost |
| --- | --- | --- |
| One complete weekly generation | 10,000 input + 4,000 output tokens, summed across generation and review | US$0.013 |
| One ingredient suggestion | 2,000 input + 500 output tokens | US$0.00185 |
| One dinner image | App's configured estimate | US$0.015 |

At the full proposed monthly allowance, 30 plans + 100 suggestions + 20 images total about **US$0.875** under those assumptions. Ordinary usage can be much lower. This excludes classification, retries, any extra reasoning tokens beyond the assumed totals, provider/platform funding fees, taxes, hosting, image storage, support and acquisition. It is neither an upper bound nor a measured margin. Expensive model changes can materially alter it.

Measure total billed cost per successful user outcome, including failed attempts and review calls. Current logs are a useful starting point, but some failure paths record zero or incomplete costs despite potential upstream work. Reconcile with provider billing. Track median and 95th-percentile cost per active household, split by free and paid.

Free-tier economics matter in aggregate. With an assumed 5% of active households paying, there are 19 free households per payer. If each free household costs NOK 0.50/month, that is NOK 9.50/month to fund per payer. These are sensitivity assumptions, not conversion or cost forecasts.

## Subscription economics

For an illustrative Norway sale, assume consumer prices include 25% VAT and the store fee is 15% of the VAT-exclusive amount:

| Plan | Customer payment | After assumed VAT and store fee, before all other costs |
| --- | --- | --- |
| Monthly | NOK 49 | NOK 33.32/month |
| Annual | NOK 399 | NOK 271.32/year, or NOK 22.61/month |

Formula: consumer price / 1.25 × 0.85. The annual plan is approximately 32% cheaper than twelve monthly payments. At 1,000 annual paying households, this is NOK 399,000/year in consumer payments and NOK 271,320/year after these two deductions, before AI, free-user subsidy, operations and other expenses. It is not profit.

[Norway's standard VAT rate is 25%](https://www.skatteetaten.no/en/rates/value-added-tax/). [Apple's Small Business Program](https://developer.apple.com/support/compare-memberships/) offers a 15% commission subject to enrollment and eligibility. [Google's current fee page](https://support.google.com/googleplay/android-developer/answer/112622?hl=en) gives a combined 15% for ordinary auto-renewing subscriptions through Play Billing in the covered EEA scenario (10% service plus 5% billing). Actual proceeds depend on storefront, program and tax treatment; confirm through the store reports.

## Fit with the existing code

The app is well positioned for freemium:

- Local storage, planning, recipes, shopping-list generation and categorization already work without cloud AI.
- `src/lib/store/week-planning.ts` already builds suggestions from saved dinners locally. Keep this useful fallback free.
- `src/lib/store/week-suggestions.ts` accepts AI previews into ordinary local recipes, plans and lists. Preserve those records after subscription expiry.
- Laravel already records AI requests and applies daily user, household and global quotas, plus caching.

Changes needed before charging:

1. **Authenticated paid planning.** `food-app/routes/api.php:29` exposes planning before the authenticated route group. `RunWeekPlanning` meters by IP and global day, and its log rows do not attach a user/household. Add an authenticated path with household entitlement and monthly usage; retain a separately bounded guest demo. The Expo requester currently uses the generic API client and also needs to select the authenticated path.
2. **Billing state.** No subscription integration was found in the inspected client dependencies, backend routes or app code. Add server-owned entitlement records, verified purchase events, restore support, cancellation-at-period-end, grace periods, refunds and expiration handling.
3. **Household sponsorship.** Link the purchase to its purchaser account and a single sponsored household. Block duplicate household subscriptions and define transfer/leave behavior. Switching households must not mint fresh allowances. App household sharing is separate from Apple Family Sharing.
4. **Monthly customer allowances.** `AiUsage` currently implements daily safety budgets, and failed calls consume them. Keep those internal protection counters; use a separate atomic customer allowance reservation/settlement ledger. Release customer reservations on failures while preserving internal cost and abuse accounting. Deduplicate retries with request IDs.
5. **Paid availability.** `config/assistance.php` defaults to 200 total weekly-planning generations/day and a US$2/day shared image budget. At US$0.015/image, the latter is only about 133 images for everyone. Free usage must not routinely exhaust capacity promised to subscribers. Separate free/paid budgets, reserve projected cost atomically, and monitor capacity. The present image cost check can also overshoot under concurrent calls.
6. **User-triggered metering.** Ingredient suggestions currently react to recipe context. Introduce a clear explicit action, or ensure automatic refreshes cannot silently drain a visible subscription allowance.

Recommended integration: RevenueCat via `react-native-purchases`, store billing in the native app, and Laravel as the authority for household access. [Expo's guide](https://docs.expo.dev/guides/in-app-purchases/) supports this approach and requires a development build, which the project already uses. RevenueCat is an implementation service, not a replacement for store billing. Its [published billing terms](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management) are free below US$2,500 monthly tracked revenue, then 1% of tracked revenue before platform/tax deductions. Native digital subscriptions should follow [Apple's purchase rules](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase); regional alternative-payment options can be evaluated separately.

## Validation and rollout

First recruit 20–30 households for four weeks. Measure whether they return to plan and shop each week, accept AI suggestions, invite a second member, and save time. This is qualitative validation, not enough traffic for a reliable pricing A/B test.

Offer the proposed price to people who have completed a useful plan and shopping list. Track actual purchases and renewal intent, not only “would you pay?” answers. Present Plus when users request more automation, with an accessible option to keep using free features. A card-free sample is sufficient initially; a seven-day auto-renewing trial is an optional later experiment.

Track weekly active households, week-four retention, AI use-to-accepted-plan rate, limit encounters, purchase conversion among exposed active households, cancellations, refunds, costs and contribution after the free-user subsidy. If AI is tried once and rarely reused, improve recurring usefulness before tightening the free tier. Test a higher price such as NOK 69/month only once there is enough demand to compare fairly; measure retained contribution, not just initial conversions.

The next premium feature to investigate is recipe import from links, photos or screenshots. It addresses repeated manual effort, and competitor packaging supports testing it. This is a future feature, not something found implemented here. Prefer structured website data or ordinary parsing when available and use AI only where it adds value.

The decision still requiring customer evidence is whether current personalized planning alone earns a recurring payment. The code and model prices make the proposed model feasible to test; they do not establish demand.
