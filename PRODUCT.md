# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are the owners and staff of a small South Carolina home-based bakery. The product may later be offered publicly as a paid tool for other cottage-food businesses.

## Product Purpose

Bread Recipe Lab turns a working recipe into a production-ready bakery record. Success means a user can enter and save a recipe, adjust it without losing its original intent, prepare a Square catalog item, and print a label that contains the information required for a South Carolina home-based food product.

## Positioning

The product connects recipe formulation, ingredient-weight normalization, cottage-food labeling, and point-of-sale catalog preparation in one guided workflow instead of treating them as separate spreadsheets and design tasks.

## Operating Context

The core workflow is:

1. Enter a recipe using familiar kitchen measurements.
2. Save the recipe with canonical ingredient weights.
3. Adjust yield, baker percentages, hydration, or total dough weight.
4. Assign a unique SKU and download a Square-ready CSV.
5. review label readiness and print the product label.

Users may enter ingredient amounts as cups, tablespoons, teaspoons, grams, kilograms, or ounces. The system converts those entries to grams for calculations while preserving the entered amount and unit for reference. Labels default to a South Carolina Department of Agriculture identification number rather than a home address.

## Capabilities and Constraints

- Grams are the canonical internal unit for recipe calculations and ingredient ordering.
- Volume-to-weight conversion depends on the selected ingredient and must identify estimates when an exact density is unavailable.
- Product net quantity must support both U.S. customary and metric display.
- The Square step must assign and store a SKU and provide a downloadable Square-ready CSV.
- Existing saved recipes must remain readable after data-model changes.
- Regulatory guidance must be treated as a readiness aid, not a guarantee of legal compliance, and must preserve the current official South Carolina wording.
- Direct Square API synchronization is not part of the first version.

## Brand Commitments

The existing Faithful & True identity, logo asset, practical bakery terminology, and calm operational interface should be preserved.

## Evidence on Hand

- Existing application implementation in `app.js`, `styles.css`, and label-specific assets.
- Existing Faithful & True logo at `faithful-true-logo.png`.
- Existing conversion tests in `tests/conversion.test.mjs`.
- South Carolina Department of Agriculture home-based food production guidance.

## Product Principles

- Guide users through the real production sequence.
- Preserve source measurements while calculating from reliable canonical weights.
- Make compliance readiness visible before printing.
- Keep business-critical identifiers and exports explicit and recoverable.
- Prefer clear operational language over technical terminology.

## Accessibility & Inclusion

The workflow must be keyboard-operable, use explicit labels and status messaging, and remain usable on desktop and mobile web layouts.
