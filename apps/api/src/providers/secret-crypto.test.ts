import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptWithKey, encryptWithKey } from "./secret-crypto.js";

test("AES-256-GCM secret encryption round-trips and uses fresh nonces",()=>{
 const key=randomBytes(32);
 const first=encryptWithKey("provider-secret-value",key);
 const second=encryptWithKey("provider-secret-value",key);
 assert.equal(decryptWithKey(first,key),"provider-secret-value");
 assert.notEqual(first.iv,second.iv);
 assert.notEqual(first.ciphertext,second.ciphertext);
});

test("AES-256-GCM authentication rejects modified ciphertext",()=>{
 const key=randomBytes(32);
 const encrypted=encryptWithKey("sensitive",key);
 const tampered={...encrypted,ciphertext:Buffer.from("tampered").toString("base64")};
 assert.throws(()=>decryptWithKey(tampered,key));
});

test("AES-256-GCM rejects invalid key lengths",()=>{
 assert.throws(()=>encryptWithKey("secret",randomBytes(16)));
});
