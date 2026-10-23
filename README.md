# Grocery Prices

A phone-first web app for the South San Francisco / Daly City area. Add items to a list and it shows the lowest current price, which nearby store has it, and an estimated total. Data comes from each store's own website.

| Store | What we get | Where it runs |
|---|---|---|
| Safeway (Westlake, Gellert, El Camino, Hickey) | Weekly ad, Wed–Tue, via Flipp | GitHub, just after midnight |
| Trader Joe's (Daly City, South SF, Millbrae) | Everyday shelf prices per store, ~1,460 food items | GitHub, just after midnight |
| Costco (South SF #422) | Monthly member savings book | GitHub, just after midnight |
| Sprouts (Daly City #276) | Weekly and monthly ads | Your Windows PC (needs a real browser) |

## Effective dates

Every price carries the ad's own `valid_from` / `valid_to`, as Pacific calendar dates. The app decides what's live from those dates each time it opens:

- **Safeway** posts its ad a day early (`available_from` Tue, `valid_from` Wed). The posted date is recorded but never used for pricing.
- Flipp's timestamps are midnight *Eastern*. Converting them would start ads at 9pm Pacific the night before, so the plain date field is used instead.
- **Sprouts** gives exact instants (`07:00Z` = Wed 12:00am Pacific); these are converted to Pacific dates. Weekly and monthly ads overlap, and the lower active price wins.
- **Costco** uses the window printed on the savings page (e.g. `Valid 10/19/26 - 11/15/26`).
- **Trader Joe's** prices have no end date. They're shelf prices, refreshed on each fetch.

An ad fetched early shows under "Starting soon" and switches on by itself on its start date, even if no fetch runs that day.

## Layout

```
src/            fetchers (Node 22, no build step)
  dates.js      effective-date rules
  fetchers/     safeway, traderjoes, costco, sprouts
docs/           the app (served by GitHub Pages) + docs/data/*.json
test/           node --test
windows/        Task Scheduler setup for the PC fetcher
```

## Commands

```
npm test                 # parsers + date logic + matching
npm run fetch:cloud      # safeway traderjoes costco
npm run fetch:sprouts    # needs Playwright (Windows setup installs it)
```

## Windows PC setup (Sprouts)

```powershell
git clone https://github.com/wrathofkan-developer/grocery-prices.git
cd grocery-prices
powershell -ExecutionPolicy Bypass -File windows\setup.ps1
```

This registers **Grocery Prices Fetch** in Task Scheduler: 6:40am and 6:40pm daily, plus Wednesday 12:05am when Sprouts' new ad starts. It wakes the PC from sleep for these, and if the PC was off, runs once you turn it on and sign in. To move another store off GitHub, add it to `windows\chains.txt`.

## Notes

- Sprouts ad tiles are expanded into their products (~290 a week). Buy-1-get-1 deals show the per-unit price with the deal plus one unit without it; totals follow the deal exactly. Sprouts' monthly ad is image-only, with no readable items.
- Costco book items listed as "Save $X" have no shelf price on the page.
- Store data comes from public pages for personal use. A public release would need licensed data (e.g. Flipp's partner program).
