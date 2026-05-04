import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalDocument, isBotLikeAuthor } from "./normalize.js";

test("bot detection catches bot users and common automation", () => {
  assert.equal(isBotLikeAuthor({ authorLogin: "dependabot[bot]" }), true);
  assert.equal(isBotLikeAuthor({ authorType: "Bot" }), true);
  assert.equal(isBotLikeAuthor({ authorLogin: "maintainer" }), false);
});

test("canonical document excludes bot comments from dedupe text", () => {
  const document = buildCanonicalDocument({
    title: "Downloader stalls",
    body: "The transfer never finishes.",
    labels: ["bug"],
    comments: [
      { body: "same failure on macOS", authorLogin: "alice", authorType: "User", isBot: false },
      {
        body: "automated reminder",
        authorLogin: "github-actions[bot]",
        authorType: "Bot",
        isBot: true,
      },
    ],
  });

  assert.match(document.rawText, /same failure on macOS/);
  assert.doesNotMatch(document.dedupeText, /automated reminder/);
});
