# Pets and companions

Skai's desktop pets are optional, local renderer companions. The separate
transparent Electron window can wander, animate from sprite strips, react to
workspace activity, and run bounded character actions. It never controls the
user's pointer or clicks on the user's behalf.

## Built-in pets

All seven built-ins are visible in Pet Workshop, where their source strips,
animation states, behavior settings, and sprite dimensions can be inspected:

| Pet | Default idle/walk action |
| --- | --- |
| Percy | Celebrate |
| Byte | Curious scan |
| Ember | Curl up by the flame |
| Blaze | Approach the cursor, pounce, and fire breath |
| Nova | Star orbit |
| Rocky | Roll and settle |
| Sprout | Stretch and unfurl |

Blaze's cursor-aware attacks are limited to Blaze. The behavior reads the
cursor position to choose a target, then performs approach, wind-up, pounce or
fire-breath, impact, and return animations. The large flame plume and impact
burst are separate transparent effects. The cursor remains untouched.

## Sprite format and timing

Built-in animation strips use eleven 256×256 cells (2816×256 total). Cell zero
is the rest pose, cells one through nine carry motion, and cell ten repeats the
rest pose exactly. This makes the loop seam deterministic. Blink strips follow
the same dimensions and preserve the pet's visible bounds so blinking cannot
resize or shift it.

Blink duration is adjustable per pet in Workshop and is bounded from 170 to
700 ms, with a 280 ms default. Built-in behavior triggers during idle or
wandering and defaults to a randomized 30–60 second interval. The interval,
trigger states, enabled flag, and available actions are configurable per pet.
Reduced motion and disabling behavior remain available.

## Workshop and local generation

Workshop exposes built-ins as read-only construction references and lets users
create custom profiles. Its guided local generation flow uses the configured
Stable Diffusion Turbo runtime or a local ComfyUI endpoint to generate a
concept image. Users review the image before creating a draft, then author or
import the idle, walk, blink, and reaction strips. A generated concept does not
automatically become an animation sheet.

Custom animation sheets are stored locally. Legacy six- and ten-cell custom
strips remain readable until the user replaces them. See
[`assets/pets/README.md`](../assets/pets/README.md) for rebuilding and validating
the built-in artwork.

## Validation and remaining acceptance

`npm run check:pet-assets` validates built-in dimensions, loop endpoints,
visible motion, blink bounds, and Blaze's effects. `npm run test:pet` checks
wander placement and attack sequencing. `npm run smoke:windows` checks the
packaged companion surface as part of the Electron artifact smoke.

The full packaged UI matrix passes across fourteen routes, five supported
window sizes, and four theme/sidebar variants. Those checks do not replace live
visual acceptance of attack timing, cursor tracking, multi-monitor placement,
reduced-motion behavior, or Linux compositor differences. See
[release readiness](RELEASE_READINESS.md) for the remaining release gates.
