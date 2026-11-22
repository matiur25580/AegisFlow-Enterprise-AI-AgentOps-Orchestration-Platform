import test from "node:test";
import assert from "node:assert/strict";
import { AgentProviderExecutor } from "./executor.js";
import { ProviderExecutionError, type AgentProviderConfig, type SecretResolver } from "./types.js";

const config: AgentProviderConfig = { tenantId:"tenant-a",provider:"openai",model:"gpt-test",secretRef:"vault:tenant-a/openai",systemPrompt:"Be useful.",temperature:0.2,maxOutputTokens:128,timeoutMs:5000,responseFormat:"text" };
const resolver: SecretResolver = { resolve: async ({tenantId,secretRef}) => { assert.equal(tenantId,"tenant-a");assert.equal(secretRef,"vault:tenant-a/openai");return "test-api-key-123"; } };

test("OpenAI adapter sends bounded request and returns usage without exposing credentials", async()=>{
 let captured: {url:string;init:RequestInit}|null=null;
 const fakeFetch: typeof fetch=async(url,init)=>{captured={url:String(url),init:init??{}};return new Response(JSON.stringify({choices:[{message:{content:"hello"}}],usage:{prompt_tokens:10,completion_tokens:4}}),{status:200,headers:{"content-type":"application/json"}});};
 const result=await new AgentProviderExecutor(resolver,fakeFetch).execute(config,{question:"hi"});
 assert.equal(result.text,"hello");assert.equal(result.usage.inputTokens,10);assert.equal(result.usage.outputTokens,4);
 assert.equal(captured?.url,"https://api.openai.com/v1/chat/completions");
 assert.equal(new Headers(captured?.init.headers).get("authorization"),"Bearer test-api-key-123");
});

test("missing secret reference fails closed before making a request",async()=>{
 let called=false;const fakeFetch:typeof fetch=async()=>{called=true;return new Response("{}");};
 await assert.rejects(()=>new AgentProviderExecutor(resolver,fakeFetch).execute({...config,secretRef:null},{}),(error:unknown)=>error instanceof ProviderExecutionError&&error.code==="PROVIDER_SECRET_REF_MISSING");
 assert.equal(called,false);
});

test("provider errors do not leak response bodies or API keys",async()=>{
 const fakeFetch:typeof fetch=async()=>new Response(JSON.stringify({error:{message:"private upstream detail"}}),{status:429});
 await assert.rejects(()=>new AgentProviderExecutor(resolver,fakeFetch).execute(config,{}),(error:unknown)=>error instanceof ProviderExecutionError&&error.code==="PROVIDER_RATE_LIMITED"&&error.message==="Provider request failed.");
});

test("unsupported providers fail closed",async()=>{
 await assert.rejects(()=>new AgentProviderExecutor(resolver).execute({...config,provider:"bedrock"},{}),(error:unknown)=>error instanceof ProviderExecutionError&&error.code==="PROVIDER_UNSUPPORTED");
});
