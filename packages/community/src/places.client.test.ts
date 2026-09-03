/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { ExternalApiError } from "@calebx/errors";
import { PlacesClient, StubPlacesClient } from "./places.client.ts";

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response,
): typeof fetch {
  return ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init))) as unknown as typeof fetch;
}

function apiResponse(places: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ places }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BLR = { latitude: 12.9716, longitude: 77.6412 };

describe("PlacesClient.nearby", () => {
  it("maps the API response into suggestions", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() =>
        apiResponse([
          {
            id: "ChIJ123",
            displayName: { text: "Third Wave Coffee" },
            formattedAddress: "Koramangala, Bengaluru",
            rating: 4.4,
            userRatingCount: 900,
          },
        ]),
      ),
    });

    const [place] = await client.nearby({ ...BLR, category: "cafe" });
    expect(place).toEqual({
      placeId: "ChIJ123",
      name: "Third Wave Coffee",
      address: "Koramangala, Bengaluru",
      rating: 4.4,
      userRatingCount: 900,
      ourTags: ["cafe"],
    });
  });

  it("sends the api key and a field mask", async () => {
    let headers: Record<string, string> = {};
    const client = new PlacesClient({
      apiKey: "secret-key",
      fetchImpl: stubFetch((_url, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
        return apiResponse([]);
      }),
    });
    await client.nearby({ ...BLR, category: "cafe" });
    expect(headers["X-Goog-Api-Key"]).toBe("secret-key");
    // The field mask is required by the API and is also a billing tier.
    expect(headers["X-Goog-FieldMask"]).toContain("places.id");
  });

  it("translates our category into Google place types", async () => {
    let body: { includedTypes?: string[] } = {};
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return apiResponse([]);
      }),
    });
    await client.nearby({ ...BLR, category: "cafe" });
    expect(body.includedTypes).toEqual(["cafe", "coffee_shop"]);
  });

  it("puts the geo filter in the request, since Neo4j holds no coordinates", async () => {
    let body: { locationRestriction?: { circle?: { radius?: number } } } = {};
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return apiResponse([]);
      }),
    });
    await client.nearby({ ...BLR, category: "cafe", radiusMeters: 3_000 });
    expect(body.locationRestriction?.circle?.radius).toBe(3_000);
  });

  it("clamps the radius to the API ceiling", async () => {
    let body: { locationRestriction?: { circle?: { radius?: number } } } = {};
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return apiResponse([]);
      }),
    });
    await client.nearby({ ...BLR, category: "cafe", radiusMeters: 999_999 });
    expect(body.locationRestriction?.circle?.radius).toBe(50_000);
  });

  it("clamps the result count", async () => {
    let body: { maxResultCount?: number } = {};
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch((_url, init) => {
        body = JSON.parse(String(init?.body));
        return apiResponse([]);
      }),
    });
    await client.nearby({ ...BLR, category: "cafe", limit: 500 });
    expect(body.maxResultCount).toBe(20);
  });

  it("rejects an unknown category instead of searching for everything", async () => {
    // Without types, this becomes every business in the radius ranked by nothing.
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() => apiResponse([])),
    });
    await expect(
      client.nearby({ ...BLR, category: "astrology" }),
    ).rejects.toThrow(/unsupported place category/);
  });

  it("drops results with no place id", async () => {
    // placeId is the only field we may persist, so a result without one is
    // unusable downstream.
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() =>
        apiResponse([{ displayName: { text: "Nameless" } }, { id: "ChIJ1" }]),
      ),
    });
    const places = await client.nearby({ ...BLR, category: "cafe" });
    expect(places).toHaveLength(1);
    expect(places[0].placeId).toBe("ChIJ1");
  });

  it("fills in defaults for missing optional fields", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() => apiResponse([{ id: "ChIJ1" }])),
    });
    const [place] = await client.nearby({ ...BLR, category: "cafe" });
    expect(place.name).toBe("Unnamed place");
    expect(place.address).toBeNull();
    expect(place.rating).toBeNull();
  });

  it("raises ExternalApiError with the status on a failure", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() => new Response("quota", { status: 429 })),
    });
    await expect(client.nearby({ ...BLR, category: "cafe" })).rejects.toThrow(
      /returned 429/,
    );
  });

  it("handles a response with no places array", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: stubFetch(() => new Response("{}", { status: 200 })),
    });
    expect(await client.nearby({ ...BLR, category: "cafe" })).toEqual([]);
  });

  it("times out rather than hanging a turn", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      timeoutMs: 5,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch,
    });
    await expect(client.nearby({ ...BLR, category: "cafe" })).rejects.toThrow(
      /timed out after 5ms/,
    );
    await expect(
      client.nearby({ ...BLR, category: "cafe" }),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });

  it("wraps a transport failure", async () => {
    const client = new PlacesClient({
      apiKey: "k",
      fetchImpl: (() =>
        Promise.reject(new Error("ENOTFOUND"))) as unknown as typeof fetch,
    });
    await expect(client.nearby({ ...BLR, category: "cafe" })).rejects.toThrow(
      /unreachable/,
    );
  });
});

describe("StubPlacesClient", () => {
  it("returns an obviously-fake place so it cannot be mistaken for real data", async () => {
    const [place] = await new StubPlacesClient().nearby({
      ...BLR,
      category: "cafe",
    });
    expect(place.placeId).toBe("stub-cafe-1");
    expect(place.name).toContain("Example");
  });

  it("returns supplied places when given them", async () => {
    const stub = new StubPlacesClient([
      {
        placeId: "p1",
        name: "Fixture Cafe",
        address: null,
        rating: null,
        userRatingCount: null,
        ourTags: ["cafe"],
      },
    ]);
    const [place] = await stub.nearby({ ...BLR, category: "cafe" });
    expect(place.name).toBe("Fixture Cafe");
  });
});
