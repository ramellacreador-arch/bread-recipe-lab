# Bread Recipe Lab

Serve the app over local HTTP so browsers can load its JavaScript modules:

```powershell
cd path\to\bread-lab
py -m http.server 8000
```

Then open <http://127.0.0.1:8000> in your browser. Keep the server window open
while using the app. The HTTP address has separate browser storage from a
`file://` copy, so recipes saved under one address do not automatically appear
under the other.

The local app stores recipes in this browser on this device. Use Export and
Import to move recipes between browsers or make a backup.

The label generator is based on official South Carolina, FDA, FTC, and Laurens
County sources checked July 6, 2026. It is a practical checklist, not legal
advice. Confirm final sale eligibility with SCDA and your local jurisdiction.

Ingredient entry accepts cups, tablespoons, teaspoons, grams, kilograms, and
ounces, including decimal, fraction, and mixed-number amounts. The original
amount and unit remain visible while all recipe math and label ordering use
canonical grams. Verify density estimates with a scale before production.

The guided Recipe workflow covers entry, saving, adjustment, Square catalog
export, and label readiness. Square CSV exports include Item Name, Variation
Name, Description, SKU, and Price. Start with the latest template from your own
Square Dashboard and match columns during import.

Printing stays disabled until required South Carolina label information is
present. The checklist is a preparation aid, not legal advice; the operator
remains responsible for confirming current SCDA and local requirements.
