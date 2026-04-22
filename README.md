# Amazon Filament Finder

Local web app that searches `Amazon.com` for `PLA`, `PETG`, `ABS`, and `TPU` filament listings that appear eligible to ship to Israel and sorts them by total delivered cost.

## What it does

- Reuses your local browser profile so Amazon's delivery destination can stay set to Israel.
- Searches the four filament categories on demand.
- Searches for `1kg` listings and asks Amazon for low-to-high price ordering.
- Uses Amazon's own `Eligible for Free Shipping` search filter directly in the Amazon search URL.
- Keeps only strict material matches.
- Keeps only free-shipping results in the final output.
- Sorts each section by total price from low to high.
- Shows an image, price, shipping, import fees, total, and a direct product link.
- Lets you export the current results as CSV or JSON.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. If needed, point the app at your browser profile:

   ```powershell
   $env:BROWSER_EXECUTABLE_PATH="C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
   $env:BROWSER_USER_DATA_DIR="C:\Users\danie\AppData\Local\BraveSoftware\Brave-Browser\User Data"
   $env:BROWSER_PROFILE="Default"
   ```

3. Start the app:

   ```powershell
   npm start
   ```

4. Open `http://localhost:3017`.

## Notes

- The app now copies your Brave profile into a temporary run folder, so you can usually keep Brave open while searching.
- The app no longer depends on listings literally mentioning `Israel`; it prefers Amazon's own free-shipping filter plus product-page checks.
- Amazon markup changes over time, so selectors may need occasional updates.
- This app is intended for manual use, not background polling.

## Tests

Run:

```powershell
npm test
```
