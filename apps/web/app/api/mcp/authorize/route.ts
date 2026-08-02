import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSessionFromNodeHeaders } from "@nocturne/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function signAccountAssertion(input: {
  secret: string;
  userId: string;
  audience: string;
  rawRequest: string;
}) {
  const issuedAt = nowSeconds();
  const payload = {
    typ: "account_assertion",
    iat: issuedAt,
    exp: issuedAt + 300,
    sub: input.userId,
    aud: input.audience,
    requestHash: createHash("sha256").update(input.rawRequest).digest("hex"),
    nonce: randomBytes(18).toString("base64url"),
  };
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", input.secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}

function loginPage(oauthRequest: string, callback: string) {
  const oauthJson = JSON.stringify(oauthRequest).replaceAll("<", "\\u003c");
  const callbackJson = JSON.stringify(callback).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Nocturne to ChatGPT</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101014;color:#ececf1;margin:0;min-height:100vh;display:grid;place-items:center}
main{width:min(520px,calc(100% - 32px));background:#18181f;border:1px solid #343440;border-radius:16px;padding:28px;box-shadow:0 18px 60px #0008}
h1{margin:0 0 8px;font-size:24px}p{line-height:1.5;color:#b7b7c4}label{display:block;font-weight:650;margin:16px 0 8px}
input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #464655;background:#0f0f14;color:white}
button{width:100%;padding:12px;margin-top:18px;border:0;border-radius:10px;background:#e8e8ef;color:#111;font-weight:750;cursor:pointer}.error{color:#ff9b9b;min-height:24px}
small{display:block;margin-top:14px;color:#858593}
</style></head><body><main>
<h1>Sign in to Nocturne</h1>
<p>Use the same account you use on the Nocturne website. ChatGPT will act through that account and its selected character.</p>
<form id="login"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
<label for="password">Password</label><input id="password" type="password" autocomplete="current-password" minlength="8" required>
<p id="error" class="error" role="alert"></p><button type="submit">Sign in and authorize</button></form>
<small>This does not create a separate MCP game account.</small>
<script>
const form=document.getElementById('login');const error=document.getElementById('error');
form.addEventListener('submit',async(event)=>{event.preventDefault();error.textContent='';
const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
let body=null;try{body=await response.json()}catch{}
if(!response.ok||body?.error){error.textContent=body?.message||body?.error?.message||'Sign-in failed.';return;}
const next=new URL('/api/mcp/authorize',location.origin);next.searchParams.set('oauth_request',${oauthJson});next.searchParams.set('callback',${callbackJson});location.replace(next.toString());
});
</script></main></body></html>`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const encodedRequest = url.searchParams.get("oauth_request") || "";
    const callbackValue = url.searchParams.get("callback") || "";
    if (!encodedRequest || encodedRequest.length > 30_000 || !callbackValue) {
      return html("<h1>Invalid MCP authorization request.</h1>", 400);
    }

    const mcpBaseUrl = new URL(requiredEnv("NOCTURNE_MCP_URL"));
    const callback = new URL(callbackValue);
    if (callback.origin !== mcpBaseUrl.origin || callback.pathname !== "/oauth/account-callback") {
      return html("<h1>Invalid MCP callback.</h1>", 400);
    }

    let rawRequest: string;
    try {
      rawRequest = Buffer.from(encodedRequest, "base64url").toString("utf8");
    } catch {
      return html("<h1>Invalid MCP authorization request.</h1>", 400);
    }
    if (!rawRequest || rawRequest.length > 20_000) {
      return html("<h1>Invalid MCP authorization request.</h1>", 400);
    }

    const session = await getSessionFromNodeHeaders(Object.fromEntries(request.headers.entries()));
    if (!session) return html(loginPage(encodedRequest, callback.toString()));

    const assertion = signAccountAssertion({
      secret: requiredEnv("MCP_ACCOUNT_LINK_SECRET"),
      userId: session.user.id,
      audience: mcpBaseUrl.toString().replace(/\/$/, ""),
      rawRequest,
    });
    callback.searchParams.set("oauth_request", encodedRequest);
    callback.searchParams.set("assertion", assertion);
    return Response.redirect(callback.toString(), 302);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "nocturne-web",
        event: "mcp_account_authorization_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return html("<h1>Nocturne MCP authorization is not configured.</h1>", 500);
  }
}
