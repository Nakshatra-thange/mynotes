## OAuth 2.0 for FDE

Part 1 of my identity series. I built an auth server, an API, a client and an AI agent from scratch to understand OAuth. Here is everything I learned, in the order it finally clicked.

### Why I’m learning this
AI can write code. What it can’t do is sit on a call with a customer’s IT team and work out why their login is broken, what their security team will actually approve, and how an AI agent should be allowed to touch their data. That judgment is the job of a Forward Deployed Engineer (FDE), and almost every enterprise deployment runs through identity: OAuth, OIDC, SAML, SCIM.
So my plan is to learn each one by building it, not just reading about it. This post covers OAuth 2.0. OIDC and SAML come next.

### What you’ll get from this post
• A mental model of OAuth that you can explain to a non-engineer
• The full Authorization Code + PKCE flow, and why every step exists
• How an API should validate a token, in the right order
• Refresh tokens, rotation and what happens when one is stolen
• How AI agents act on a user’s behalf safely (token exchange)
• The attacks OAuth defends against, and the defence for each
• What an FDE actually does with all this at a company

1. The one-sentence version
OAuth 2.0 is a framework for delegated authorization: letting an app act on a user’s behalf without ever seeing the user’s password.
Notice what it is not. OAuth does not tell you who the user is. That is authentication, and it’s what OIDC adds on top (next post). Mixing these two up is the most common beginner mistake, and interviewers love to probe it.
The hotel analogy
You own a hotel room. A cleaning app needs to get in.
• You (the resource owner) own the room.
• The cleaning app (the client) wants access.
• The front desk (the authorization server) decides whether to hand over a keycard.
• The keycard is the access token. It opens only certain doors (scopes) and stops working after a while.
• The room door (the resource server, or API) checks the card before opening.
Nobody handed the cleaner your master key. That’s the whole idea.

2. The four roles
Role
In the hotel
In real life
Resource Owner
You
The user
Client
Cleaning app
Your product, or your AI agent
Authorization Server
Front desk
The IdP: Okta, Entra, Auth0, Keycloak, Google
Resource Server
The door
The API holding the data
As an FDE, you’re usually the client developer. The customer owns the IdP, and the API is either yours or theirs. Knowing which role you’re playing in a given conversation clears up half of all “who should fix this?” arguments.
3. The flow I use for any user login: Authorization Code + PKCE
OAuth has several grant types. For anything where a human logs in (web app, SPA, mobile), the answer is Authorization Code with PKCE. The older Implicit and Password grants are deprecated, and you should know why.
The steps
1. Client:   make random `state` and a secret `code_verifier`;
             compute code_challenge = SHA256(code_verifier)
2. Client:   redirect the browser to  /authorize?response_type=code
             &client_id&redirect_uri&scope&state&code_challenge
3. User:     logs in at the auth server and approves
4. Auth:     redirects back to redirect_uri?code=...&state=...
5. Client:   checks that `state` matches what it stored
6. Client:   POSTs to /token with the code AND the original code_verifier
7. Auth:     checks the code is unused, redirect_uri is identical,
             and SHA256(verifier) == the stored challenge
8. Auth:     returns access token (+ refresh token)
The key design point: the code travels through the browser (visible, interceptable). The tokens travel over a direct back-channel between the client’s server and the auth server. So the thing that’s exposed in the browser is useless on its own.
Why every piece exists
This is the part worth memorizing. Each parameter exists to stop one specific attack.
Piece
What it stops
How
Single-use code, short life (about 60s)
Replay of a stolen code
The server deletes the code on first use
PKCE (verifier + challenge)
Code interception
A stolen code is useless without the secret verifier that never left the client
state
CSRF on the callback (attacker finishes their login in your browser)
The client checks the returned state equals the one it created for this session
Exact-match redirect_uri
Open-redirect: sending the code to an attacker’s URL
Pre-registered URIs compared as exact strings, never “starts with”
Back-channel token exchange
Tokens leaking through browser history, logs or referrers
Tokens never appear in a URL
Two corrections I had to make to my own notes, because they matter:
1. PKCE is not only for public clients. Current best practice (OAuth 2.1) says use it for every authorization-code client, including confidential backends. It defends against code injection as well as interception.
2. state and PKCE do different jobs. state ties the response to the browser session that started the flow. PKCE ties the code to the client instance that asked for it. Use both.
One more detail I wouldn’t have guessed: when the redirect_uri is wrong, a good auth server returns an error page and does not redirect. Redirecting an error to an unverified URL would itself be the vulnerability.
4. Tokens: what the API must check
An access token is often a JWT: three base64url parts, header.payload.signature. The payload is readable by anyone. Decoding is not trusting. The signature is what makes it trustworthy.
When a request arrives at the API, the checks run in a deliberate order:
1. Parse: is it three valid base64url parts?
2. Algorithm: is alg one I allow? (We decide, the token doesn’t.)
3. Key lookup: find the public key in the JWKS using the kid header.
4. Signature: was it signed by that key?
5. Only now read the claims: iss (right issuer), aud (meant for this API), exp and nbf (time window, with small clock skew).
6. Scope: does the token allow this action?
The order matters because until the signature is verified, the payload is just text an attacker wrote.
The two classic JWT attacks
• alg: none: the attacker sets the algorithm to “none” and omits the signature. A naive library believes it. Fix: pin the allowed algorithms in your code.
• Algorithm confusion: the attacker changes RS256 to HS256 and signs with the public key as if it were a shared secret. Same fix: pin the algorithm.
401 vs 403
This tiny distinction shows up in real debugging constantly.
• 401: “I don’t know who you are, or your token is bad.” Missing, expired, wrong audience, bad signature.
• 403: “I know who you are, but you’re not allowed.” The token is valid but the scope is insufficient.
When a customer says “the API returns an error”, the first question is always: 401 or 403? It splits the problem in half.
Audience: the quiet hero
A token with a perfect signature can still be wrong if its aud names a different API. Without audience checks, a token issued for a low-risk service could be replayed against a high-risk one. That’s the confused deputy problem. The resource parameter (RFC 8707) lets a client ask for a token for one specific API, and it matters even more for agents that touch many systems.
5. JWT vs opaque tokens: the central tradeoff

JWT
Opaque
What it is
Self-contained, signed
A random string
How the API checks it
Locally, with math
Asks the auth server: introspection (RFC 7662)
Speed
Fast, no network call
One extra call per request
Revocation
Not instant. Valid until exp
Instant
I proved this in my lab. I revoked a JWT, and the API kept accepting it, because the API never asks the auth server anything. Then I switched to opaque tokens, revoked, and the very next call returned 401.
So the real-world compromise is: short-lived JWTs (5 to 15 minutes) plus refresh tokens. You get speed, and a stolen token has a small blast radius.
Two more facts from the introspection endpoint worth remembering:
• It requires client authentication, otherwise anyone could probe tokens.
• For an invalid token it returns only {"active": false}, never why. Explaining the reason helps attackers.
Revocation (RFC 7009) follows the same philosophy: it always returns 200, even for garbage tokens, so attackers can’t use it to guess which tokens exist.
6. Refresh tokens, rotation and reuse detection
Short access tokens need a way to renew without bothering the user. A refresh token is a long-lived credential, kept server-side, that buys new access tokens.
Rotation
Every time you use a refresh token, the server gives you a new one and the old one dies:
login ──► R1 ──use──► R2 ──use──► R3     (one “family”)
Reuse detection
If a dead token (say R1) ever shows up again, either you or a thief holds a stale copy. The server can’t tell which, so it revokes the entire family. The user logs in again and the thief is locked out.
Important implementation detail: used tokens are marked used, not deleted. If you delete them, a replayed token looks like garbage and you can’t tell a thief from noise.
In my lab I played the thief myself: I copied R1 from the browser session, used it from curl, got fresh tokens, then watched the legitimate client’s next refresh trigger the revocation and kill both sessions. Seeing that on the wire made it permanent in my head.
A bug I found by thinking about rotation
If two requests hit the client at the same moment the access token expires, both try to refresh with R1. The second one looks like a replay, and rotation kills the whole session. The fix is a lock: one refresh in flight per session, and everyone else waits for the result. This is a real production bug. “Two workers refreshing the same token” is a classic cause of mysterious logouts.
7. Where tokens live: the BFF pattern
A single-page app that stores tokens in localStorage is exposed to any injected script (XSS). The modern answer is a Backend-for-Frontend (BFF):
• The backend does the OAuth flow and holds the tokens.
• The browser gets only an HttpOnly session cookie that JavaScript can’t read.
My lab client was built this way from day one, and it was actually simpler than the alternative.
And if your product stores customers’ refresh tokens, you hold the keys to their data. Encrypt them at rest (envelope encryption with a KMS), isolate them per tenant, and never put them in logs. This is the part that goes wrong most often in real integrations.
8. Client authentication at the token endpoint
A backend that can keep a secret proves itself when calling /token:
• client_secret_basic: secret in an HTTP header
• client_secret_post: secret in the body
• private_key_jwt: the client signs a small JWT with its private key. No shared secret on the wire, which is why security-conscious enterprises prefer it
• mTLS: the client proves itself with a certificate
Expect enterprise customers to push you toward private_key_jwt.
9. The FDE layer: agents and token exchange
This is the part I care about most, because it’s where the future is.
The problem. Alice uses my app, which calls an AI agent. The agent needs to read Alice’s documents from an API. Why shouldn’t the agent just forward Alice’s token?
• Alice’s token was issued for the agent, so the API correctly rejects it (wrong audience).
• Even if it worked, the agent would carry all of Alice’s power for as long as the token lives.
• The API’s logs would say “alice did this”, with no trace that an agent did.
The fix: token exchange (RFC 8693). The agent trades Alice’s token for a new one:
sub = alice            (who it’s for)
aud = the API          (only this API)
scope = read only      (narrower)
act = { sub: agent }   (who is actually doing it)
lifetime = 60 seconds
The auth server decides whether the exchange is allowed, using three policies:
1. The incoming token must have been issued for this agent.
2. The agent may only get tokens for its approved target APIs.
3. Requested scopes must be a subset of what the user granted and what the agent’s policy allows.
That last point is least privilege for agents: the agent doesn’t limit itself, the server limits it. If the agent’s code is compromised or tricked by a prompt injection, it still cannot hold more power than policy allows.
The act claim is gold for audit logs. sub says whose data. act says who touched it.
Three identities, three grants
Situation
Who is acting?
Grant
User logs in and uses the product
The user
Authorization Code + PKCE
Nightly job, no user involved
The service itself
Client Credentials
Agent acts for a user
The user, through a service
Token Exchange
For every integration, ask “whose authority is this using?” The answer decides the grant and the audit trail. Token exchange isn’t required for every AI integration, since the IdP and downstream API must support it, but understanding it is how you’ll reason about agent security.
10. The attack map
Every defence above stops a specific attack. I wrote a script that plays the attacker against my own servers and prints 🛡️ when a defence holds and 💥 when it doesn’t.
Attack
Defence
Code interception
PKCE
Replayed authorization code
Single-use codes
CSRF on callback
state
Evil or near-miss redirect URI
Exact-match registration
Token for API A used on API B
Audience check
Read-only token tries to write
Scope check (403)
Tampered token payload
Signature verification
alg: none forgery
Algorithm pinning
Stolen refresh token
Rotation + reuse detection
Agent overreaching
Server-enforced exchange policy
Use of a revoked token
Introspection (opaque mode only)
Mix-up attacks
iss parameter (RFC 9207)
The lesson that stuck: I then broke each defence on purpose. I deleted the line that makes codes single-use and watched the replay attack flip to 💥. I changed the redirect check to “starts with” and watched the near-miss attack through. Breaking a defence teaches you more than reading about it.
11. What this looks like at a real company
I had a worry: do I need to write all this code for a company? No. The honest answer:
• Nobody writes their own authorization server in production. You use Okta, Auth0, Entra, Cognito, Keycloak or similar.
• But you still write the code around that black box: the login flow in your app, token validation in your API, secure storage and refresh of customers’ tokens, failure handling, and the agent and integration glue.
• You use maintained libraries for all of it. You should not hand-roll JWT validation in production.
So why build it by hand once? Because of the calls. When a customer says “login is broken”, you’ll be saying things like:
• “Your redirect URI has a trailing slash, so it doesn’t match what’s registered.”
• “The token’s aud is the wrong API.”
• “Two of your workers used the same refresh token, so rotation killed the session.”
• “Your server clock is three minutes off, which breaks exp.”
You can only diagnose those if you’ve seen them break. That’s the edge AI tools can’t give you.
The error table I keep in my head
Error
What to investigate
redirect_uri_mismatch
Registered URI vs requested URI (trailing slash, http vs https)
invalid_client
Client ID, secret or auth method
invalid_grant
Expired or reused code, wrong PKCE verifier, dead refresh token
invalid_scope
Unsupported or unauthorized scope
invalid_token / 401
Missing, expired, bad signature or wrong audience
403
Valid token, insufficient permission
429
Rate limit: back off and retry
12. Where this goes next: the Vaultline project
To prove I can do this for real, I’m building Vaultline, a multi-tenant B2B SaaS with an AI agent that combines OAuth, OIDC, SAML, SCIM and Postgres Row-Level Security. The headline claim: an AI agent that provably can’t read past a user’s permissions, enforced by the database and not by the prompt.
The foundation layer is already done. It isolates tenants inside Postgres itself, so even a buggy query can’t leak one customer’s data to another.
[Insert your database diagram here]
Suggested caption: Vaultline’s database foundation: tables and constraints, a per-transaction tenant context, RLS policies, a safe tenant lookup function, and least-privilege grants.
In short, that diagram shows five layers: the tables (tenants, users, documents) with constraints, the tenant context (app_tenant_id() reading a per-transaction setting), RLS policies that filter every read and validate every write, resolve_tenant() as a restricted SECURITY DEFINER lookup, and grants that give the app role only the operations it needs (append-only audit log). I’ll write that up in its own post.
Self-check: can I explain these without notes?
1. Why is the authorization code exposed in the browser but the token isn’t?
2. What does PKCE stop that state doesn’t, and vice versa?
3. Why does the API verify the signature before trusting iss and aud?
4. Why 403 for a missing scope but 401 for an expired token?
5. When would I choose short JWTs, and when opaque tokens with introspection?
6. What happens when an old refresh token is replayed, and why can’t the server tell who’s the thief?
7. Why must the auth server, not the agent, enforce the agent’s scope limits?
8. Client Credentials vs delegated vs token exchange: which one fits a nightly job, and which fits an agent acting for a user?
Key takeaways
• OAuth is authorization, not authentication.
• Every parameter in the flow exists to stop a named attack. Learn the attack together with the defence.
• Validate tokens in order: signature first, then iss, aud, exp, scope.
• JWT = fast but not instantly revocable. Opaque = a network call but instantly revocable.
• Refresh tokens rotate, and reuse kills the whole family.
• Agents never forward the user’s token. They exchange it for a narrower one, and the auth server enforces the limits.
• As an FDE, you rarely build the auth server. You integrate with one, debug it under pressure, and explain it to customers. Building it once is how you earn that skill.
Next in the series: OpenID Connect (ID tokens, nonce, why email is a bad identity key, and Entra’s tenant and group-overage gotchas), followed by SAML