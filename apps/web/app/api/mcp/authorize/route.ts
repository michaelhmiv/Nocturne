import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSessionFromNodeHeaders } from "@nocturne/auth";
import { createMcpConsentToken, verifyMcpConsentToken } from "../../../../lib/mcp-consent-token";

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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function shell(content: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Nocturne to ChatGPT</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101014;color:#ececf1;margin:0;min-height:100vh;display:grid;place-items:center}
main{width:min(520px,calc(100% - 32px));background:#18181f;border:1px solid #343440;border-radius:16px;padding:28px;box-shadow:0 18px 60px #0008}
h1{margin:0 0 8px;font-size:24px}p{line-height:1.5;color:#b7b7c4}label{display:block;font-weight:650;margin:16px 0 8px}
input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #464655;background:#0f0f14;color:white}
button,.button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border:0;border-radius:10px;background:#e8e8ef;color:#111;font-weight:750;cursor:pointer;text-align:center;text-decoration:none;display:block}
button.secondary{background:#2b2b35;color:#ececf1;border:1px solid #464655}.account{background:#111117;border-radius:10px;padding:14px;margin:18px 0}.account strong{display:block;color:#fff}.error{color:#ff9b9b;min-height:24px}small{display:block;margin-top:14px;color:#858593}
</style></head><body><main>${content}</main></body></html>`;
}

function loginPage(oauthRequest: string, callback: string) {
  const oauthJson = JSON.stringify(oauthRequest).replaceAll("<", "\\u003c");
  const callbackJson = JSON.stringify(callback).replaceAll("<", "\\u003c");
  return shell(`
<h1>Sign in to Nocturne</h1>
<p>Use or create the Nocturne account whose characters and world state ChatGPT should access.</p>
<form id="login"><label for="name">Display name</label><input id="name" type="text" autocomplete="name" maxlength="80" placeholder="Required only for a new account">
<label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
<label for="password">Password</label><input id="password" type="password" autocomplete="current-password" minlength="8" required>
<p id="error" class="error" role="alert"></p><button type="submit" value="sign-in">Sign in</button>
<button type="submit" value="sign-up" class="secondary">Create account</button></form>
<small>Each Nocturne account has separate characters, inventory, housing, and world membership.</small>
<script>
const form=document.getElementById('login');const error=document.getElementById('error');
form.addEventListener('submit',async(event)=>{event.preventDefault();error.textContent='';
const submitter=event.submitter?.value||'sign-in';const email=document.getElementById('email').value;const password=document.getElementById('password').value;const name=document.getElementById('name').value.trim();
const path=submitter==='sign-up'?'/api/auth/sign-up/email':'/api/auth/sign-in/email';
const payload=submitter==='sign-up'?{email,password,name:name||email.split('@')[0]||'Player'}:{email,password};
const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
let body=null;try{body=await response.json()}catch{}
if(!response.ok||body?.error){error.textContent=body?.message||body?.error?.message||'Authentication failed.';return;}
const next=new URL('/api/mcp/authorize',location.origin);next.searchParams.set('oauth_request',${oauthJson});next.searchParams.set('callback',${callbackJson});location.replace(next.toString());
});
</script>`);
}

function confirmationPage(input: {
  oauthRequest: string;
  callback: string;
  consentToken: string;
  email: string;
  name: string;
}) {
  return shell(`
<h1>Authorize ChatGPT</h1>
<p>ChatGPT is requesting permission to use Nocturne through the MCP connector.</p>
<div class="account"><small>Signed in as</small><strong>${escapeHtml(input.name)}</strong><span>${escapeHtml(input.email)}</span></div>
<p>The connector will act only through this account and its selected character. Write access can change persistent game state.</p>
<form method="post" action="/api/mcp/authorize">
<input type="hidden" name="oauth_request" value="${escapeHtml(input.oauthRequest)}">
<input type="hidden" name="callback" value="${escapeHtml(input.callback)}">
<input type="hidden" name="consent_token" value="${escapeHtml(input.consentToken)}">
<button type="submit">Authorize this account</button></form>
<button id="switch-account" type="button" class="secondary">Use a different account</button>
<p id="error" class="error" role="alert"></p>
<script>
const button=document.getElementById('switch-account');const error=document.getElementById('error');
button.addEventListener('click',async()=>{button.disabled=true;error.textContent='';
const response=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:'{}'});
if(!response.ok){error.textContent='Could not sign out. Open Nocturne and sign out manually.';button.disabled=false;return;}
location.reload();});
</script>`);
}

function authorizationInput(url: URL) {
  const encodedRequest = url.searchParams.get("oauth_request") || "";
  const callbackValue = url.searchParams.get("callback") || "";
  if (!encodedRequest || encodedRequest.length > 30_000 || !callbackValue) {
    throw new Error("invalid_request");
  }

  const mcpBaseUrl = new URL(requiredEnv("NOCTURNE_MCP_URL"));
  const callback = new URL(callbackValue);
  if (callback.origin !== mcpBaseUrl.origin || callback.pathname !== "/oauth/account-callback") {
    throw new Error("invalid_callback");
  }

  let rawRequest: string;
  try {
    rawRequest = Buffer.from(encodedRequest, "base64url").toString("utf8");
  } catch {
    throw new Error("invalid_request");
  }
  if (!rawRequest || rawRequest.length > 20_000) throw new Error("invalid_request");

  return { encodedRequest, callback, rawRequest, mcpBaseUrl };
}

async function sessionFor(request: Request) {
  return getSessionFromNodeHeaders(Object.fromEntries(request.headers.entries()));
}

export async function GET(request: Request) {
  try {
    const parsed = authorizationInput(new URL(request.url));
    const session = await sessionFor(request);
    if (!session) return html(loginPage(parsed.encodedRequest, parsed.callback.toString()));

    const secret = requiredEnv("MCP_ACCOUNT_LINK_SECRET");
    return html(
      confirmationPage({
        oauthRequest: parsed.encodedRequest,
        callback: parsed.callback.toString(),
        consentToken: createMcpConsentToken({
          secret,
          userId: session.user.id,
          rawRequest: parsed.rawRequest,
          callback: parsed.callback.toString(),
        }),
        email: session.user.email,
        name: session.user.name || session.user.email,
      }),
    );
  } catch (error) {
    const invalid = error instanceof Error && error.message.startsWith("invalid_");
    if (!invalid) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "nocturne-web",
          event: "mcp_account_authorization_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return html(
      shell(
        `<h1>${invalid ? "Invalid MCP authorization request." : "Nocturne MCP authorization is not configured."}</h1>`,
      ),
      invalid ? 400 : 500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const target = new URL(request.url);
    target.searchParams.set("oauth_request", String(form.get("oauth_request") || ""));
    target.searchParams.set("callback", String(form.get("callback") || ""));
    const parsed = authorizationInput(target);
    const session = await sessionFor(request);
    if (!session) return html(loginPage(parsed.encodedRequest, parsed.callback.toString()), 401);

    const secret = requiredEnv("MCP_ACCOUNT_LINK_SECRET");
    const consentToken = String(form.get("consent_token") || "");
    if (
      !verifyMcpConsentToken({
        token: consentToken,
        secret,
        userId: session.user.id,
        rawRequest: parsed.rawRequest,
        callback: parsed.callback.toString(),
      })
    ) {
      console.warn(
        JSON.stringify({
          level: "warn",
          service: "nocturne-web",
          event: "mcp_account_consent_rejected",
          origin: request.headers.get("origin"),
          secFetchSite: request.headers.get("sec-fetch-site"),
        }),
      );
      return html(shell("<h1>Invalid or expired authorization consent.</h1>"), 403);
    }

    const assertion = signAccountAssertion({
      secret,
      userId: session.user.id,
      audience: parsed.mcpBaseUrl.toString().replace(/\/$/, ""),
      rawRequest: parsed.rawRequest,
    });
    parsed.callback.searchParams.set("oauth_request", parsed.encodedRequest);
    parsed.callback.searchParams.set("assertion", assertion);
    const destination = parsed.callback.toString();
    const destinationJson = JSON.stringify(destination).replaceAll("<", "\\u003c");
    return html(
      shell(`
<h1>Completing authorization</h1>
<p>Nocturne approved the connection. Continuing to the MCP connector now.</p>
<a class="button" href="${escapeHtml(destination)}">Continue to ChatGPT</a>
<script>location.replace(${destinationJson});</script>`),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "nocturne-web",
        event: "mcp_account_authorization_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return html(shell("<h1>Nocturne MCP authorization could not be completed.</h1>"), 500);
  }
}
