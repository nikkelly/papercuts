import assert from "node:assert/strict";
import test from "node:test";

import { num, str, toJsonSchema, validate, type Fields } from "../plugin/src/schema.ts";

const fields: Fields = {
  name: str("The name"),
  tag: str("Area label", { optional: true }),
  level: str("Level", { optional: true, enum: ["low", "high"] }),
  count: num("Count", { optional: true }),
};

test("str and num build the expected field specs", () => {
  assert.deepEqual(str("Text"), { type: "string", description: "Text", optional: false });
  assert.deepEqual(str("Tag", { optional: true }), { type: "string", description: "Tag", optional: true });
  assert.deepEqual(str("Level", { enum: ["a", "b"] }), {
    type: "string",
    description: "Level",
    optional: false,
    enum: ["a", "b"],
  });
  assert.deepEqual(num("Count", { optional: true }), {
    type: "number",
    description: "Count",
    optional: true,
  });
});

test("validate rejects non-object arguments", () => {
  assert.deepEqual(validate(fields, null), { success: false, messages: ["arguments must be an object"] });
  assert.deepEqual(validate(fields, "nope"), { success: false, messages: ["arguments must be an object"] });
  assert.deepEqual(validate(fields, [1]), { success: false, messages: ["arguments must be an object"] });
});

test("validate rejects missing required fields and skips absent optional ones", () => {
  const result = validate(fields, { tag: "x" });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.messages, ["name is required"]);
});

test("validate rejects wrong types and enum violations", () => {
  assert.deepEqual(validate(fields, { name: 3 }), { success: false, messages: ["name must be a string"] });
  assert.deepEqual(validate(fields, { name: "x", count: "two" }), {
    success: false,
    messages: ["count must be a number"],
  });
  assert.deepEqual(validate(fields, { name: "x", level: "max" }), {
    success: false,
    messages: ["level must be one of: low, high"],
  });
});

test("validate strips unknown keys and returns only known present values", () => {
  const result = validate(fields, { name: "n", tag: "t", level: "high", count: 2, extra: "ignored" });
  assert.deepEqual(result, { success: true, data: { name: "n", tag: "t", level: "high", count: 2 } });
});

test("toJsonSchema describes fields, enums, required set, and additionalProperties false", () => {
  assert.deepEqual(toJsonSchema(fields), {
    type: "object",
    properties: {
      name: { type: "string", description: "The name" },
      tag: { type: "string", description: "Area label" },
      level: { type: "string", description: "Level", enum: ["low", "high"] },
      count: { type: "number", description: "Count" },
    },
    required: ["name"],
    additionalProperties: false,
  });
});

test("toJsonSchema omits description and required for empty fields", () => {
  assert.deepEqual(toJsonSchema({}), {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });
});