import assert from "node:assert/strict";
import { test } from "node:test";
import { BookError, coverUrl, createBookClient } from "../../src/books/client.js";

/**
 * A client whose network and clock are fakes. `replies` is consumed in order, one per request.
 * @param {{ status?: number, body?: object }[]} replies
 */
function fakeBooks(replies) {
  let clock = 0;
  /** @type {{ url: string, at: number }[]} */
  const requests = [];
  const client = createBookClient({
    fetch: async (url) => {
      requests.push({ url: String(url), at: clock });
      const { status = 200, body = {} } = replies.shift() ?? {};
      return new Response(JSON.stringify(body), { status });
    },
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  return { client, requests };
}

/**
 * @param {string} title
 * @param {number | undefined} cover
 */
const doc = (title, cover) => ({
  key: `/works/OL${title.length}W`,
  title,
  author_name: ["Frank Herbert"],
  first_publish_year: 1965,
  cover_i: cover,
});

test("searches go out one at a time, a second apart, as Open Library asks", async () => {
  const { client, requests } = fakeBooks([{ body: { docs: [] } }, { body: { docs: [] } }]);
  await Promise.all([client.search("dune"), client.search("hobbit")]);
  assert.deepEqual(
    requests.map(({ at }) => at),
    [0, 1000],
  );
});

test("the same search twice is served from the cache", async () => {
  const { client, requests } = fakeBooks([{ body: { docs: [doc("Dune", 1)] } }]);
  const [first, second] = await Promise.all([client.search("dune"), client.search("dune")]);
  assert.equal(requests.length, 1);
  assert.deepEqual(first, second);
});

test("a failed search is not cached, so trying again really tries again", async () => {
  const { client, requests } = fakeBooks([{ status: 500 }, { body: { docs: [] } }]);
  await assert.rejects(() => client.search("dune"), BookError);
  await client.search("dune");
  assert.equal(requests.length, 2);
});

test("a search asks only for the fields a result shows", async () => {
  const { client, requests } = fakeBooks([{ body: { docs: [] } }]);
  await client.search("dune");
  const { searchParams } = new URL(requests[0].url);
  assert.equal(searchParams.get("q"), "dune");
  assert.equal(searchParams.get("fields"), "key,title,author_name,first_publish_year,cover_i");
});

test("books with no cover are left out: there would be nothing to print", async () => {
  const { client } = fakeBooks([{ body: { docs: [doc("Dune", 1), doc("Dune Messiah", undefined)] } }]);
  assert.deepEqual(
    (await client.search("dune")).map(({ title }) => title),
    ["Dune"],
  );
});

test("a result keeps its work key, author and year", async () => {
  const { client } = fakeBooks([{ body: { docs: [doc("Dune", 11481354)] } }]);
  assert.deepEqual(await client.search("dune"), [
    { id: "OL4W", title: "Dune", author: "Frank Herbert", year: 1965, cover: 11481354 },
  ]);
});

test("an empty search asks nothing at all", async () => {
  const { client, requests } = fakeBooks([]);
  assert.deepEqual(await client.search("   "), []);
  assert.equal(requests.length, 0);
});

test("being rate-limited says so plainly rather than trying again and making it worse", async () => {
  for (const status of [403, 429]) {
    const { client, requests } = fakeBooks([{ status }]);
    await assert.rejects(() => client.search("dune"), /Too many searches/);
    assert.equal(requests.length, 1, "no retry");
  }
});

test("a reply this page isn't allowed to read reads as being unable to reach the catalogue", async () => {
  const client = createBookClient({
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
    wait: async () => {},
    now: () => 0,
  });
  await assert.rejects(() => client.search("dune"), /Couldn't reach the book catalogue/);
});

test("a sharper cover is asked for at a size worth printing", async () => {
  const artwork = "https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/a/b/c.jpg/100x100bb.jpg";
  const { client, requests } = fakeBooks([
    { body: { results: [{ artworkUrl100: artwork, trackName: "Dune", artistName: "Frank Herbert" }] } },
  ]);
  const cover = await client.highResCover({ title: "Dune", author: "Frank Herbert" });
  assert.deepEqual(cover, {
    url: "https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/a/b/c.jpg/1400x1400bb.jpg",
    title: "Dune",
    author: "Frank Herbert",
  });
  assert.equal(new URL(requests[0].url).searchParams.get("entity"), "ebook");
});

test("the sharper cover names the book it matched, which may not be the one asked for", async () => {
  const artwork = "https://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg/100x100bb.jpg";
  const { client } = fakeBooks([
    {
      body: { results: [{ artworkUrl100: artwork, trackName: "The Midnight Train", artistName: "Someone" }] },
    },
  ]);
  const cover = await client.highResCover({ title: "The Midnight Library", author: "Matt Haig" });
  assert.equal(cover?.title, "The Midnight Train");
});

test("no sharper cover comes back when there is no match or no artwork", async () => {
  const { client } = fakeBooks([{ body: { results: [] } }, { body: { results: [{ trackName: "Dune" }] } }]);
  assert.equal(await client.highResCover({ title: "Dune", author: "A" }), undefined);
  assert.equal(await client.highResCover({ title: "Dune", author: "B" }), undefined);
});

test("covers are addressed by cover ID, the one key Open Library does not rate-limit", () => {
  assert.equal(coverUrl(11481354, "L"), "https://covers.openlibrary.org/b/id/11481354-L.jpg");
  assert.equal(coverUrl(7, "M"), "https://covers.openlibrary.org/b/id/7-M.jpg");
});

test("each host keeps its own pace, so a cover lookup doesn't wait on a search", async () => {
  const artwork = "https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg";
  const { client, requests } = fakeBooks([
    { body: { docs: [] } },
    { body: { results: [{ artworkUrl100: artwork }] } },
  ]);
  await client.search("dune");
  await client.highResCover({ title: "Dune", author: "Frank Herbert" });
  assert.deepEqual(
    requests.map(({ at }) => at),
    [0, 0],
  );
});
