import { describe, expect, it } from "vitest";
import { csvRows, parseKeywordFile, parsePasted } from "@/lib/keyword-import";

describe("parsePasted", () => {
  it("a keyword per line, a cluster after a Tab, a semicolon or a comma", () => {
    expect(parsePasted("casino\n\n  slots online\t Games \nbonus; Promo\nfree spins, Promo, extra\n")).toEqual([
      { keyword: "casino" },
      { keyword: "slots online", cluster: "Games" },
      { keyword: "bonus", cluster: "Promo" },
      { keyword: "free spins", cluster: "Promo, extra" },
    ]);
  });

  it("stray separators at a keyword's or cluster's ends are not part of it", () => {
    // Copied from a sheet whose first column ended in a comma.
    expect(parsePasted("casino online,\tBrand\nslots bonus ;\t; Brand")).toEqual([
      { keyword: "casino online", cluster: "Brand" },
      { keyword: "slots bonus", cluster: "Brand" },
    ]);
    expect(parseKeywordFile("casino online,;Brand\n")).toEqual([{ keyword: "casino online", cluster: "Brand" }]);
  });

  it("an empty cluster is given empty — it takes a cluster away", () => {
    expect(parsePasted("casino,")).toEqual([{ keyword: "casino", cluster: "" }]);
  });
});

describe("parseKeywordFile", () => {
  it("keyword and cluster columns, without a header", () => {
    expect(parseKeywordFile("casino;Brand\nslots;Games\n")).toEqual([
      { keyword: "casino", cluster: "Brand" }, { keyword: "slots", cluster: "Games" },
    ]);
  });

  it("a header names the columns, wherever they are; BOM and quotes are fine", () => {
    const file = '﻿Кластер,Запрос\r\nBrand,"casino, online"\r\nGames,slots\r\n';
    expect(parseKeywordFile(file)).toEqual([
      { keyword: "casino, online", cluster: "Brand" }, { keyword: "slots", cluster: "Games" },
    ]);
  });

  it("one column is keywords alone", () => {
    expect(parseKeywordFile("Keyword\ncasino\nslots\n")).toEqual([{ keyword: "casino" }, { keyword: "slots" }]);
  });

  it("csvRows keeps a separator and a doubled quote inside quotes", () => {
    expect(csvRows('a;"b;c";"say ""hi"""\n', ";")).toEqual([["a", "b;c", 'say "hi"']]);
  });
});
