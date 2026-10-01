# Public Plugin Release Checklist

## Product

- [ ] Display name and descriptions match actual functionality
- [ ] Starter prompts are realistic
- [ ] AI-generated questions are never presented as real exam questions
- [ ] No claim guarantees admission, rank, or score

## Publisher

- [ ] OpenAI Platform developer/business identity is verified
- [ ] DEVELOPER_NAME exactly matches the verified publisher identity
- [ ] Website, support, privacy, and terms URLs are public and consistent with publisher identity

## MCP

- [ ] Production MCP URL is HTTPS and publicly reachable
- [ ] Domain challenge is configured through OPENAI_APPS_CHALLENGE
- [ ] /.well-known/openai-apps-challenge returns only the exact verification token
- [ ] Scan Tools succeeds
- [ ] All tools expose readOnlyHint, openWorldHint, destructiveHint
- [ ] Tool descriptions and schemas match real behavior
- [ ] No unnecessary PII, auth secrets, debug payloads, or logs are returned
- [ ] UI CSP matches actual domains

## UI

- [ ] Choice card renders
- [ ] Correct answer is not visible before submission
- [ ] Timer records active question time
- [ ] Error-code correction works
- [ ] Final session summary renders
- [ ] Text fallback remains usable when UI is unavailable

## Review

- [ ] Five positive review cases pass
- [ ] Three negative review cases pass
- [ ] Demo walkthrough recording is ready if requested
- [ ] Release notes are prepared
- [ ] Availability countries/regions are selected intentionally

## Package

- [ ] Run build-package.mjs with the production MCP URL
- [ ] dist/gongkao-coach/plugin.json has no placeholders
- [ ] dist/gongkao-coach/mcp.json points to production
- [ ] skills/ contains onboarding and coach skills
- [ ] assets/logo.svg and assets/icon.svg are present
- [ ] ZIP contains exactly one plugin root
