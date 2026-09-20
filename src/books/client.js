/**
 * Open Library client that stays within the published rate limits
 * (https://openlibrary.org/developers/api): requests go out one at a time and at most one a second.
 * That is the limit for a browser, as the three-a-second tier needs a User-Agent header naming the
 * app and browsers forbid setting one. Responses are cached, as Open Library asks. Covers are
 * served from covers.openlibrary.org, which allows any origin and, looked up by cover ID as they
 * are here, is not rate-limited, so they are fetched directly rather than through this client.
 *
 * Open Library's covers stop at 500 pixels tall, which is less than a label prints. `highResCover`
 * looks the book up in Apple's ebook catalogue instead, whose artwork is about 1400 tall. That
 * search matches on title and author and will confidently return the wrong book, so what it finds
 * is offered for the reader to accept and never swapped in on its own.
 */

/**
 * A book found in Open Library.
 * @typedef {object} Book
 * @property {string} id  Its work key, e.g. "OL27479W".
 * @property {string} title
 * @property {string} author  The first author named, or "" when none is.
 * @property {number} [year]  First published.
 * @property {number} [cover]  Open Library's cover ID, missing when it has no cover.
 */

/**
 * A cover found in Apple's catalogue, for the reader to compare with the one they have.
 * @typedef {{ url: string, title: string, author: string }} HighResCover
 */

/** @typedef {ReturnType<typeof createBookClient>} BookClient */

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVERS_URL = "https://covers.openlibrary.org/b/id";
const APPLE_URL = "https://itunes.apple.com/search";

/** Open Library's limit for requests that cannot name themselves. */
const SEARCH_INTERVAL_MS = 1000;
/** Apple allows about twenty calls a minute. */
const APPLE_INTERVAL_MS = 3000;
const CACHE_SIZE = 50;
/** Books in one page of results. */
export const SEARCH_LIMIT = 24;
/** Only the fields a result shows: the whole document is thousands of times larger. */
const FIELDS = "key,title,author_name,first_publish_year,cover_i";
/** The size Apple's artwork is asked for. Covers come back about this tall and proportionally wide. */
const APPLE_SIZE = 1400;

export class BookError extends Error {
  /**
   * @param {string} message
   * @param {number} status  HTTP status code, or 0 when the request never arrived.
   */
  constructor(message, status) {
    super(message);
    this.name = "BookError";
    this.status = status;
  }
}

/**
 * The address of a book's cover, at the size a thumbnail or a label needs. Covers are looked up by
 * cover ID, the one key Open Library does not rate-limit.
 * @param {number} cover  Open Library's cover ID.
 * @param {"S" | "M" | "L"} size
 */
export const coverUrl = (cover, size) => `${COVERS_URL}/${cover}-${size}.jpg`;

/**
 * @param {object} [dependencies]  Replaceable in tests.
 * @param {typeof globalThis.fetch} [dependencies.fetch]
 * @param {(ms: number) => Promise<void>} [dependencies.wait]
 * @param {() => number} [dependencies.now]
 */
export function createBookClient({
  fetch = globalThis.fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  /** @type {Map<string, Promise<any>>} */
  const cache = new Map();
  let queue = Promise.resolve();
  /** When each host was last asked, so each keeps its own pace. @type {Map<string, number>} */
  const lastRequestAt = new Map();

  /**
   * @param {string} url
   * @param {number} interval  The least time between two requests to this host.
   */
  function get(url, interval) {
    const cached = cache.get(url);
    if (cached) return cached;

    const response = queue.then(() => send(url, interval));
    queue = response.then(
      () => {},
      () => {},
    );
    cache.set(url, response);
    response.catch(() => cache.delete(url));
    const oldest = cache.keys().next().value;
    if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest);
    return response;
  }

  /**
   * @param {string} url
   * @param {number} interval
   * @returns {Promise<any>}
   */
  async function send(url, interval) {
    const host = new URL(url).host;
    await wait(Math.max(0, (lastRequestAt.get(host) ?? Number.NEGATIVE_INFINITY) + interval - now()));
    lastRequestAt.set(host, now());

    let response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      // fetch rejects when the network is down, and when a reply arrives without the CORS header
      // that lets this page read it.
      throw new BookError("Couldn't reach the book catalogue. Check your connection.", 0);
    }
    if (response.status === 403 || response.status === 429) {
      throw new BookError("Too many searches just now. Wait a moment and try again.", response.status);
    }
    if (!response.ok) throw new BookError(`The book search failed (${response.status}).`, response.status);
    return response.json().catch(() => {
      throw new BookError("The book catalogue sent something unreadable.", response.status);
    });
  }

  return {
    /**
     * Books matching what was typed. Open Library takes fielded terms too, like `title:dune` or
     * `isbn:9780441013593`. Books without a cover are left out: there would be nothing to print.
     * @param {string} query
     * @returns {Promise<Book[]>}
     */
    async search(query) {
      const terms = query.trim();
      if (!terms) return [];
      const params = new URLSearchParams({ q: terms, limit: String(SEARCH_LIMIT), fields: FIELDS });
      const reply = await get(`${SEARCH_URL}?${params}`, SEARCH_INTERVAL_MS);
      /** @type {Record<string, any>[]} */
      const docs = Array.isArray(reply?.docs) ? reply.docs : [];
      return docs.filter((doc) => typeof doc.cover_i === "number").map(bookOf);
    },

    /**
     * A sharper cover for a book, from Apple's ebook catalogue, or nothing when it has none. The
     * title and author it matched come back with it: the search takes the closest name it finds and
     * is wrong often enough that the reader has to be the one to accept it.
     * @param {{ title: string, author: string }} book
     * @returns {Promise<HighResCover | undefined>}
     */
    async highResCover({ title, author }) {
      const term = `${title} ${author}`.trim();
      if (!term) return undefined;
      const params = new URLSearchParams({ term, entity: "ebook", limit: "1" });
      const reply = await get(`${APPLE_URL}?${params}`, APPLE_INTERVAL_MS);
      const [found] = Array.isArray(reply?.results) ? reply.results : [];
      const artwork = typeof found?.artworkUrl100 === "string" ? found.artworkUrl100 : "";
      if (!artwork) return undefined;
      // Apple serves any size as the last part of the path, and the hundred-pixel one it names is
      // far too small to print.
      const url = artwork.replace(/\/[^/]+$/, `/${APPLE_SIZE}x${APPLE_SIZE}bb.jpg`);
      if (url === artwork) return undefined;
      return {
        url,
        title: typeof found.trackName === "string" ? found.trackName : "",
        author: typeof found.artistName === "string" ? found.artistName : "",
      };
    },
  };
}

/**
 * One of Open Library's search results, as this app uses it.
 * @param {Record<string, any>} doc
 * @returns {Book}
 */
function bookOf(doc) {
  const key = typeof doc.key === "string" ? doc.key : "";
  return {
    id: key.replace(/^\/works\//, ""),
    title: typeof doc.title === "string" ? doc.title : "Untitled",
    author:
      Array.isArray(doc.author_name) && typeof doc.author_name[0] === "string" ? doc.author_name[0] : "",
    year: typeof doc.first_publish_year === "number" ? doc.first_publish_year : undefined,
    cover: doc.cover_i,
  };
}
