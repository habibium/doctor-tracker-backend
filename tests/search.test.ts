import { describe, expect, it } from "vitest";
import { phoneTokens, searchFilter, tokenize } from "../src/lib/search.ts";

describe("tokenize", () => {
  it("lowercases, splits on punctuation and removes duplicates", () => {
    expect(tokenize("Ayesha Rahman", "ayesha.rahman@Square-Hospital.example")).toEqual([
      "ayesha",
      "rahman",
      "square",
      "hospital",
      "example",
    ]);
  });

  it("keeps non-Latin letters", () => {
    expect(tokenize("আয়েশা রহমান")).toHaveLength(2);
  });

  it("ignores missing values", () => {
    expect(tokenize(undefined, "")).toEqual([]);
  });
});

describe("phoneTokens", () => {
  it("indexes both the international and the local form", () => {
    expect(phoneTokens("+880 1711-123456")).toEqual(["8801711123456", "01711123456"]);
  });

  it("keeps other numbers as plain digits", () => {
    expect(phoneTokens("01711 123456")).toEqual(["01711123456"]);
  });
});

describe("searchFilter", () => {
  it("returns no filter for an empty search", () => {
    expect(searchFilter("  ")).toEqual({});
    expect(searchFilter(undefined)).toEqual({});
  });

  it("requires every term as an anchored prefix", () => {
    expect(searchFilter("Rah Card")).toEqual({
      $and: [{ searchTokens: { $regex: "^rah" } }, { searchTokens: { $regex: "^card" } }],
    });
  });

  it("cannot be used to inject regex syntax", () => {
    expect(searchFilter(".*")).toEqual({});
  });
});
