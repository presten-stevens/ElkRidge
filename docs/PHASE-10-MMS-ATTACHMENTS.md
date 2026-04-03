# MMS & Attachment Support

**Scope:** Medium | **Depends on:** Core API (complete)

---

## What It Does

Adds image and file support to the API. You can send attachments via the send endpoint, receive attachment metadata in your webhook payloads, and download received files through a secure proxy.

## Why It Matters

Right now the API is text-only. If someone sends Tyler a photo or document, the webhook fires but the attachment is invisible. This closes that gap -- your CRM gets the full picture.

## How It Works

**Receiving attachments:**
When an inbound message has an image or file, the webhook payload includes an `attachments[]` array with the mime type, filename, size, and a download URL. Your CRM can fetch the file from that URL using your API key.

**Sending attachments:**
POST /send accepts multipart form data -- attach a file alongside the message body. The API forwards it to BlueBubbles, which handles the iMessage/MMS delivery.

**Security:**
Attachment downloads go through a proxy endpoint on our API. BlueBubbles URLs and credentials are never exposed to your CRM.

**Backward compatible** -- text-only messages work exactly as before.

## API Examples

**Webhook payload with attachment:**
```json
{
  "type": "inbound_message",
  "sender": "+18015551234",
  "body": "Check out this photo",
  "threadId": "iMessage;-;+18015551234",
  "attachments": [
    {
      "guid": "att_abc123",
      "mimeType": "image/jpeg",
      "filename": "IMG_0042.jpg",
      "size": 2457600,
      "downloadUrl": "/attachments/att_abc123"
    }
  ]
}
```

**Send an image:**
```bash
curl -X POST https://api.example.com/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "to=+18015551234" \
  -F "message=Here's the document" \
  -F "attachment=@/path/to/file.pdf"
```

**Download a received attachment:**
```bash
curl https://api.example.com/attachments/att_abc123 \
  -H "Authorization: Bearer YOUR_API_KEY" \
  --output photo.jpg
```

## Scope

- 2 development phases (types/inbound first, then outbound/download)
- 4 tasks total
- Default file size limit: 100MB (configurable)
