/** @import { ScryfallCard, ScryfallClient } from "../scryfall/client.js" */
import { ScryfallError } from "../scryfall/client.js";
import { addressParam, updateAddress } from "./address.js";
import { cardThumbnail, element, showMessage, showProblem } from "./dom.js";

const SEARCH_DELAY_MS = 300;

/**
 * Tokens shown before anything is searched, so the page starts full: the ones most decks make,
 * in this order.
 */
const COMMON_TOKENS = [
  "Treasure",
  "Clue",
  "Food",
  "Blood",
  "Map",
  "Powerstone",
  "Goblin",
  "Soldier",
  "Zombie",
  "Spirit",
  "Saproling",
  "Angel",
  "Thopter",
  "Servo",
  "Wolf",
  "Human",
  "Knight",
  "Dragon",
  "Elf Warrior",
  "Cat",
];

/** Printings of the same card share an Oracle ID. @param {ScryfallCard} card */
const groupOf = (card) => card.oracle_id ?? card.id;

/**
 * The search box, suggestions and results.
 * @param {object} options
 * @param {ScryfallClient} options.scryfall
 * @param {(card: ScryfallCard) => void} options.onSelect
 */
export function createSearch({ scryfall, onSelect }) {
  const ui = {
    form: element("#search", HTMLFormElement),
    query: element("#query", HTMLInputElement),
    allCards: element('input[name="scope"][value="all"]', HTMLInputElement),
    tokens: element('input[name="scope"][value="tokens"]', HTMLInputElement),
    status: element("#results-status", HTMLElement),
    results: element("#results", HTMLUListElement),
    more: element("#more", HTMLButtonElement),
  };
  /** @type {ScryfallCard[]} */
  let results = [];
  /** The common tokens, once loaded. @type {ScryfallCard[] | undefined} */
  let common;
  let nextPage = 0;
  /** @type {string | undefined} */
  let chosenGroup;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let searchId = 0;

  ui.form.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DELAY_MS);
  });

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    search();
  });

  ui.more.addEventListener("click", () => search(nextPage));

  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    // The search box is out of reach while a label from the print list is being changed.
    const browsing = document.body.dataset.mode === "find" && !document.body.dataset.editing;
    if (event.key !== "/" || typing || !browsing) return;
    event.preventDefault();
    ui.query.focus();
  });

  async function search(page = 1) {
    const text = ui.query.value.trim();
    const id = ++searchId;
    const tokensOnly = !ui.allCards.checked;
    updateAddress({ q: text || undefined, scope: tokensOnly ? undefined : "all" });
    if (!text) {
      nextPage = 0;
      await showCommon(id);
      return;
    }

    if (page === 1) showMessage(ui.status, "Searching…");
    showMoreLoading(page > 1);
    try {
      const list = await scryfall.search(`${tokensOnly ? "t:token " : ""}game:paper (${text})`, { page });
      if (id !== searchId) return;
      results = page === 1 ? list.data : [...results, ...list.data];
      nextPage = list.has_more ? page + 1 : 0;
      const [one, many] = tokensOnly ? ["token", "tokens"] : ["card", "cards"];
      if (list.total_cards === 0) {
        showMessage(ui.status, `No ${many} match “${text}”.${tokensOnly ? " Try searching all cards." : ""}`);
      } else {
        showMessage(ui.status, `${list.total_cards} ${list.total_cards === 1 ? one : many}`);
      }
      showResults();
    } catch (error) {
      if (id !== searchId) return;
      showProblem(ui.status, unreachable(error));
    } finally {
      if (id === searchId) showMoreLoading(false);
    }
  }

  /**
   * Shows the common tokens in place of results while the search box is empty.
   * @param {number} id  The search this belongs to; a newer one takes over.
   */
  async function showCommon(id) {
    if (!common) {
      results = [];
      showResults();
      showMessage(ui.status, "Common tokens");
      try {
        // An exact name also matches one face of a double-faced token, so those are left out, and
        // a name with several different tokens (Goblin 1/1, Goblin with haste) shows one of them.
        const names = COMMON_TOKENS.map((name) => `!"${name}"`).join(" or ");
        const list = await scryfall.search(`t:token game:paper -is:dfc (${names})`);
        common = COMMON_TOKENS.flatMap((name) => list.data.find((card) => card.name === name) ?? []);
      } catch (error) {
        if (id === searchId) showProblem(ui.status, unreachable(error));
        return;
      }
    }
    if (id !== searchId) return;
    results = common;
    showMessage(ui.status, "Common tokens. Search for any card or token above.");
    showResults();
  }

  /** @param {boolean} loading */
  function showMoreLoading(loading) {
    ui.more.disabled = loading;
    ui.more.textContent = loading ? "Loading…" : "Show more";
  }

  function showResults() {
    ui.results.replaceChildren(...results.map(resultItem));
    ui.more.hidden = !nextPage;
  }

  /** @param {ScryfallCard} card */
  function resultItem(card) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result";
    button.dataset.group = groupOf(card);
    button.setAttribute("aria-pressed", String(groupOf(card) === chosenGroup));
    button.append(
      cardThumbnail(card, "normal", "result-image"),
      Object.assign(document.createElement("span"), { className: "result-name", textContent: card.name }),
    );
    button.addEventListener("click", () => {
      chosenGroup = groupOf(card);
      for (const result of ui.results.querySelectorAll("button")) {
        result.setAttribute("aria-pressed", String(result.dataset.group === chosenGroup));
      }
      onSelect(card);
    });
    const item = document.createElement("li");
    item.append(button);
    return item;
  }

  ui.query.value = addressParam("q") ?? "";
  ui.allCards.checked = addressParam("scope") === "all";
  ui.tokens.checked = !ui.allCards.checked;
  search();

  return {
    /** @param {string} message  Something that went wrong opening a card from the address. */
    showStatus(message) {
      showProblem(ui.status, message);
    },
  };
}

/** @param {unknown} error */
const unreachable = (error) =>
  error instanceof ScryfallError
    ? error.message
    : "Couldn't reach Scryfall. Check your connection and try again.";
