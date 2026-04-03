# Group Chat Support

**Scope:** Medium | **Depends on:** Core API (complete)

---

## What It Does

Adds group chat support to the API. You can send messages to group threads, receive group messages with participant info in webhooks, and distinguish group chats from 1:1 conversations in the conversations endpoint.

## Why It Matters

Group texts are a real part of business communication. Right now, group messages still come through your webhook but they're treated as 1:1 -- you don't know it's a group, who else is in it, or how to reply to the group. This fixes all of that.

## How It Works

**Receiving group messages:**
Inbound group messages include `isGroup: true`, the group name (if set), the individual sender, and the full participant list. Your CRM can display and route these differently from 1:1 threads.

**Sending to groups:**
POST /send accepts a `chatGuid` parameter instead of a phone number to target a group chat. The chat GUID comes from the conversations endpoint or from inbound webhook payloads.

**Conversations endpoint:**
GET /conversations now returns `isGroup`, `groupName`, and `participants[]` for group threads. 1:1 conversations return `isGroup: false` with no changes to existing fields.

**Backward compatible** -- 1:1 message flow is completely unchanged.

## API Examples

**Send to a group:**
```bash
curl -X POST https://api.example.com/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatGuid": "iMessage;+;chat12345",
    "message": "Hey team, meeting in 5"
  }'
```

**Inbound group message webhook:**
```json
{
  "type": "inbound_message",
  "sender": "+18015559876",
  "body": "On my way",
  "threadId": "iMessage;+;chat12345",
  "isGroup": true,
  "groupName": "Sales Team",
  "participants": ["+18015551234", "+18015559876", "+18015554321"]
}
```

## Scope

- 2 development phases (types/cache first, then send/webhook wiring)
- 4 tasks total
- Participant data is cached to avoid redundant lookups on every message
