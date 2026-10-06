import { describe, expect, it } from "vitest";
import { billingUnits } from "./cost";

describe("billingUnits", () => {
  it("DataForSEO bills per 10 results", () => {
    expect(billingUnits("dataforseo", 10)).toBe(1);
    expect(billingUnits("dataforseo", 30)).toBe(3);
  });
  it("Bright Data Google is one request per results page; Yandex one request", () => {
    expect(billingUnits("brightdata", 10)).toBe(1);
    expect(billingUnits("brightdata", 20)).toBe(2);
    expect(billingUnits("brightdata", 20, "yandex")).toBe(1);
  });
  it("SerpAPI and Oxylabs bill per request regardless of depth", () => {
    expect(billingUnits("serpapi", 20)).toBe(1);
    expect(billingUnits("oxylabs", 100)).toBe(1);
  });
});
