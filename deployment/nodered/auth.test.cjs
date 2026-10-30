const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/user-authentication.js`, "utf8");
const user = { username: "admin", password: "$2b$12$" + "A".repeat(53), permissions: "*" };

function load(value, env = {}) {
  const context = { module: { exports: {} }, process: { env }, require: () => ({
    readFileSync(file) {
      assert.equal(file, env.NODE_RED_AUTH_FILE || "/data/node-red/admin-auth.json");
      if (value === undefined) throw new Error("missing file");
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  }) };
  vm.runInNewContext(source, context);
  return JSON.parse(JSON.stringify(context.module.exports));
}

test("preserves persistent credentials without defaults or anonymous access", () => {
  assert.deepEqual(load({ users: [user], default: { permissions: "*" } }), {
    type: "credentials", users: [user],
  });
});
test("supports an explicit persistent authentication path", () => {
  assert.deepEqual(load({ users: [user] }, { NODE_RED_AUTH_FILE: "/config/auth.json" }).users, [user]);
});
test("fails closed for missing, malformed and unsafe credentials", () => {
  for (const value of [undefined, "{", null, {}, { users: [] },
    { users: [user, user] }, { users: [{ ...user, password: "__DEFAULT_ADMIN_PASSWORD__" }] },
    { users: [{ ...user, password: "plaintext" }] },
    { users: [{ ...user, password: "$2b$99$" + "A".repeat(53) }] },
    { users: [{ ...user, permissions: undefined }] },
    { users: [{ ...user, username: " " }] }, { users: [null] },
  ]) assert.throws(() => load(value));
});
