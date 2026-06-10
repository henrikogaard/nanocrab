---
name: image-vision
description: See and analyze images sent in chat. When a message contains [Photo] or image file paths, use the Read tool to view the image. Always read images before responding about them.
---

# Image Vision

You can see images that users send in chat. The Read tool supports image files natively.

## How It Works

When a user sends a photo, the message content includes a path like:

```
[Photo] (/workspace/group/attachments/photo_123.jpg)
```

**Always read the image file** before responding:

```
Read /workspace/group/attachments/photo_123.jpg
```

The Read tool will show you the visual content. Then describe, analyze, or respond to the image as the user requested.

## Patterns to Watch For

- `[Photo] (/workspace/group/attachments/...)` — photo sent in chat
- `[Document: *.jpg]`, `[Document: *.png]`, `[Document: *.webp]` — image sent as document
- Any file path ending in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`

## Important

- **Always read the image** — don't just acknowledge the path, actually look at it
- If multiple images are sent, read each one
- If the image path is missing or download failed (no path in parentheses), tell the user the image didn't come through
- Large images work fine — the Read tool handles them
