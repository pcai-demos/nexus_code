/**
 * U-DEDUPE — the duplicate check asks Weaviate a valid question and reports
 * what Weaviate answered (ticket T03; audit E04 / FM-D1; hypothesis H3).
 *
 * Measured live before this ticket (experiment X1, 2026-09-04, Weaviate
 * 1.25.6, RAGEval_t08_20260813, a docHash that IS present):
 *
 *   operator: "Equal"   → HTTP 200, no `data`, errors[0].message =
 *     'Argument "where" has invalid value {…operator: "Equal"…}.
 *      In field "operator": Expected type
 *      "AggregateObjectsRAGEval_t08_20260813WhereOperatorEnum", found "Equal".'
 *   operator: Equal     → meta.count 65 (present)  /  0 (absent hash)
 *
 * So the failing response was a 200 that the old `|| 0` read as "not
 * present" — not a transport error, and never logged. The contract pinned
 * here (design D1, owner-approved):
 *   - the enum is unquoted and the hash is a JSON string literal;
 *   - a numeric count answers the question: >0 true, 0 false;
 *   - GraphQL `errors[]`, a non-JSON 200, or a body without a numeric
 *     meta.count THROWS, as countObjects does — a fabricated "not present" is
 *     E04 by another door (the ingest route's job catch reports it as
 *     INGEST_FAILED, before any delete or insert);
 *   - a positive answer is logged with the count (F-48);
 *   - a transport failure (fetch throws, non-2xx, timeout) keeps the ticket's
 *     log-and-return-false, with the body capped in the log.
 *
 * These are pure-function tests over a stubbed fetch; the live half is
 * I-IDEMPOTENT's skip case.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");

const CLASS = "RAGEval_x";
const HASH = "14fe0a24c9fb7a031f91a4b615d85df7";

function fetchStub(responses) {
  const calls = [];
  const stub = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    const next = responses.shift();
    if (!next) throw new Error(`fetch stub exhausted at ${opts.method || "GET"} ${url}`);
    if (next instanceof Error) throw next;
    const body = typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {});
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  stub.calls = calls;
  return stub;
}

async function withFetch(stub, fn) {
  const original = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

async function withSilencedConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

const client = () => new WeaviateClient("http://weaviate.test", "x", CLASS);
const aggregate = (count) => ({ status: 200, body: { data: { Aggregate: { [CLASS]: [{ meta: { count } }] } } } });
/** The exact body X1 captured, with the class renamed. */
const X1_ERRORS = {
  status: 200,
  body: {
    errors: [
      {
        locations: [{ column: 18, line: 4 }],
        message:
          `Argument "where" has invalid value {path: ["docHash"], operator: "Equal", valueText: "${HASH}"}.\n` +
          `In field "operator": Expected type "AggregateObjects${CLASS}WhereOperatorEnum", found "Equal".`,
        path: null,
      },
    ],
  },
};

function sentQuery(stub) {
  assert.strictEqual(stub.calls.length, 1, "exactly one request");
  assert.match(stub.calls[0].url, /\/v1\/graphql$/);
  return JSON.parse(stub.calls[0].body).query;
}

describe("U-DEDUPE/E04: the generated GraphQL is valid", () => {
  test("the operator is the bare enum Equal — never a string literal", async () => {
    const stub = fetchStub([aggregate(65)]);
    await withFetch(stub, () => client().checkDocHashExists(HASH));
    const query = sentQuery(stub);
    assert.match(query, /operator:\s*Equal\b/, query);
    assert.doesNotMatch(query, /operator:\s*"/, "the enum is quoted (E04)");
    assert.doesNotMatch(query, /"Equal"/, "the enum is quoted (E04)");
  });

  test("it is an Aggregate over this class filtered on docHash, and the hash is a JSON string literal", async () => {
    const stub = fetchStub([aggregate(65)]);
    await withFetch(stub, () => client().checkDocHashExists(HASH));
    const query = sentQuery(stub);
    assert.match(query, /Aggregate\s*\{\s*RAGEval_x\s*\(/);
    assert.match(query, /path:\s*\["docHash"\]/);
    assert.match(query, new RegExp(`valueText:\\s*${JSON.stringify(HASH)}`));
    assert.match(query, /meta\s*\{\s*count\s*\}/);
  });

  test("a hash containing a quote or backslash is escaped, not interpolated raw", async () => {
    // docHash is an md5 hex digest in practice; the escaping is pinned so the
    // literal can never be broken open by a value that is not.
    const nasty = 'ab"cd\\ef';
    const stub = fetchStub([aggregate(0)]);
    await withFetch(stub, () => client().checkDocHashExists(nasty));
    const query = sentQuery(stub);
    assert.ok(query.includes(`valueText: ${JSON.stringify(nasty)}`), query);
    assert.ok(!query.includes(`valueText: "${nasty}"`), "raw interpolation");
  });
});

describe("U-DEDUPE/D1: the answer is Weaviate's, or the method throws", () => {
  test("a positive count is present", async () => {
    assert.strictEqual(await withFetch(fetchStub([aggregate(65)]), () => client().checkDocHashExists(HASH)), true);
    assert.strictEqual(await withFetch(fetchStub([aggregate(1)]), () => client().checkDocHashExists(HASH)), true);
  });

  test("a count of zero is absent", async () => {
    assert.strictEqual(await withFetch(fetchStub([aggregate(0)]), () => client().checkDocHashExists(HASH)), false);
  });

  test("the X1 response — HTTP 200 with GraphQL errors and no data — throws with Weaviate's message", async () => {
    // This is the exact shape that read as "not present" before T03. It is a
    // defect in the question, never an answer to it.
    await withFetch(fetchStub([X1_ERRORS]), async () => {
      await assert.rejects(
        () => client().checkDocHashExists(HASH),
        (err) => /WhereOperatorEnum/.test(err.message) && /RAGEval_x/.test(err.message)
      );
    });
  });

  test("a non-JSON 200 (a proxy or gateway page) throws rather than being laundered through the transport catch", async () => {
    // fetchStub's json() is JSON.parse(body): a string body with status 200
    // is exactly a 200 whose body is not Weaviate's answer.
    const { lines } = await withSilencedConsoleError(async () => {
      await withFetch(fetchStub([{ status: 200, body: "<html>gateway timeout</html>" }]), async () => {
        await assert.rejects(() => client().checkDocHashExists(HASH), /non-JSON 200.*no meta\.count/);
      });
    });
    assert.strictEqual(lines.length, 0, `laundered into a transport failure: ${lines.join(" | ")}`);
  });

  test("a positive answer is logged with the count (F-48: a skipped document's size is on record)", async () => {
    const original = console.log;
    const logged = [];
    console.log = (...args) => logged.push(args.map(String).join(" "));
    try {
      assert.strictEqual(await withFetch(fetchStub([aggregate(65)]), () => client().checkDocHashExists(HASH)), true);
    } finally {
      console.log = original;
    }
    assert.strictEqual(logged.length, 1, "one log line for a present document");
    assert.match(logged[0], /65 chunk\(s\)/);
    assert.match(logged[0], /RAGEval_x/);
    assert.match(logged[0], new RegExp(HASH));
  });

  test("a 200 without a numeric meta.count throws rather than inventing 'absent'", async () => {
    for (const body of [
      { data: { Aggregate: { [CLASS]: null } } },
      { data: { Aggregate: { [CLASS]: [] } } },
      { data: { Aggregate: { [CLASS]: [{ meta: {} }] } } },
      { hello: "world" },
    ]) {
      await withFetch(fetchStub([{ status: 200, body }]), async () => {
        await assert.rejects(() => client().checkDocHashExists(HASH), /no meta\.count/, JSON.stringify(body));
      });
    }
  });

  test("a transport failure keeps the ticket's log-and-return-false (non-2xx)", async () => {
    const { result, lines } = await withSilencedConsoleError(() =>
      withFetch(fetchStub([{ status: 503, body: "upstream unavailable" }]), () => client().checkDocHashExists(HASH))
    );
    assert.strictEqual(result, false);
    assert.strictEqual(lines.length, 1, "the failure is logged, once");
    assert.match(lines[0], /checkDocHashExists/);
    assert.match(lines[0], /503/);
    assert.match(lines[0], /upstream unavailable/);
  });

  test("a non-2xx body is capped and flattened in the log, never dumped whole", async () => {
    const page = "<html>\n" + "x".repeat(5000) + "\n</html>";
    const { result, lines } = await withSilencedConsoleError(() =>
      withFetch(fetchStub([{ status: 502, body: page }]), () => client().checkDocHashExists(HASH))
    );
    assert.strictEqual(result, false);
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].length < 400, `log line is ${lines[0].length} chars`);
    assert.ok(!lines[0].includes("\n"), "a multi-line body must not forge log lines");
  });

  test("the request carries a timeout, as countObjects does", async () => {
    const stub = fetchStub([aggregate(0)]);
    const seen = [];
    const spy = async (url, opts) => { seen.push(opts.signal); return stub(url, opts); };
    await withFetch(spy, () => client().checkDocHashExists(HASH));
    assert.ok(seen[0] instanceof AbortSignal, "no AbortSignal on the duplicate check");
  });

  test("a transport failure keeps the ticket's log-and-return-false (fetch throws)", async () => {
    const { result, lines } = await withSilencedConsoleError(() =>
      withFetch(fetchStub([new Error("ECONNREFUSED")]), () => client().checkDocHashExists(HASH))
    );
    assert.strictEqual(result, false);
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /ECONNREFUSED/);
  });

  test("a GraphQL error is not laundered through the transport catch", async () => {
    // The throw for an invalid question must escape: if the catch that logs
    // transport failures also swallowed it, E04's masking would be back.
    const { lines } = await withSilencedConsoleError(async () => {
      await withFetch(fetchStub([X1_ERRORS]), async () => {
        await assert.rejects(() => client().checkDocHashExists(HASH));
      });
    });
    assert.strictEqual(lines.length, 0, `unexpected console.error: ${lines.join(" | ")}`);
  });

  test("the plain client may ask — this is a read, not a destructive operation", async () => {
    const plain = new WeaviateClient("http://weaviate.test", "x", CLASS);
    assert.strictEqual(plain.destructive, false);
    assert.strictEqual(await withFetch(fetchStub([aggregate(3)]), () => plain.checkDocHashExists(HASH)), true);
    const destructive = WeaviateClient.forDestructiveOps("http://weaviate.test", "x", CLASS);
    assert.strictEqual(await withFetch(fetchStub([aggregate(0)]), () => destructive.checkDocHashExists(HASH)), false);
  });
});
