# @calebx/directory-import — src/image

The image processing, segmentation, OCR, and vision recognition layer of the booklet importer.

## Directory Structure & Contracts

| File                                                                                                           | Description                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`types.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/types.ts)                 | Core type definitions: `CARD_FIELDS`, `CardRow`, `CardRegion`, and `ParsedCard`. Zero dependencies.                                                        |
| [`geometry.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/geometry.ts)           | Image geometry analysis. Projects profiles to locate booklet page boundaries, segment pages into a 2x3 grid of cards, and find individual text-line bands. |
| [`quality.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/quality.ts)             | The resolution gate. Assesses image dimensions and character heights to reject scans that are too low-resolution to read reliably.                         |
| [`labels.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/labels.ts)               | Dictionary of Hindi/Devanagari labels and edit-distance string similarity utilities for label mapping.                                                     |
| [`ocr.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/ocr.ts)                     | The local Tesseract engine interface. Wraps two Tesseract workers (`hin+eng` for prose, `eng` for digits-only).                                            |
| [`card.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/card.ts)                   | The local Tesseract reader engine. Parses a located card crop line-by-line, matching values to fields.                                                     |
| [`vision.config.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/vision.config.ts) | Configuration for the vision reader, including OpenRouter API prompts, scaling settings, field arrays, and JSON response parsers.                          |
| [`vision.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/vision.ts)               | The LLM vision reader engine. Extracts data from card crops using high-performance multimodal models via OpenRouter.                                       |
| [`validate.ts`](file:///Users/ledjke/Desktop/CalebX/packages/directory-import/src/image/validate.ts)           | Validation rules (phone formats, non-empty values) and multi-pass reconciliation algorithms.                                                               |

## Flow

```
Raw Image (geometry.ts) -> Pages -> Card Crops
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
      Tesseract (ocr.ts, card.ts)       Vision (vision.ts)
            │                                   │
            └─────────────────┬─────────────────┘
                              ▼
                        validate.ts
                              │
                              ▼
                        ParsedCard
```
