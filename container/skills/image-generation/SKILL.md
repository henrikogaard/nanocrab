---
name: image-generation
description: Generate images from text descriptions using AI. Supports fal.ai (Flux, SDXL), OpenAI DALL-E 3, and Leonardo.ai. Use when the user asks to create, generate, draw, or make an image.
allowed-tools: Bash(generate-image:*)
---

# Image Generation

Generate images from text prompts using multiple AI providers.

## Provider Selection

Check `/workspace/project/store/provider-preferences.json` if it exists to find the user's preferred image generation provider. Use the provider matching the group's folder or the global default. If the user specifies a provider in their message (e.g. "use DALL-E", "with fal", "leonardo style"), use that instead.

If no preference is set, use the first available provider in this order: fal, openai, leonardo.

## Quick Start

```bash
generate-image "a cat wearing a top hat" --provider fal
```

Then send the result to the user:

```
mcp__nanocrab__send_file({ filePath: "/workspace/group/generated-image.png", filename: "cat.png" })
```

## Usage

```bash
generate-image "prompt" [options]
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | `fal` | Provider: `fal`, `openai`, `leonardo` |
| `--output` | `generated-image.png` | Output filename (saved in current directory) |
| `--model` | Provider default | Model override |
| `--size` | `1024x1024` | Image dimensions (WxH) |

## Provider Details

### fal.ai (default)
- Models: `flux-dev` (default), `flux-schnell` (fast), `sdxl`
- Env: `FAL_KEY`
- Best for: High quality, fast generation

### OpenAI DALL-E
- Models: `dall-e-3` (default), `dall-e-2`
- Env: `OPENAI_API_KEY`
- Best for: Instruction following, text rendering

### Leonardo.ai
- Models: Uses default model
- Env: `LEONARDO_API_KEY`
- Best for: Artistic styles, character consistency

## Examples

```bash
# Flux (fast, high quality)
generate-image "sunset over Norwegian fjord, photorealistic" --provider fal

# DALL-E 3 (great at following complex prompts)
generate-image "a blueprint-style technical drawing of a coffee machine" --provider openai

# Different size
generate-image "wide panoramic landscape" --provider fal --size 1536x640

# Custom output name
generate-image "company logo" --provider fal --output logo.png
```

## Workflow

1. Generate the image with `generate-image`
2. Optionally read the image with `Read` to verify it looks good
3. Send to user with `mcp__nanocrab__send_file`
