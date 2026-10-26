# Grocery Prices: phone app (Expo)

iPhone and Android app built with Expo SDK 58. It reads the same Supabase database as the web app and imports the web app's matching, pricing and date logic from `../docs/logic.js`, so both apps rank and total prices the same way.

## Try it on your phone (no Mac, no Apple account)

1. Install **Expo Go** from the App Store (or Google Play).
2. On your Windows PC, in PowerShell:
   ```powershell
   cd $HOME\grocery-prices
   git pull
   cd mobile
   npm install
   npx expo start --tunnel
   ```
   The first time, it may ask to install `@expo/ngrok`; answer **y**.
3. Scan the QR code with the iPhone **Camera** app; it opens in Expo Go.

Leave the PowerShell window open while you use it. Code changes reload on the phone automatically.

## What's in it (milestone 1)

- My list: add items with suggestions (plain item first), lowest price nearby, other stores, deals, quantity, all matches, pick
- Estimated total and one-stop trips
- This week's deals: search, store filter, add to list
- Stores near you with update status
- Location by ZIP (anywhere in the US) or GPS; Kroger-family stores and prices

Next: sign-in, adding a price with the camera, then TestFlight (needs the Apple Developer Program).

## Checks

```
npm run check:ios       # builds the iPhone bundle (catches errors without a phone)
npm run check:android
```
