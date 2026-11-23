import test from "node:test";
import assert from "node:assert/strict";
import { createUuid } from "../../src/shared/utils/createUuid.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function withCrypto(value, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
}

test("createUuid uses crypto.randomUUID when available", () => {
  assert.match(createUuid(), UUID_V4);
});

test("createUuid builds a v4 UUID without randomUUID (insecure http context)", () => {
  const realCrypto = globalThis.crypto;
  const ids = withCrypto({ getRandomValues: (bytes) => realCrypto.getRandomValues(bytes) }, () =>
    Array.from({ length: 50 }, () => createUuid()),
  );
  ids.forEach((id) => assert.match(id, UUID_V4));
  assert.equal(new Set(ids).size, ids.length);
});

test("createUuid still returns a v4 UUID without any crypto API", () => {
  assert.match(withCrypto(undefined, () => createUuid()), UUID_V4);
});
