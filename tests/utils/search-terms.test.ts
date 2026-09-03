import { splitSearchTerms, INNODB_STOPWORDS, MIN_SEARCH_TOKEN_LENGTH } from "../../src/utils/search-terms.js";

describe("splitSearchTerms", () => {
  it("splits on whitespace and punctuation the way upstream Search::Query#sanitize does", () => {
    expect(splitSearchTerms("prodmon-data-analyst cannot.find/package nunjucks")).toEqual({
      terms: ["prodmon", "data", "analyst", "cannot", "find", "package", "nunjucks"],
      ignored: [],
    });
  });

  it("splits on double quotes, as the upstream stemmer strips them before matching", () => {
    expect(splitSearchTerms('"foo bar" baz"qux').terms).toEqual(["foo", "bar", "baz", "qux"]);
  });

  it("keeps underscores and digits inside a word", () => {
    expect(splitSearchTerms("reporter_source 2026").terms).toEqual(["reporter_source", "2026"]);
  });

  it("drops InnoDB stopwords and words shorter than the minimum token size, reporting them", () => {
    expect(splitSearchTerms("the api to ab with bug")).toEqual({
      terms: ["api", "bug"],
      ignored: ["the", "to", "ab", "with"],
    });
  });

  it("deduplicates case-insensitively, keeping the first spelling", () => {
    expect(splitSearchTerms("Card card CARD error")).toEqual({
      terms: ["Card", "error"],
      ignored: [],
    });
  });

  it("returns no terms for punctuation-only or stopword-only input", () => {
    expect(splitSearchTerms("--- ...")).toEqual({ terms: [], ignored: [] });
    expect(splitSearchTerms("the a to")).toEqual({ terms: [], ignored: ["the", "a", "to"] });
  });

  it("treats every stopword in the list as ignorable", () => {
    for (const word of INNODB_STOPWORDS) {
      expect(splitSearchTerms(word).terms).toEqual([]);
    }
    expect(MIN_SEARCH_TOKEN_LENGTH).toBe(3);
  });
});
