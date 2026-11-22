import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "./permissions.js";

test("only owner and admin can manage tenant provider secrets",()=>{
 assert.equal(hasPermission("owner","secrets:manage"),true);
 assert.equal(hasPermission("admin","secrets:manage"),true);
 assert.equal(hasPermission("operator","secrets:manage"),false);
 assert.equal(hasPermission("viewer","secrets:manage"),false);
});

test("only owner and admin can read secret metadata",()=>{
 assert.equal(hasPermission("owner","secrets:read"),true);
 assert.equal(hasPermission("admin","secrets:read"),true);
 assert.equal(hasPermission("operator","secrets:read"),false);
 assert.equal(hasPermission("viewer","secrets:read"),false);
});


test("cost pricing is owner/admin managed while workspace viewers can read estimates", () => {
  assert.equal(hasPermission("owner", "costs:manage"), true);
  assert.equal(hasPermission("admin", "costs:manage"), true);
  assert.equal(hasPermission("operator", "costs:manage"), false);
  assert.equal(hasPermission("viewer", "costs:manage"), false);
  assert.equal(hasPermission("viewer", "costs:read"), true);
  assert.equal(hasPermission("operator", "costs:read"), false);
});
