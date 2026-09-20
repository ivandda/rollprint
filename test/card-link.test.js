/** @import { Token, TokenArt } from "../src/designs.js" */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardLink, LINK_PARAM, readCardLink } from "../src/card-link.js";

const PAGE = "https://ivandda.github.io/rollprint/?q=goblin#top";

/** @type {TokenArt} */
const ART = {
  fit: "fill",
  zoom: 1.2,
  x: 0.4,
  y: 0.5,
  source: { url: "https://cards.scryfall.io/art_crop/a.jpg" },
};

/** @type {Token} */
const AETHER = {
  id: "aether",
  name: "Æther Sprite ★",
  manaCost: "{1}{U}",
  typeLine: "Creature — Faerie",
  power: "1",
  toughness: "1",
  rules: "Flying\n{T}: Draw a card.",
  art: {
    fit: "fill",
    zoom: 1.2,
    x: 0.4,
    y: 0.5,
    source: { url: "https://cards.scryfall.io/art_crop/a.jpg" },
  },
};

/** @param {string} link */
const linkValue = (link) => new URL(link).searchParams.get(LINK_PARAM) ?? "";

test("a card comes back from its link as it was, and the link opens Create", () => {
  const link = cardLink(AETHER, PAGE);
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://ivandda.github.io/rollprint/");
  assert.equal(url.searchParams.get("mode"), "create");
  assert.equal(url.hash, "");
  assert.match(linkValue(link), /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(readCardLink(linkValue(link)), AETHER);
});

test("an image added from the device isn't in the link", () => {
  const withImage = { ...AETHER, art: { ...ART, source: { image: "image-1" } } };
  const { art, ...withoutArt } = AETHER;
  assert.deepEqual(readCardLink(linkValue(cardLink(withImage, PAGE))), withoutArt);
});

test("a damaged link has no card", () => {
  assert.equal(readCardLink(""), undefined);
  assert.equal(readCardLink("not base64 !!"), undefined);
  assert.equal(readCardLink(linkValue(cardLink(AETHER, PAGE)).slice(0, 40)), undefined);
  const elsewhere = { ...AETHER, art: { ...ART, source: { url: "https://example.com/a.jpg" } } };
  assert.equal(readCardLink(linkValue(cardLink(elsewhere, PAGE))), undefined);
});
