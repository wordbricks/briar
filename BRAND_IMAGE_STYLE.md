# Briar Brand Image Style

This document defines the visual language for Briar's editorial brand imagery.
Use it for onboarding illustrations, launch artwork, feature covers, and other
large-format images where Briar should feel calm, mysterious, tactile, and
distinctive.

Reference images:

- Dark: [`apps/briar/src/assets/onboarding-eve-issue.png`](apps/briar/src/assets/onboarding-eve-issue.png)
- Dark portrait: [`apps/briar/src/assets/onboarding-prerequisites.png`](apps/briar/src/assets/onboarding-prerequisites.png)
- Light portrait: [`apps/briar/src/assets/onboarding-prerequisites-light.png`](apps/briar/src/assets/onboarding-prerequisites-light.png)

## Core Idea

**A quiet myth rendered as a distressed two-ink print.**

Briar brand images use either a nearly black aubergine field with pale
dusty-blush silhouettes or its approved light-paper inverse. The subject and
the Briar mark should look as though they were printed together in one
imperfect risograph or screen-print pass. The result should feel editorial and
atmospheric, never like a polished 3D render, stock illustration, or UI
screenshot.

## Color Palette

Use a restrained near-monochrome palette.

| Role | Color | Usage |
| --- | --- | --- |
| Deep aubergine | `#2B2020` | Dominant background and negative space |
| Dark aubergine | `#1F1717` | Deeper edge variation and shadow |
| Dusty blush | `#C7A8A7` | Main figure and logo ink |
| Pale blush | `#CDAFAD` | Brighter halftone areas |
| Warm paper white | `#FFF9FA` | Rare, restrained highlight only |

- Keep the background visually stable around `#2B2020`.
- Build depth through ink density and texture, not additional colors.
- Allow slight warm-red or dusty-magenta variation caused by print noise.
- Do not use saturated purple or the purple app-icon tile in editorial imagery.
- Avoid pure black and pure white except for tiny highlights.

## Light Background Variant

Use the light variant when an illustration sits beside a white or pale product
surface and the dark version would feel visually heavy. It is an inverse of the
same print system, not a separate illustration style.

| Role | Color | Usage |
| --- | --- | --- |
| Warm blush paper | `#F3E9E8` | Dominant background and negative space |
| Warm paper white | `#FFF9FA` | Subtle fibers and worn highlights |
| Deep aubergine ink | `#2B2020` | Figure, hands, and Briar mark |
| Dark aubergine ink | `#1F1717` | Densest halftone and edge areas |
| Dusty blush noise | `#C7A8A7` | Low-density paper grain only |

### Light Variant Rules

- Reverse the tonal roles while preserving the original aubergine and blush
  hues.
- Keep the background warm and fibrous. Never replace it with clean digital
  white.
- Render foreground elements with dark aubergine ink rather than black.
- Preserve visible dropout, halftone dots, dry-ink speckling, and distressed
  edges inside dark foreground shapes.
- Keep background grain quieter than foreground grain so the focal point stays
  legible.
- Apply the same dark ink texture to the figure and Briar mark. The mark must
  not become a clean vector silhouette.
- Preserve the same composition, scale, logo orientation, and negative-space
  ratio when creating a light counterpart to an existing dark image.
- The light version should feel airy and welcoming without becoming cheerful,
  glossy, pastel, or decorative.

### Choosing a Variant

- Use the **dark variant** for immersive hero images, launch screens, covers,
  and moments that benefit from dramatic contrast.
- Use the **light variant** beside forms, setup flows, settings, and other
  information-dense light surfaces.
- Do not mix dark-variant and light-variant color roles inside one image.
- When two variants appear in the same flow, keep their composition and print
  density closely related so they read as one family.

## Texture and Print Treatment

Every foreground element must share the same tactile print language.

- Coarse risograph or screen-print halftone dots
- Uneven ink coverage and softly distressed edges
- Photocopy grain, dry-ink speckling, and subtle paper abrasion
- Slight tonal variation inside otherwise flat silhouettes
- Imperfect contours that remain clean enough to preserve recognition
- Matte, absorbent paper appearance with no glossy digital finish

The Briar mark must receive the same grain, ink density, and edge treatment as
the person or object holding it. It must not look like a clean vector pasted
over a textured illustration.

## Composition

- Prefer a panoramic aspect ratio close to **2.3:1**.
- Make the Briar mark the primary focal point.
- Place the mark at or very near the geometric center when it is the hero
  subject.
- Preserve generous uninterrupted negative space around the focal point.
- Let the human silhouette enter from a lower edge and remain partially
  cropped.
- Use one strong diagonal gesture, such as an arm reaching toward the mark.
- Keep the visual hierarchy readable at onboarding-card size.
- Keep critical content away from the outer 8% of the canvas for responsive
  cropping.

Do not fill the frame with secondary symbols, decorative plants, scenery, UI
cards, or explanatory diagrams.

## Human Silhouettes

Human figures are symbolic shapes rather than rendered characters.

- Use an adult, non-photorealistic silhouette.
- Reduce the figure to a profile, neck, shoulder, arm, and hand.
- Keep the surface continuous and abstract, with no visible garment seams,
  fabric folds, hair strands, or anatomical detail.
- Use pose and spacing to communicate emotion instead of facial features.
- Favor calm curiosity, quiet delight, contemplation, or gentle mischief.
- Avoid realism, glamour lighting, sexualized anatomy, or dramatic action
  poses.

## Briar Mark Treatment

The shape of the Briar mark is a locked brand asset.

- Use only the pale issue-shaped glyph when the artwork calls for a standalone
  mark.
- Preserve the original tilt, proportions, rounded corners, and three concave
  bite scallops.
- Never rotate, mirror, flip, stretch, simplify, or redraw the mark to fit a
  scene.
- Reposition the surrounding figure or hand instead of changing the mark.
- If the image depicts a bite interaction, the person's mouth must approach
  the existing scalloped edge.
- Apply the same dusty-blush halftone texture as the human silhouette.
- Omit the purple rounded-square app-icon background unless an app icon is
  explicitly required.

## Mood

The image should feel:

- Moody but not threatening
- Mysterious but immediately legible
- Tactile, imperfect, and human
- Editorial rather than promotional
- Minimal but emotionally suggestive
- Ancient or mythic in idea, contemporary in execution

## Avoid

- Photorealism or polished metallic 3D rendering
- Smooth vector gradients or glossy surfaces
- Full-color palettes and saturated violet backgrounds
- Detailed faces, clothing, anatomy, or environments
- Literal office, coding, robot, or dashboard imagery
- Text, labels, magazine mastheads, or watermarks
- A clean logo floating above a textured scene
- Moving or distorting the logo's bitten edge
- Excessive visual noise that competes with the central mark

## Image Generation Prompt Template

Use this as a starting point and replace the bracketed scene description.

```text
Create a wide editorial brand illustration for Briar in an approximately 2.3:1
panoramic ratio.

Scene: [describe one simple symbolic interaction].

Style: a stark two-ink risograph or distressed screen print on tactile paper.
Use a nearly black aubergine background (#2B2020) and pale dusty-blush ink
(#C7A8A7) for every foreground element. Add coarse halftone dots, uneven ink
coverage, photocopy grain, dry-ink speckling, softly distressed edges, and
subtle paper abrasion. Keep the image matte, minimal, moody, atmospheric, and
editorial.

Composition: make the Briar mark the primary focal point at the geometric center
of the canvas. Preserve large areas of uninterrupted negative space. Let a
single abstract adult silhouette enter from a lower edge, partially cropped,
with one clear diagonal gesture leading toward the mark.

Human treatment: show only a simplified profile, neck, shoulder, arm, and hand.
Use one continuous non-anatomical silhouette with no facial detail, hair
strands, clothing seams, fabric folds, or realistic body rendering.

Logo invariant: use the original standalone Briar issue glyph exactly as
provided. Preserve its tilt, proportions, rounded corners, and three concave
bite scallops. Do not rotate, mirror, flip, stretch, simplify, or redraw it.
Apply the same dusty-blush halftone ink and distressed texture as the human
silhouette. Do not include the purple app-icon background.

Avoid: text, extra symbols, UI cards, robots, scenery, saturated colors,
photorealism, glossy 3D rendering, detailed anatomy, watermarks, and a clean
vector logo pasted over the artwork.
```

### Light Background Variant Prompt

Append or substitute this palette block when generating a light counterpart:

```text
Create the approved light-paper variant of the Briar brand style. Preserve the
scene, crop, composition, logo geometry, gesture, and negative space from the
dark version.

Use a warm fibrous blush-paper background close to #F3E9E8. Render every
foreground element, including the Briar mark, in deep aubergine ink close to
#2B2020. Keep coarse halftone dots, uneven ink coverage, photocopy grain,
dry-ink speckling, paper abrasion, and softly distressed edges. The background
must retain subtle fibers and dusty-blush noise and must not look like flat
digital white.

Keep the image effectively two-tone. Do not add gradients, pastel accent
colors, saturated purple, glossy highlights, or a clean vector logo. The light
version should feel airy and welcoming while remaining moody, tactile,
minimal, and editorial.
```

## Review Checklist

Before accepting a Briar brand image, confirm:

- [ ] The selected palette is consistent: dark `#2B2020` background or light
      `#F3E9E8` paper background.
- [ ] The palette is effectively two-tone.
- [ ] The logo and figure share the same print texture.
- [ ] The light variant retains visible paper grain and does not look digitally
      white.
- [ ] The Briar mark retains its exact shape and orientation.
- [ ] The composition has a single clear focal point.
- [ ] Negative space remains generous and useful.
- [ ] The figure is abstract and free of distracting detail.
- [ ] The image still reads clearly when cropped into the onboarding hero.
- [ ] There is no text, watermark, purple icon tile, or unrelated decoration.
