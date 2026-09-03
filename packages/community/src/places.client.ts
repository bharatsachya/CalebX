import { env } from "@calebx/config";
import { ExternalApiError } from "@calebx/errors";
import { withSpan } from "@calebx/trace";

/**
 * Google Places, used live and never cached.
 *
 * Google's terms permit storing `place_id` indefinitely but not caching names,
 * addresses, or coordinates beyond a short window, and prohibit building a
 * derived catalog. So this client is the only place place data exists in the
 * process: the graph stores `placeId` plus our own tags, and every
 * recommendation re-hydrates the human-readable fields from here
 * (assumptions.md A5).
 *
 * The practical consequence is that the geo-radius filter lives in this request,
 * not in a Neo4j `point.distance()` — which is why `Place` has no `Point`.
 */

const e = env("places");

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

/**
 * Our cohort categories mapped onto Google's place types. One category can span
 * several types; the request takes them all and we tag the results ourselves.
 */
export const PLACE_TYPES: Readonly<Record<string, readonly string[]>> = {
  cafe: ["cafe", "coffee_shop"],
  coworking: ["coworking_space"],
  fitness: ["gym", "fitness_center"],
  outdoors: ["park", "hiking_area"],
  music: ["live_music_venue", "night_club"],
  books: ["book_store", "library"],
  food: ["restaurant"],
};

export interface PlaceSuggestion {
  /** The only field we are allowed to persist. */
  placeId: string;
  name: string;
  address: string | null;
  rating: number | null;
  userRatingCount: number | null;
  /** Our category, not Google's types. */
  ourTags: string[];
}

export interface NearbyQuery {
  latitude: number;
  longitude: number;
  /** Metres. Clamped to Google's 50km ceiling. */
  radiusMeters?: number;
  /** One of the keys of `PLACE_TYPES`. */
  category: string;
  limit?: number;
}

interface ApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
}

export interface PlacesClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PlacesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKeyOverride?: string;

  constructor(options: PlacesClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.apiKeyOverride = options.apiKey;
  }

  /** Read lazily so a process that never asks for places needs no key. */
  private apiKey(): string {
    return this.apiKeyOverride ?? e.required("GOOGLE_PLACES_API_KEY");
  }

  async nearby(query: NearbyQuery): Promise<PlaceSuggestion[]> {
    return withSpan(
      "places.nearby",
      { kind: "http", attributes: { category: query.category } },
      async (span) => {
        const types = PLACE_TYPES[query.category];
        if (!types || types.length === 0) {
          // An unknown category would otherwise become an unfiltered nearby
          // search — every business within the radius, ranked by nothing.
          throw new ExternalApiError(
            `unsupported place category: ${query.category}`,
          );
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await this.fetchImpl(ENDPOINT, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-Goog-Api-Key": this.apiKey(),
              // Field mask is required by the API and is also a cost control:
              // asking for fewer fields is a cheaper billing tier.
              "X-Goog-FieldMask": [
                "places.id",
                "places.displayName",
                "places.formattedAddress",
                "places.rating",
                "places.userRatingCount",
              ].join(","),
            },
            body: JSON.stringify({
              includedTypes: types,
              maxResultCount: Math.min(query.limit ?? 8, 20),
              locationRestriction: {
                circle: {
                  center: {
                    latitude: query.latitude,
                    longitude: query.longitude,
                  },
                  radius: Math.min(query.radiusMeters ?? 5_000, 50_000),
                },
              },
              rankPreference: "POPULARITY",
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new ExternalApiError(
              `Places API returned ${response.status}`,
              response.status,
            );
          }

          const body = (await response.json()) as { places?: ApiPlace[] };
          const places = (body.places ?? [])
            .filter(
              (place): place is ApiPlace & { id: string } =>
                typeof place.id === "string" && place.id !== "",
            )
            .map<PlaceSuggestion>((place) => ({
              placeId: place.id,
              name: place.displayName?.text ?? "Unnamed place",
              address: place.formattedAddress ?? null,
              rating: place.rating ?? null,
              userRatingCount: place.userRatingCount ?? null,
              ourTags: [query.category],
            }));

          span.setAttributes({ placeCount: places.length });
          return places;
        } catch (error) {
          if (error instanceof ExternalApiError) throw error;
          if (error instanceof Error && error.name === "AbortError") {
            throw new ExternalApiError(
              `Places API timed out after ${this.timeoutMs}ms`,
            );
          }
          throw new ExternalApiError(
            `Places API unreachable: ${String(error)}`,
          );
        } finally {
          clearTimeout(timer);
        }
      },
    );
  }
}

/**
 * A stand-in for tests and for running without a Places key.
 *
 * Returns deterministic, obviously-fake places. Named so it cannot be mistaken
 * for the real client in a stack trace.
 */
export class StubPlacesClient {
  constructor(private readonly places: PlaceSuggestion[] = []) {}

  async nearby(query: NearbyQuery): Promise<PlaceSuggestion[]> {
    if (this.places.length > 0) return this.places;
    return [
      {
        placeId: `stub-${query.category}-1`,
        name: `Example ${query.category} one`,
        address: "1 Example Road",
        rating: 4.5,
        userRatingCount: 120,
        ourTags: [query.category],
      },
    ];
  }
}

export type PlacesProvider = Pick<PlacesClient, "nearby">;
