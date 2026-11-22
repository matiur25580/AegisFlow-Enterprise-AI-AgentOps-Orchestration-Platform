import test from "node:test";
import assert from "node:assert/strict";
import { AgentProviderExecutor } from "./executor.js";
import { ProviderExecutionError, type AgentProviderConfig, type SecretResolver } from "./types.js";

const config: AgentProviderConfig = { tenantId:"tenant-a",provider:"openai",model:"gpt-test",secretRef:"vault:tenant-a/openai",systemPrompt:"Be useful.",temperature:0.2,maxOutputTokens:128,timeoutMs:5000,responseFormat:"text" };
const resolver: SecretResolver = { resolve: async ({tenantId,secretRef}) => { assert.equal(tenantId,"tenant-a");assert.equal(secretRef,"vault:tenant-a/openai");return "test-api-key-123"; } };

test("OpenAI adapter sends bounded request and returns usage without exposing credentials", async()=>{
 const captured: {value?: {url:string;init:RequestInit}} = {};
 const fakeFetch: typeof fetch=async(url,init)=>{captured.value={url:String(url),init:init??{}};return new Response(JSON.stringify({choices:[{message:{content:"hello"}}],usage:{prompt_tokens:10,completion_tokens:4}}),{status:200,headers:{"content-type":"application/json"}});};
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

test("Anthropic adapter extracts text and token usage", async()=>{
 const fakeFetch:typeof fetch=async(_url,init)=>{assert.equal(new Headers(init?.headers).get("anthropic-version"),"2023-06-01");return new Response(JSON.stringify({content:[{type:"text",text:"anthropic answer"}],usage:{input_tokens:7,output_tokens:3}}),{status:200});};
 const result=await new AgentProviderExecutor(resolver,fakeFetch).execute({...config,provider:"anthropic"}, {question:"hi"});
 assert.equal(result.text,"anthropic answer");assert.equal(result.usage.inputTokens,7);assert.equal(result.usage.outputTokens,3);
});

test("Google adapter extracts candidate text and usage metadata", async()=>{
 let target="";
 const fakeFetch:typeof fetch=async(url,init)=>{target=String(url);assert.equal(new Headers(init?.headers).get("x-goog-api-key"),"test-api-key-123");return new Response(JSON.stringify({candidates:[{content:{parts:[{text:"google answer"}]}}],usageMetadata:{promptTokenCount:9,candidatesTokenCount:5}}),{status:200});};
 const result=await new AgentProviderExecutor(resolver,fakeFetch).execute({...config,provider:"google"}, {question:"hi"});
 assert.equal(new URL(target).pathname,"/v1beta/models/gpt-test:generateContent");
 assert.equal(result.text,"google answer");assert.equal(result.usage.inputTokens,9);assert.equal(result.usage.outputTokens,5);
});

test("secret resolver failures are sanitized",async()=>{
 const broken:SecretResolver={resolve:async()=>{throw new Error("vault internal secret path and credential details");}};
 await assert.rejects(()=>new AgentProviderExecutor(broken).execute(config,{}),(error:unknown)=>error instanceof ProviderExecutionError&&error.code==="PROVIDER_SECRET_UNAVAILABLE"&&!error.message.includes("vault internal"));
});
